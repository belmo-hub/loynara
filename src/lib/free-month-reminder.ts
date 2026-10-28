import type { Pool } from "pg";
import { z } from "zod";
import { pool } from "@/db";
import { planCharge } from "./stripe-config";
import { emailTransportMode, sendTransactional, type TransactionalEmailProvider } from "./transactional-email";

/**
 * ENG-123 (D-021, Pilotvereinbarung § 2): the reminder in text form, 7 days before a shop's free first month ends, one per
 * location that started with the shop. The free_month_reminders row and the job are written by one statement, and its key
 * (shop, location, free month) lets that happen once; each job then sends at most once through the transactional reservation
 * keyed by the job id. While the email lane is off nothing is queued, and /operator shows the reminder as not sent.
 */
export const FREE_MONTH_REMINDER = "email.free_month";
const payload = z.object({ locationId: z.uuid(), freeUntil: z.iso.datetime({ offset: true }), recipientUserId: z.string().min(1).max(64) }).strict();
const DAY_MS = 86_400_000;

export async function queueFreeMonthReminders(database: Pick<Pool, "query"> = pool, now = new Date()): Promise<number> {
  if (emailTransportMode() === "disabled") return 0;
  const result = await database.query(`
    WITH due AS (
      SELECT s.tenant_id, p.location_id, s.free_until FROM subscriptions s
      JOIN billing_location_plans p ON p.tenant_id = s.tenant_id AND p.created_at <= s.started_at
      WHERE s.free_until > $1 AND s.free_until <= $1::timestamptz + interval '7 days'
        AND s.status IN ('active', 'past_due') AND NOT s.cancel_at_period_end
    ), reserved AS (
      INSERT INTO free_month_reminders (tenant_id, location_id, free_until) SELECT tenant_id, location_id, free_until FROM due
      ON CONFLICT DO NOTHING
      RETURNING tenant_id, location_id, free_until
    )
    INSERT INTO outbox_jobs (tenant_id, kind, payload)
    SELECT r.tenant_id, $2, jsonb_build_object('locationId', r.location_id::text, 'freeUntil', to_char(r.free_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'recipientUserId', o.user_id)
    FROM reserved r JOIN staff_roles o ON o.tenant_id = r.tenant_id AND o.role = 'owner' AND o.active
  `, [now, FREE_MONTH_REMINDER]);
  return result.rowCount ?? 0;
}

export async function deliverFreeMonthReminder(job: { id: string; tenantId: string; payload: Record<string, unknown> }, provider?: TransactionalEmailProvider) {
  if (emailTransportMode() === "disabled") return { status: "blocked" as const, reason: "Transactional email unavailable" };
  const parsed = payload.safeParse(job.payload);
  if (!parsed.success) return { status: "blocked" as const, reason: "Invalid free-month reminder job" };
  // Rechecked at send time: an owner who lost access, a shop that cancelled, or a changed free month gets nothing.
  const [row] = (await pool.query<{ email: string; shop: string; location: string; planCode: string | null; currency: string; current: boolean }>(`
    SELECT u.email, t.name AS shop, l.name AS location, s.plan_code AS "planCode", s.currency,
      (s.free_until = $4::timestamptz AND s.status IN ('active', 'past_due') AND NOT s.cancel_at_period_end) AS current
    FROM staff_roles o JOIN "user" u ON u.id = o.user_id JOIN tenants t ON t.id = o.tenant_id
    JOIN subscriptions s ON s.tenant_id = o.tenant_id JOIN locations l ON l.tenant_id = o.tenant_id AND l.id = $3
    WHERE o.tenant_id = $1 AND o.user_id = $2 AND o.role = 'owner' AND o.active
  `, [job.tenantId, parsed.data.recipientUserId, parsed.data.locationId, parsed.data.freeUntil])).rows;
  if (!row) return { status: "suppressed" as const, reason: "Recipient no longer has owner access" };
  if (!row.current) return { status: "suppressed" as const, reason: "Free month no longer ends then" };
  const charge = planCharge({ planCode: row.planCode, activeLocationCount: 1, currency: row.currency });
  if (!charge) return { status: "blocked" as const, reason: "No plan set" };
  // Reserved by job id before the provider is called: a retried or replayed job never sends a second mail.
  return sendTransactional({ to: row.email, jobId: job.id, ...freeMonthReminderText(row.shop, row.location, new Date(parsed.data.freeUntil), charge.unitMinor) }, provider);
}

const germanDay = (value: Date) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }).format(value);

/** Placeholder wording until Marketing and Legal approve it (written for Q-90 "continues unless cancelled"). Dates are the last free day and the first billing day (Legal). */
export function freeMonthReminderText(shop: string, location: string, freeUntil: Date, unitMinor: number) {
  const lastFree = germanDay(new Date(freeUntil.getTime() - DAY_MS));
  const firstBilling = germanDay(freeUntil);
  const price = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(unitMinor / 100);
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  return {
    subject: `Dein kostenloser Monat für ${clean(location)} endet am ${lastFree}`,
    body: [
      "Hallo,",
      "",
      `dein kostenloser Monat bei Loynara für ${clean(location)} (${clean(shop)}) endet am ${lastFree}.`,
      `Danach kostet Loynara ${price} im Monat für diesen Standort. Die erste Rechnung kommt am ${firstBilling} per E-Mail.`,
      "",
      `Wenn du bis zum ${lastFree} kündigst, kostet dich das nichts. Schreib dafür einfach an support@getloynara.com.`,
      "",
      `Eine Zahlungsart kannst du jederzeit in deinem Inhaberbereich unter „Abrechnung“ hinterlegen: ${new URL("/merchant/billing", process.env.PUBLIC_BASE_URL)}`,
      "Du musst jetzt nichts tun, wenn du weitermachen möchtest.",
      "",
      "Viele Grüße",
      "Loynara",
    ].join("\n"),
  };
}

/** /operator: free months ending within 7 days, per location that started with the shop, and whether the reminder went out. */
export async function freeMonthsEndingSoon(database: Pick<Pool, "query"> = pool, now = new Date()) {
  const { rows } = await database.query<{ tenantId: string; shop: string; location: string; freeUntil: Date; status: string | null }>(`
    SELECT s.tenant_id AS "tenantId", t.name AS shop, l.name AS location, s.free_until AS "freeUntil",
      (SELECT j.status FROM outbox_jobs j WHERE j.tenant_id = s.tenant_id AND j.kind = $2 AND j.payload ->> 'locationId' = p.location_id::text
        AND (j.payload ->> 'freeUntil')::timestamptz = s.free_until ORDER BY j.created_at DESC LIMIT 1) AS status
    FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
    JOIN billing_location_plans p ON p.tenant_id = s.tenant_id AND p.created_at <= s.started_at
    JOIN locations l ON l.tenant_id = p.tenant_id AND l.id = p.location_id
    WHERE s.free_until > $1 AND s.free_until <= $1::timestamptz + interval '7 days' AND s.status IN ('active', 'past_due') AND NOT s.cancel_at_period_end
    ORDER BY s.free_until, t.name, l.name
  `, [now, FREE_MONTH_REMINDER]);
  return rows.map(({ status, freeUntil, ...row }) => ({ ...row, lastFreeDay: germanDay(new Date(new Date(freeUntil).getTime() - DAY_MS)), sent: status === "complete" }));
}
