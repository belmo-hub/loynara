import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ownerProgram } from "./automations";
import { DomainError, lastConfirmedStamp } from "./loyalty";
import { surfaceHidden } from "./pilot-surfaces";
import { quietHoursDeferral } from "./promotion-policy";
import { eligible, lock } from "./wallet-messages";
import { almostGap, almostText, WALLET_QUIET_HOURS } from "./wallet-message-rules";
import { queueBatch } from "./winback";

// "Fast geschafft" (ENG-045): one Wallet reminder when a card is close to its next reward, once per reward cycle (until
// the card's next redemption). Marketing, so #88's consent, caps and quiet hours apply. Off by default, owner switch.

const rows = <T>(result: { rows: unknown[] }) => result.rows as T[];
/** Only a card that got there with a recent stamp: switching the reminder on does not message cards that sat near a reward for months. */
const RECENT_HOURS = 48;

const available = () => { if (surfaceHidden("walletMessages")) throw new DomainError("NOT_FOUND", "Nicht verfügbar"); };

export async function setAlmostThere(input: { actorUserId: string; programSlug: string; enabled: boolean }) {
  available();
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  await db.execute(sql`UPDATE programs SET almost_enabled = ${input.enabled} WHERE id = ${program.id}::uuid AND tenant_id = ${program.tenantId}::uuid`);
  return { enabled: input.enabled };
}

/** Called by the worker every few minutes, outside quiet hours (21–8 local) only. One message row per reward and gap. */
export async function queueAlmostMessages(now = new Date()) {
  if (surfaceHidden("walletMessages")) return 0;
  const programs = rows<{ tenantId: string; programId: string; type: "stamp" | "points"; timezone: string }>(await db.execute(sql`
    SELECT p.tenant_id AS "tenantId", p.id AS "programId", p.type, l.timezone
    FROM programs p JOIN locations l ON l.id = p.location_id AND l.tenant_id = p.tenant_id WHERE p.almost_enabled AND p.status = 'active'`));
  let queued = 0;
  for (const p of programs) {
    if (quietHoursDeferral(now, p.timezone, WALLET_QUIET_HOURS)) continue;
    queued += await db.transaction(async tx => {
      await lock(tx, p.tenantId);
      // The next reward is the cheapest current reward the balance has not reached yet.
      const due = sql`SELECT d.pass_id, d.tenant_id, d.membership_id, json_build_array(n.cost - d.balance, n.title)::text AS grp
        FROM (SELECT p.id AS pass_id, p.tenant_id, p.membership_id, m.balance, m.program_id, ${lastConfirmedStamp(now)} AS last ${eligible(p.tenantId, p.programId, now)}) d
        CROSS JOIN LATERAL (SELECT v.cost, v.title FROM rewards r CROSS JOIN LATERAL (SELECT cost, title FROM reward_versions v
            WHERE v.reward_id = r.id AND v.tenant_id = r.tenant_id AND v.effective_at <= ${now}::timestamptz ORDER BY v.version DESC LIMIT 1) v
          WHERE r.tenant_id = d.tenant_id AND r.program_id = d.program_id AND r.active AND v.cost > d.balance ORDER BY v.cost LIMIT 1) n
        WHERE n.cost - d.balance BETWEEN 1 AND ${almostGap(p.type)}::int AND d.last > ${now}::timestamptz - make_interval(hours => ${RECENT_HOURS})
          AND NOT EXISTS (SELECT 1 FROM wallet_message_recipients r JOIN wallet_messages w ON w.id = r.message_id AND w.tenant_id = r.tenant_id AND w.kind = 'almost'
            WHERE r.tenant_id = d.tenant_id AND r.membership_id = d.membership_id
              AND r.created_at > COALESCE((SELECT max(e.created_at) FROM ledger_entries e WHERE e.tenant_id = d.tenant_id AND e.membership_id = d.membership_id AND e.kind = 'redeem'), '-infinity'))`;
      return queueBatch(tx, p, "almost", now, due, grp => { const [missing, title] = JSON.parse(grp) as [number, string]; return almostText(p.type, missing, title); });
    });
  }
  return queued;
}
