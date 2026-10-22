import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ownerProgram } from "./automations";
import { validCardToken } from "./card-lifecycle";
import { activeHappyHour } from "./happy-hour";
import { DomainError } from "./loyalty";
import { surfaceHidden } from "./pilot-surfaces";
import { eligible, lock } from "./wallet-messages";
import { BIRTHDAY_FIELD_TEXT, birthdayText, birthdayWeek, germanDay, WINBACK_SEND_WINDOW } from "./wallet-message-rules";
import { bonusMax, queueBatch } from "./winback";

// Birthday (ENG-049). The customer may store day and month (no year) on the card; Legal (22 Oct): a voluntary field for a
// programme benefit, no separate consent, deletable at any time and then gone. The bonus is booked at the counter
// (loyalty.ts, bookBirthdayBonus); this file holds the card field, the owner set-up and the reminder to consented holders.

const rows = <T>(result: { rows: unknown[] }) => result.rows as T[];
const available = () => { if (surfaceHidden("walletMessages")) throw new DomainError("NOT_FOUND", "Nicht verfügbar"); };
/** Same as the bonus: once in this many days per card, so a moved birthday gets no second reminder. */
const REPEAT_DAYS = 300;

async function cardOf(cardToken: string) {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  const [card] = rows<{ tenantId: string; membershipId: string; shop: string; enabled: boolean; day: number | null; month: number | null }>(await db.execute(sql`
    SELECT m.tenant_id AS "tenantId", m.id AS "membershipId", t.name AS shop, p.birthday_enabled AS enabled, b.day, b.month
    FROM memberships m JOIN programs p ON p.id = m.program_id AND p.tenant_id = m.tenant_id JOIN tenants t ON t.id = m.tenant_id
      LEFT JOIN card_birthdays b ON b.membership_id = m.id AND b.tenant_id = m.tenant_id
    WHERE m.card_token = ${cardToken} AND m.closed_at IS NULL`));
  if (!card) throw new DomainError("NOT_FOUND", "Card not found");
  return card;
}

/** The card page field: shown while the owner has the bonus on, or while a birthday is stored (so it can be deleted). */
export async function getCardBirthday(cardToken: string) {
  available();
  const card = await cardOf(cardToken);
  return { available: card.enabled || card.day !== null, day: card.day, month: card.month, text: BIRTHDAY_FIELD_TEXT(card.shop) };
}

const birthdayInput = z.object({ day: z.number().int().min(1).max(31), month: z.number().int().min(1).max(12) }).strict()
  .refine(({ day, month }) => new Date(Date.UTC(2024, month - 1, day)).getUTCMonth() === month - 1, "No such date");

export async function setCardBirthday(cardToken: string, raw: { day: number; month: number }) {
  available();
  const parsed = birthdayInput.safeParse(raw);
  if (!parsed.success) throw new DomainError("INVALID_BIRTHDAY", "Bitte wähle einen gültigen Tag und Monat.");
  const card = await cardOf(cardToken);
  if (!card.enabled) throw new DomainError("NOT_FOUND", "Nicht verfügbar");
  await db.execute(sql`INSERT INTO card_birthdays (membership_id, tenant_id, day, month) VALUES (${card.membershipId}::uuid, ${card.tenantId}::uuid, ${parsed.data.day}, ${parsed.data.month})
    ON CONFLICT (membership_id) DO UPDATE SET day = EXCLUDED.day, month = EXCLUDED.month, updated_at = now()`);
  return { day: parsed.data.day, month: parsed.data.month };
}

/** Deletes the row: the birthday is gone, not hidden. Allowed whatever the owner's or the surface's switch says. */
export async function deleteCardBirthday(cardToken: string) {
  const card = await cardOf(cardToken);
  await db.execute(sql`DELETE FROM card_birthdays WHERE membership_id = ${card.membershipId}::uuid AND tenant_id = ${card.tenantId}::uuid`);
  return { deleted: true };
}

// ---- Owner: the switch and the bonus; counts only, never a birthday list (CTO, 22 Oct) ---------------------------------

const settingsInput = z.object({ enabled: z.boolean(), bonus: z.number().int().min(0) }).strict();

async function settings(program: { tenantId: string; id: string; type: string; birthdayEnabled: boolean; birthdayBonus: number }) {
  const [{ n }] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM card_birthdays b JOIN memberships m ON m.id = b.membership_id AND m.tenant_id = b.tenant_id
    WHERE b.tenant_id = ${program.tenantId}::uuid AND m.program_id = ${program.id}::uuid AND m.closed_at IS NULL`));
  return { enabled: program.birthdayEnabled, bonus: program.birthdayBonus, bonusMax: await bonusMax(program), cards: n };
}

export async function getBirthday(input: { actorUserId: string; programSlug: string }) {
  available();
  return settings(await ownerProgram(input.actorUserId, input.programSlug));
}

export async function updateBirthday(input: { actorUserId: string; programSlug: string; settings: z.input<typeof settingsInput> }) {
  available();
  const next = settingsInput.parse(input.settings);
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  if (next.bonus > await bonusMax(program)) throw new DomainError("INVALID_BIRTHDAY_BONUS", program.type === "stamp" ? "Bonus: kein Bonus oder 1 Stempel." : "Bonus: höchstens ein Viertel deiner günstigsten Prämie.");
  await db.execute(sql`UPDATE programs SET birthday_enabled = ${next.enabled}, birthday_bonus = ${next.bonus} WHERE id = ${program.id}::uuid AND tenant_id = ${program.tenantId}::uuid`);
  return settings({ ...program, birthdayEnabled: next.enabled, birthdayBonus: next.bonus });
}

// ---- Reminder: once in the birthday week, Mon–Sat 10–18 local, consented holders inside the per-customer cap -------------

export async function queueBirthdayMessages(now = new Date()) {
  if (surfaceHidden("walletMessages")) return 0;
  const programs = rows<{ tenantId: string; programId: string; type: "stamp" | "points"; bonus: number; timezone: string; today: string }>(await db.execute(sql`
    SELECT p.tenant_id AS "tenantId", p.id AS "programId", p.type, p.birthday_bonus AS bonus, l.timezone, (${now}::timestamptz AT TIME ZONE l.timezone)::date::text AS today
    FROM programs p JOIN locations l ON l.id = p.location_id AND l.tenant_id = p.tenant_id WHERE p.birthday_enabled AND p.status = 'active'`));
  let queued = 0;
  for (const p of programs) {
    if (!activeHappyHour([WINBACK_SEND_WINDOW], now, p.timezone)) continue;
    queued += await db.transaction(async tx => {
      await lock(tx, p.tenantId);
      const base = sql`SELECT d.pass_id, d.tenant_id, d.membership_id, b.day, b.month
        FROM (SELECT p.id AS pass_id, p.tenant_id, p.membership_id ${eligible(p.tenantId, p.programId, now)}) d
        JOIN card_birthdays b ON b.membership_id = d.membership_id AND b.tenant_id = d.tenant_id
        WHERE NOT EXISTS (SELECT 1 FROM wallet_message_recipients r JOIN wallet_messages w ON w.id = r.message_id AND w.tenant_id = r.tenant_id AND w.kind = 'birthday'
          WHERE r.tenant_id = d.tenant_id AND r.membership_id = d.membership_id AND r.created_at > ${now}::timestamptz - make_interval(days => ${REPEAT_DAYS}))`;
      // The week is computed here (29 February, New Year); one message per week end, because that date is in the text.
      const byEnd = new Map<string, string[]>();
      for (const c of rows<{ membership_id: string; day: number; month: number }>(await tx.execute(base))) {
        const week = birthdayWeek(c.day, c.month, p.today);
        if (week) byEnd.set(week.end, [...byEnd.get(week.end) ?? [], c.membership_id]);
      }
      let count = 0;
      for (const [end, members] of byEnd) {
        const due = sql`SELECT x.pass_id, x.tenant_id, x.membership_id, ${end}::text AS grp FROM (${base}) x WHERE x.membership_id IN (${sql.join(members.map(id => sql`${id}::uuid`), sql`, `)})`;
        count += await queueBatch(tx, p, "birthday", now, due, () => birthdayText(p.type, p.bonus, germanDay(end)));
      }
      return count;
    });
  }
  return queued;
}
