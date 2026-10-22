import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import * as schema from "@/db/schema";
import { db, pool } from "@/db";
import { locations, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";

/**
 * Retention states for open loyalty cards, derived only from recorded checkouts and balances.
 *
 * - recent: last qualifying checkout within the threshold.
 * - drifting: had at least one qualifying checkout, none within the threshold.
 * - never: no qualifying checkout yet (signed up, never recorded at the counter).
 * - near reward: the cheapest active reward is at most a quarter of its cost away (2 of 8 stamps).
 * - reward ready: the balance already covers the cheapest active reward.
 *
 * A qualifying checkout is the same unit as everywhere else: an unreversed online or reconciled offline staff award.
 * Nothing here knows why someone stopped coming; the states describe recorded activity, not intent.
 */
export const RETENTION_DAYS = [14, 30, 60, 90] as const;
export type RetentionDays = typeof RETENTION_DAYS[number];
export type RetentionFilter = "recent" | "drifting" | "never" | "near_reward" | "reward_ready";

export type RetentionSummary = {
  asOf: string;
  inactiveDays: RetentionDays;
  locationId: string | null;
  openCards: number;
  recent: number;
  drifting: number;
  never: number;
  /** Cards that were signed up more than 7 days ago and still have no checkout. */
  neverAfterWeek: number;
  nearReward: number;
  rewardReady: number;
  /** The same drifting rule evaluated seven days earlier, for an honest week-over-week direction. */
  driftingWeekAgo: number;
  /** Threshold used for near reward when exactly one programme is in scope (for campaign links), else null. */
  nearRewardMaxRemaining: number | null;
  /** Exact cheapest active reward for a single programme; drafts preserve this reward definition. */
  nearRewardId?: string | null;
  /** Campaign drafts are programme-specific, so combined counts must not offer a draft shortcut. */
  programCount?: number;
  rules: { drifting: string; never: string; nearReward: string; rewardReady: string };
};

export function parseRetentionDays(raw: string | null | undefined, fallback: RetentionDays = 30): RetentionDays {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!RETENTION_DAYS.includes(value as RetentionDays)) throw new DomainError("INVALID_FILTER", "Choose 14, 30, 60 or 90 days");
  return value as RetentionDays;
}

const QUALIFYING = (alias: string, asOf: string) => `
  ${alias}.kind = 'award' AND ${alias}.source in ('staff_online','staff_offline') AND ${alias}.created_at <= ${asOf}
  AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = ${alias}.tenant_id AND undo.reversal_of_id = ${alias}.id AND undo.created_at <= ${asOf})`;

/** Lateral joins over a memberships row `m`: `q.last_at` (last qualifying checkout) and `rw.cost` (cheapest active reward). */
export function retentionJoins(asOf: string) {
  return `
    LEFT JOIN LATERAL (
      SELECT max(a.created_at) AS last_at FROM ledger_entries a
      WHERE a.tenant_id = m.tenant_id AND a.membership_id = m.id AND ${QUALIFYING("a", asOf)}
    ) q ON true
    LEFT JOIN LATERAL (
      SELECT min(latest.cost)::int AS cost FROM rewards r
      JOIN LATERAL (
        SELECT rv.cost FROM reward_versions rv
        WHERE rv.tenant_id = r.tenant_id AND rv.reward_id = r.id AND rv.effective_at <= ${asOf}
        ORDER BY rv.version DESC LIMIT 1
      ) latest ON true
      WHERE r.tenant_id = m.tenant_id AND r.program_id = m.program_id AND r.active = true
    ) rw ON true`;
}

export const NEAR_REWARD_SQL = "(rw.cost - m.balance) BETWEEN 1 AND GREATEST(1, ceil(rw.cost / 4.0)::int)";

/** SQL predicate for one retention filter; `$cutoff` is the threshold timestamp parameter. */
export function retentionPredicate(filter: RetentionFilter, cutoff: string) {
  switch (filter) {
    case "recent": return `q.last_at >= ${cutoff}`;
    case "drifting": return `q.last_at < ${cutoff}`;
    case "never": return "q.last_at IS NULL";
    case "near_reward": return NEAR_REWARD_SQL;
    case "reward_ready": return "rw.cost IS NOT NULL AND m.balance >= rw.cost";
  }
}

export const RETENTION_RULES = {
  drifting: "Karten mit mindestens einer bestätigten Buchung, aber keiner in den gewählten Tagen.",
  never: "Angemeldete Karten ohne bestätigte Buchung. Ob diese Kundinnen und Kunden trotzdem da waren und warum nicht gebucht wurde, wissen wir nicht.",
  nearReward: "Karten, denen höchstens ein Viertel der günstigsten aktiven Prämie fehlt, auf ganze Einheiten aufgerundet; bei 8 Stempeln also 1 bis 2.",
  rewardReady: "Karten, deren aktueller Stand für die günstigste aktive Prämie reicht.",
} as const;

async function retentionScope(actorUserId: string, requestedLocationId?: string | null, snapshot?: PoolClient) {
  const scopedDb = snapshot ? drizzle({ client: snapshot, schema }) : db;
  const [staff] = await scopedDb.select({ tenantId: staffRoles.tenantId, role: staffRoles.role, locationId: staffRoles.locationId })
    .from(staffRoles).where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.active, true))).limit(1);
  if (!staff || (staff.role !== "owner" && staff.role !== "manager") || (staff.role === "manager" && !staff.locationId)) {
    throw new DomainError("FORBIDDEN", "Owner or manager access required");
  }
  if (staff.role === "manager") {
    if (requestedLocationId && requestedLocationId !== staff.locationId) throw new DomainError("NOT_FOUND", "Location not found in your scope");
    return { tenantId: staff.tenantId, locationId: staff.locationId! };
  }
  if (!requestedLocationId) return { tenantId: staff.tenantId, locationId: null };
  const [location] = await scopedDb.select({ id: locations.id }).from(locations)
    .where(and(eq(locations.id, requestedLocationId), eq(locations.tenantId, staff.tenantId))).limit(1);
  if (!location) throw new DomainError("NOT_FOUND", "Location not found in your scope");
  return { tenantId: staff.tenantId, locationId: location.id };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getRetentionSummary(actorUserId: string, options: { inactiveDays?: RetentionDays; locationId?: string | null; asOf?: Date } = {}, snapshot?: PoolClient): Promise<RetentionSummary> {
  const inactiveDays = options.inactiveDays ?? 30;
  if (!RETENTION_DAYS.includes(inactiveDays)) throw new DomainError("INVALID_FILTER", "Choose 14, 30, 60 or 90 days");
  if (options.locationId && !uuidPattern.test(options.locationId)) throw new DomainError("NOT_FOUND", "Location not found in your scope");
  const scope = await retentionScope(actorUserId, options.locationId, snapshot);
  const reader = snapshot ?? pool;
  const asOf = options.asOf ?? (await reader.query<{ now: Date }>("SELECT now() AS now")).rows[0].now;
  const day = 86_400_000;
  const weekAgo = new Date(asOf.getTime() - 7 * day);
  const cutoff = (at: Date) => new Date(at.getTime() - inactiveDays * day);
  const [now, then, programmes] = await Promise.all([
    reader.query<{ open: number; recent: number; drifting: number; never: number; neverAfterWeek: number; nearReward: number; rewardReady: number }>(`
      SELECT count(*)::int AS open,
        count(*) FILTER (WHERE ${retentionPredicate("recent", "$4")})::int AS recent,
        count(*) FILTER (WHERE ${retentionPredicate("drifting", "$4")})::int AS drifting,
        count(*) FILTER (WHERE ${retentionPredicate("never", "$4")})::int AS never,
        count(*) FILTER (WHERE q.last_at IS NULL AND m.created_at < $5)::int AS "neverAfterWeek",
        count(*) FILTER (WHERE ${retentionPredicate("near_reward", "$4")})::int AS "nearReward",
        count(*) FILTER (WHERE ${retentionPredicate("reward_ready", "$4")})::int AS "rewardReady"
      FROM memberships m JOIN programs p ON p.id = m.program_id AND p.tenant_id = m.tenant_id
      ${retentionJoins("$3")}
      WHERE m.tenant_id = $1 AND ($2::uuid IS NULL OR p.location_id = $2) AND p.status = 'active'
        AND m.closed_at IS NULL AND m.created_at <= $3
    `, [scope.tenantId, scope.locationId, asOf, cutoff(asOf), weekAgo]),
    reader.query<{ drifting: number }>(`
      SELECT count(*) FILTER (WHERE ${retentionPredicate("drifting", "$4")})::int AS drifting
      FROM memberships m JOIN programs p ON p.id = m.program_id AND p.tenant_id = m.tenant_id
      ${retentionJoins("$3")}
      WHERE m.tenant_id = $1 AND ($2::uuid IS NULL OR p.location_id = $2) AND p.status = 'active'
        AND (m.closed_at IS NULL OR m.closed_at > $3) AND m.created_at <= $3
    `, [scope.tenantId, scope.locationId, weekAgo, cutoff(weekAgo)]),
    reader.query<{ cost: number | null; rewardId: string | null }>(`
      SELECT selected.cost, selected.reward_id AS "rewardId" FROM programs p
      LEFT JOIN LATERAL (SELECT r.id AS reward_id, latest.cost FROM rewards r
        JOIN LATERAL (SELECT rv.cost FROM reward_versions rv WHERE rv.tenant_id = r.tenant_id AND rv.reward_id = r.id AND rv.effective_at <= $3 ORDER BY rv.version DESC LIMIT 1) latest ON true
        WHERE r.tenant_id = p.tenant_id AND r.program_id = p.id AND r.active = true
        ORDER BY latest.cost, r.id LIMIT 1) selected ON true
      WHERE p.tenant_id = $1 AND ($2::uuid IS NULL OR p.location_id = $2) AND p.status = 'active'
    `, [scope.tenantId, scope.locationId, asOf]),
  ]);
  const row = now.rows[0];
  const only = programmes.rows.length === 1 ? programmes.rows[0].cost : null;
  return {
    asOf: asOf.toISOString(),
    inactiveDays,
    locationId: scope.locationId,
    openCards: row.open,
    recent: row.recent,
    drifting: row.drifting,
    never: row.never,
    neverAfterWeek: row.neverAfterWeek,
    nearReward: row.nearReward,
    rewardReady: row.rewardReady,
    driftingWeekAgo: then.rows[0].drifting,
    nearRewardMaxRemaining: only ? Math.max(1, Math.ceil(only / 4)) : null,
    nearRewardId: programmes.rows.length === 1 ? programmes.rows[0].rewardId : null,
    programCount: programmes.rows.length,
    rules: RETENTION_RULES,
  };
}
