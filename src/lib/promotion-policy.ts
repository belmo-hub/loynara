import { sql } from "drizzle-orm";
import { db } from "@/db";

type Query = Pick<typeof db, "execute">;

export function promotionalLimits(env = process.env) {
  // Empty values (as shipped in .env.example) mean "use the default", not zero.
  const monthly = Number(env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT?.trim() || "100");
  const frequencyHours = Number(env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS?.trim() || "24");
  if (!Number.isSafeInteger(monthly) || monthly < 1 || monthly > 100_000 || !Number.isSafeInteger(frequencyHours) || frequencyHours < 1 || frequencyHours > 24 * 365) throw new Error("Invalid promotional safety limits");
  return { monthly, frequencyHours };
}

export async function hasRecentPromotion(query: Query, tenantId: string, membershipId: string, now: Date) {
  const cutoff = new Date(now.getTime() - promotionalLimits().frequencyHours * 3_600_000);
  const result = await query.execute(sql`
    SELECT (
      (SELECT count(*) FROM campaign_recipients r WHERE r.tenant_id = ${tenantId}::uuid AND r.membership_id = ${membershipId}::uuid AND r.status = 'complete' AND r.sent_at >= ${cutoff})
      + (SELECT count(*) FROM automation_runs r WHERE r.tenant_id = ${tenantId}::uuid AND r.membership_id = ${membershipId}::uuid AND r.status = 'complete' AND r.sent_at >= ${cutoff})
    )::int AS count
  `);
  return Number(result.rows[0]?.count ?? 0) > 0;
}

export async function monthlyLocationUsage(query: Query, tenantId: string, locationId: string, now: Date, lock = false) {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (lock) await query.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${locationId + month.toISOString()}, 0))`);
  const result = await query.execute(sql`
    SELECT (
      (SELECT count(*) FROM campaign_recipients r JOIN campaigns c ON c.id = r.campaign_id AND c.tenant_id = r.tenant_id
        JOIN programs p ON p.id = c.program_id AND p.tenant_id = c.tenant_id
        WHERE r.tenant_id = ${tenantId}::uuid AND p.location_id = ${locationId}::uuid AND r.created_at >= ${month} AND r.status IN ('queued','complete','failed'))
      + (SELECT count(*) FROM automation_runs r JOIN automation_rules a ON a.id = r.rule_id AND a.tenant_id = r.tenant_id
        JOIN programs p ON p.id = a.program_id AND p.tenant_id = a.tenant_id
        WHERE r.tenant_id = ${tenantId}::uuid AND p.location_id = ${locationId}::uuid AND r.created_at >= ${month} AND r.status IN ('queued','complete','failed'))
    )::int AS count
  `);
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Quiet hours for every promotional send (campaigns and automations): nothing goes out between 21:00 and 09:00 in
 * the location's own timezone. A send that falls inside the window is deferred to the next 09:00 local time, never
 * dropped; eligibility (consent, opt-out, card state, frequency) is checked again when it runs.
 */
export const QUIET_HOURS = { startHour: 21, endHour: 9 } as const;

function localParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, timeZone: string) {
  const wall = Date.UTC(year, month - 1, day, hour);
  let guess = wall;
  // Two passes settle the offset on either side of a DST change.
  for (let pass = 0; pass < 2; pass++) {
    const p = localParts(new Date(guess), timeZone);
    guess = wall - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(guess / 1000) * 1000);
  }
  return new Date(guess);
}

/** Returns when a send may happen if `now` is inside quiet hours for `timeZone`, otherwise null. */
export function quietHoursDeferral(now: Date, timeZone: string, window: { startHour: number; endHour: number } = QUIET_HOURS): Date | null {
  const local = localParts(now, timeZone);
  if (local.hour < window.startHour && local.hour >= window.endHour) return null;
  const day = local.hour >= window.startHour ? new Date(Date.UTC(local.year, local.month - 1, local.day + 1)) : new Date(Date.UTC(local.year, local.month - 1, local.day));
  return zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), window.endHour, timeZone);
}

type ProgramSender = { shopName: string; timezone: string; street: string | null; postalCode: string | null; city: string };

/** Shop and location behind a programme: the timezone schedules every promotional send, the address signs it. */
export async function programSender(query: Query, tenantId: string, programId: string) {
  const result = await query.execute(sql`
    SELECT t.name AS "shopName", l.timezone, l.street, l.postal_code AS "postalCode", l.city
    FROM programs p JOIN locations l ON l.id = p.location_id AND l.tenant_id = p.tenant_id JOIN tenants t ON t.id = p.tenant_id
    WHERE p.tenant_id = ${tenantId}::uuid AND p.id = ${programId}::uuid
  `);
  return (result.rows[0] as ProgramSender | undefined) ?? null;
}

export const senderAddressMissing = (sender: ProgramSender | null) => !sender?.street || !sender.postalCode;

/**
 * Sender name and footer of every campaign and automation mail (Legal, A-11): the shop is the sender, with its address,
 * the unsubscribe link and the privacy notice. Null while the address is missing: such a shop sends nothing promotional.
 * Never a card link: the card URL is a bearer credential.
 */
export function marketingSignature(sender: ProgramSender, unsubscribeLink: string) {
  if (senderAddressMissing(sender)) return null;
  const privacy = new URL("/datenschutz", process.env.PUBLIC_BASE_URL).toString();
  return {
    fromName: `${sender.shopName} via Loynara`,
    footer: `${sender.shopName} · ${sender.street}, ${sender.postalCode} ${sender.city}\nAngebote abbestellen: ${unsubscribeLink} · Datenschutz: ${privacy}`,
  };
}
