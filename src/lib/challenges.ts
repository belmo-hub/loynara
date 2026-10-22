import { sql } from "drizzle-orm";
import type { db } from "@/db";

type Query = Pick<Parameters<Parameters<typeof db.transaction>[0]>[0], "execute">;

/**
 * A card's monthly challenge state (ENG-052) for the calendar month, in the location's timezone, that contains `at`:
 * visit days (days with a cashier-confirmed award that was not corrected) and the challenge bonuses still standing.
 * `excluding` leaves one entry out, for a correction that is about to undo it.
 */
export async function challengeProgress(tx: Query, input: { tenantId: string; membershipId: string; locationId: string; at: Date; excluding?: string }) {
  const { rows: [row] } = await tx.execute<{ visits: number; bonuses: Array<{ id: string; delta: number }>; month: string }>(sql`
    WITH month AS (
      SELECT l.timezone AS tz, date_trunc('month', ${input.at.toISOString()}::timestamptz AT TIME ZONE l.timezone) AS start
      FROM locations l WHERE l.id = ${input.locationId}::uuid AND l.tenant_id = ${input.tenantId}::uuid)
    SELECT
      count(DISTINCT (e.created_at AT TIME ZONE month.tz)::date) FILTER (WHERE e.kind = 'award' AND e.source IN ('staff_online','staff_offline'))::int AS visits,
      coalesce(json_agg(json_build_object('id', e.id, 'delta', e.delta)) FILTER (WHERE e.source = 'challenge_bonus'), '[]'::json) AS bonuses,
      to_char(min(month.start), 'YYYY-MM') AS month
    FROM month LEFT JOIN ledger_entries e ON e.tenant_id = ${input.tenantId}::uuid AND e.membership_id = ${input.membershipId}::uuid
      AND (e.created_at AT TIME ZONE month.tz) >= month.start AND (e.created_at AT TIME ZONE month.tz) < month.start + interval '1 month'
      AND e.id IS DISTINCT FROM ${input.excluding ?? null}::uuid
      AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id)`);
  return row;
}
