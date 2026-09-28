import { sql } from "drizzle-orm";
import { db } from "@/db";

type Query = Pick<typeof db, "execute">;

export function promotionalLimits(env = process.env) {
  const monthly = Number(env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT ?? "100");
  const frequencyHours = Number(env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS ?? "24");
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
