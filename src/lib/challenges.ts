import { sql } from "drizzle-orm";
import type { db } from "@/db";

// Visit days: days with a cashier-confirmed award (staff_online or staff_offline) that was not corrected. Bonuses, taps
// without a cashier and expiry rows are never visits.

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

/**
 * Customer levels (ENG-053): the visit days in the last `days` days (location time), newest first, each with the date
 * („TT.MM.JJJJ“) on which it leaves the window, so the card can say how long a level holds without another visit.
 */
export async function recentVisitDays(tx: Query, input: { tenantId: string; membershipId: string; locationId: string; days: number }) {
  const { rows } = await tx.execute<{ leaves: string }>(sql`
    SELECT to_char((max(e.created_at) + make_interval(days => ${input.days})) AT TIME ZONE l.timezone, 'DD.MM.YYYY') AS leaves
    FROM ledger_entries e JOIN locations l ON l.id = ${input.locationId}::uuid AND l.tenant_id = e.tenant_id
    WHERE e.tenant_id = ${input.tenantId}::uuid AND e.membership_id = ${input.membershipId}::uuid
      AND e.kind = 'award' AND e.source IN ('staff_online','staff_offline') AND e.created_at > now() - make_interval(days => ${input.days})
      AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id)
    GROUP BY (e.created_at AT TIME ZONE l.timezone)::date, l.timezone ORDER BY max(e.created_at) DESC`);
  return rows.map(row => row.leaves);
}
