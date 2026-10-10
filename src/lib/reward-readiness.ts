import { sql } from "drizzle-orm";
import type { db } from "@/db";

type Query = Pick<typeof db, "execute">;
type Scope = { tenantId: string; programId: string };

/** Current persisted balance and latest effective active catalogue, as on the member card.
 * No ledger-derived balance or new earning calculation. Every join stays in scope.
 */
export async function rewardReadyMemberships(query: Query, scope: Scope, now: Date, membershipId?: string) {
  const result = await query.execute(sql`
    SELECT m.id FROM memberships m
    JOIN programs p ON p.tenant_id = m.tenant_id AND p.id = m.program_id
    WHERE m.tenant_id = ${scope.tenantId}::uuid AND m.program_id = ${scope.programId}::uuid
      AND m.closed_at IS NULL AND m.created_at <= ${now}
      AND p.status = 'active' AND p.effective_at <= ${now}
      AND (${membershipId ?? null}::uuid IS NULL OR m.id = ${membershipId ?? null}::uuid)
      AND EXISTS (
        SELECT 1 FROM rewards r
        JOIN LATERAL (
          SELECT rv.cost FROM reward_versions rv
          WHERE rv.tenant_id = r.tenant_id AND rv.reward_id = r.id AND rv.effective_at <= ${now}
          ORDER BY rv.version DESC LIMIT 1
        ) latest ON true
        WHERE r.tenant_id = m.tenant_id AND r.program_id = m.program_id AND r.active = true
          AND latest.cost <= m.balance
      )
    ORDER BY m.id LIMIT 501
  `);
  return result.rows.map(row => String(row.id));
}

export async function rewardReadyNow(query: Query, scope: Scope, membershipId: string, now: Date) {
  return (await rewardReadyMemberships(query, scope, now, membershipId)).includes(membershipId);
}
