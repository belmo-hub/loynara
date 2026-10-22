import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ownerProgram } from "./automations";
import { activeHappyHour } from "./happy-hour";
import { DomainError, lastConfirmedStamp } from "./loyalty";
import { surfaceHidden } from "./pilot-surfaces";
import { currentRewards } from "./product";
import { eligible, lock } from "./wallet-messages";
import { WINBACK_DAYS, WINBACK_SEND_WINDOW, WINBACK_WINDOW_DAYS, germanDay, winbackBonusMax, winbackText } from "./wallet-message-rules";

// Win-back reminders (ENG-044). The bonus itself is booked at the counter (loyalty.ts, bookWinbackBonus) for every card in
// its window; this only reminds consented Apple holders, once per lapse, Mon–Sat 10–18, inside the per-customer cap.
// The rows are ordinary wallet_messages (kind 'winback') delivered by the same `wallet.message` job as owner messages.

const rows = <T>(result: { rows: unknown[] }) => result.rows as T[];

const settingsInput = z.object({ enabled: z.boolean(), days: z.number().int().min(WINBACK_DAYS.min).max(WINBACK_DAYS.max), bonus: z.number().int().min(0) }).strict();

async function bonusMax(program: { tenantId: string; id: string; type: string }) {
  const costs = (await currentRewards(program.tenantId, program.id)).map(reward => reward.cost);
  return winbackBonusMax(program.type as "stamp" | "points", costs.length ? Math.min(...costs) : 0);
}

const available = () => { if (surfaceHidden("walletMessages")) throw new DomainError("NOT_FOUND", "Nicht verfügbar"); };

async function winbackSettings(program: { tenantId: string; id: string; type: string; winbackEnabled: boolean; winbackDays: number; winbackBonus: number; almostEnabled: boolean }) {
  // `almost`: the owner switch of ENG-045 ("Fast geschafft"), shown on the same page.
  return { enabled: program.winbackEnabled, days: program.winbackDays, bonus: program.winbackBonus, bonusMax: await bonusMax(program), type: program.type, almost: program.almostEnabled };
}

/** The owner's set-up (owner only, withheld with the walletMessages surface). */
export async function getWinback(input: { actorUserId: string; programSlug: string }) {
  available();
  return winbackSettings(await ownerProgram(input.actorUserId, input.programSlug));
}

export async function updateWinback(input: { actorUserId: string; programSlug: string; settings: z.input<typeof settingsInput> }) {
  available();
  const settings = settingsInput.parse(input.settings);
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  if (settings.bonus > await bonusMax(program)) throw new DomainError("INVALID_WINBACK_BONUS", program.type === "stamp" ? "Bonus: kein Bonus oder 1 Stempel." : "Bonus: höchstens ein Viertel deiner günstigsten Prämie.");
  const [updated] = rows<{ tenantId: string; id: string; type: string; winbackEnabled: boolean; winbackDays: number; winbackBonus: number; almostEnabled: boolean }>(await db.execute(sql`
    UPDATE programs SET winback_enabled = ${settings.enabled}, winback_days = ${settings.days}, winback_bonus = ${settings.bonus}
    WHERE id = ${program.id}::uuid AND tenant_id = ${program.tenantId}::uuid AND status = 'active'
    RETURNING tenant_id AS "tenantId", id, type, winback_enabled AS "winbackEnabled", winback_days AS "winbackDays", winback_bonus AS "winbackBonus", almost_enabled AS "almostEnabled"`));
  if (!updated) throw new DomainError("NOT_FOUND", "Programme not found in this merchant");
  return winbackSettings(updated);
}

/**
 * One message row per group (`grp` of `due`, the part of the text that differs) and one recipient row per due pass, plus
 * the outbox job, in the caller's transaction. `due` yields pass_id, tenant_id, membership_id and grp. Shared by the
 * automatic reminders (win-back, ENG-045 "Fast geschafft"); delivery is #88's `wallet.message` job unchanged.
 */
export async function queueBatch(tx: Pick<typeof db, "execute">, p: { tenantId: string; programId: string }, kind: "winback" | "almost", now: Date, due: SQL, textOf: (grp: string) => string) {
  let count = 0;
  for (const { grp } of rows<{ grp: string }>(await tx.execute(sql`SELECT DISTINCT grp FROM (${due}) x ORDER BY grp`))) {
    const [message] = rows<{ id: string }>(await tx.execute(sql`INSERT INTO wallet_messages (tenant_id, program_id, kind, text, created_at)
      VALUES (${p.tenantId}::uuid, ${p.programId}::uuid, ${kind}, ${textOf(grp)}, ${now}::timestamptz) RETURNING id`));
    const inserted = await tx.execute(sql`INSERT INTO wallet_message_recipients (message_id, pass_id, tenant_id, membership_id, created_at)
      SELECT ${message.id}::uuid, x.pass_id, x.tenant_id, x.membership_id, ${now}::timestamptz FROM (${due}) x WHERE x.grp = ${grp} ON CONFLICT DO NOTHING RETURNING pass_id`);
    await tx.execute(sql`UPDATE wallet_messages SET audience_count = ${inserted.rows.length} WHERE id = ${message.id}::uuid`);
    await tx.execute(sql`INSERT INTO outbox_jobs (tenant_id, kind, payload) VALUES (${p.tenantId}::uuid, 'wallet.message', jsonb_build_object('messageId', ${message.id}::text))`);
    count += inserted.rows.length;
  }
  return count;
}

/**
 * Called by the worker every few minutes. Per switched-on programme inside its send window: every eligible pass (consent,
 * live, reachable, room under the customer cap) whose card is in its win-back window and got no win-back since its last
 * confirmed stamp gets one recipient row. One message row per deadline date, because the date is in the text.
 */
export async function queueWinbackMessages(now = new Date()) {
  if (surfaceHidden("walletMessages")) return 0;
  const programs = rows<{ tenantId: string; programId: string; type: "stamp" | "points"; days: number; bonus: number; timezone: string }>(await db.execute(sql`
    SELECT p.tenant_id AS "tenantId", p.id AS "programId", p.type, p.winback_days AS days, p.winback_bonus AS bonus, l.timezone
    FROM programs p JOIN locations l ON l.id = p.location_id AND l.tenant_id = p.tenant_id WHERE p.winback_enabled AND p.status = 'active'`));
  let queued = 0;
  for (const p of programs) {
    if (!activeHappyHour([WINBACK_SEND_WINDOW], now, p.timezone)) continue;
    queued += await db.transaction(async tx => {
      // Same tenant lock as owner sends, so the customer cap is counted once across both.
      await lock(tx, p.tenantId);
      const due = sql`SELECT d.*, ((d.last AT TIME ZONE ${p.timezone})::date + ${p.days}::int + ${WINBACK_WINDOW_DAYS}::int)::text AS grp
        FROM (SELECT p.id AS pass_id, p.tenant_id, p.membership_id, ${lastConfirmedStamp(now)} AS last ${eligible(p.tenantId, p.programId, now)}) d
        WHERE (${now}::timestamptz AT TIME ZONE ${p.timezone})::date - (d.last AT TIME ZONE ${p.timezone})::date BETWEEN ${p.days}::int AND ${p.days + WINBACK_WINDOW_DAYS}::int
          AND NOT EXISTS (SELECT 1 FROM wallet_message_recipients r JOIN wallet_messages w ON w.id = r.message_id AND w.tenant_id = r.tenant_id AND w.kind = 'winback'
            WHERE r.tenant_id = d.tenant_id AND r.membership_id = d.membership_id AND r.created_at > d.last)`;
      return queueBatch(tx, p, "winback", now, due, deadline => winbackText(p.type, p.bonus, germanDay(deadline)));
    });
  }
  return queued;
}
