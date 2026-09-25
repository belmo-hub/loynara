import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "@/db";
import { programs, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";

const days = z.number().int().min(1).max(3650);
export const audienceDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new"), withinDays: days }).strict(),
  z.object({ kind: z.literal("recently_active"), withinDays: days }).strict(),
  z.object({ kind: z.literal("inactive"), daysSinceLast: days }).strict(),
  z.object({ kind: z.literal("frequent_visitors"), withinDays: days, minCheckouts: z.number().int().min(1).max(10000) }).strict(),
  z.object({ kind: z.literal("close_to_reward"), maxRemaining: z.number().int().min(1).max(100000), rewardId: z.uuid().optional() }).strict(),
]);

export type AudienceDefinition = z.infer<typeof audienceDefinitionSchema>;

const audienceQuerySchema = z.object({
  actorUserId: z.string().min(1),
  programId: z.uuid(),
  definition: audienceDefinitionSchema,
  asOf: z.date().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  afterMembershipId: z.uuid().optional(),
}).strict();

export type AudienceQuery = z.input<typeof audienceQuerySchema>;
export type SlugAudienceQuery = Omit<AudienceQuery, "programId"> & { programSlug: string };
export type AudienceResult = {
  total: number;
  membershipIds: string[];
  nextCursor: string | null;
  asOf: string;
  countingRule: string;
};

const DAY_MS = 86_400_000;
export const QUALIFYING_CHECKOUT_RULE = "One distinct request ID with at least one unreversed staff-online award counts as one recorded checkout; seed, redemption and reversal rows do not count. A recorded checkout does not prove a physical visit.";

type SegmentRow = { total: number; membershipId: string | null };

/**
 * Returns only pseudonymous membership IDs. Contact addresses and card/scan
 * credentials are not queried. asOf bounds enrollment and award timestamps;
 * close-to-reward uses the current persisted balance and active catalogue.
 */
export async function selectAudience(raw: AudienceQuery): Promise<AudienceResult> {
  const input = audienceQuerySchema.parse(raw);
  const asOf = input.asOf ?? new Date();
  const [staff] = await db.select({ tenantId: staffRoles.tenantId, role: staffRoles.role, locationId: staffRoles.locationId })
    .from(staffRoles).where(and(eq(staffRoles.userId, input.actorUserId), eq(staffRoles.active, true))).limit(1);
  if (!staff || (staff.role !== "owner" && staff.role !== "manager") || (staff.role === "manager" && !staff.locationId)) {
    throw new DomainError("FORBIDDEN", "Owner or manager access required");
  }
  const [program] = await db.select({ id: programs.id, locationId: programs.locationId, effectiveAt: programs.effectiveAt })
    .from(programs).where(and(eq(programs.id, input.programId), eq(programs.tenantId, staff.tenantId), eq(programs.status, "active"))).limit(1);
  if (!program || program.effectiveAt > asOf || (staff.role === "manager" && staff.locationId !== program.locationId)) {
    throw new DomainError("NOT_FOUND", "Programme not found in your scope");
  }

  const definition = input.definition;
  const withinDays = definition.kind === "new" || definition.kind === "recently_active" || definition.kind === "frequent_visitors"
    ? definition.withinDays : definition.kind === "inactive" ? definition.daysSinceLast : 0;
  const cutoff = new Date(asOf.getTime() - withinDays * DAY_MS);
  const activityJoin = `
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT e.request_id) FILTER (WHERE e.created_at >= p.cutoff)::int AS recent_count,
        max(e.created_at) AS last_at
      FROM ledger_entries e
      WHERE e.tenant_id = m.tenant_id AND e.membership_id = m.id
        AND e.kind = 'award' AND e.source = 'staff_online' AND e.created_at <= p.as_of
        AND NOT EXISTS (
          SELECT 1 FROM ledger_entries undo
          WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id
            AND undo.created_at <= p.as_of
        )
    ) activity ON true`;
  const rewardJoin = `
    LEFT JOIN LATERAL (
      SELECT min(latest.cost - m.balance)::int AS remaining
      FROM rewards r
      JOIN LATERAL (
        SELECT rv.cost FROM reward_versions rv
        WHERE rv.tenant_id = r.tenant_id AND rv.reward_id = r.id AND rv.effective_at <= p.as_of
        ORDER BY rv.version DESC LIMIT 1
      ) latest ON true
      WHERE r.tenant_id = m.tenant_id AND r.program_id = m.program_id AND r.active = true
        AND (p.reward_id IS NULL OR r.id = p.reward_id)
        AND latest.cost > m.balance
    ) reward_gap ON true`;

  let join = "";
  let predicate: string;
  switch (definition.kind) {
    case "new": predicate = "m.created_at >= p.cutoff"; break;
    case "recently_active": join = activityJoin; predicate = "activity.last_at >= p.cutoff"; break;
    case "inactive": join = activityJoin; predicate = "activity.last_at IS NOT NULL AND activity.last_at < p.cutoff"; break;
    case "frequent_visitors": join = activityJoin; predicate = "activity.recent_count >= p.min_checkouts"; break;
    case "close_to_reward": join = rewardJoin; predicate = "reward_gap.remaining BETWEEN 1 AND p.max_remaining"; break;
  }

  const result = await pool.query<SegmentRow>(`
    WITH params AS (
      SELECT $1::uuid AS tenant_id, $2::uuid AS program_id, $3::timestamptz AS as_of,
        $4::timestamptz AS cutoff, $5::int AS min_checkouts, $6::int AS max_remaining,
        $7::uuid AS reward_id, $8::uuid AS cursor_id, $9::int AS page_limit
    ), eligible AS (
      SELECT m.id FROM memberships m CROSS JOIN params p ${join}
      WHERE m.tenant_id = p.tenant_id AND m.program_id = p.program_id AND m.closed_at IS NULL
        AND m.created_at <= p.as_of AND ${predicate}
    ), totals AS (
      SELECT count(*)::int AS total FROM eligible
    ), page AS (
      SELECT id FROM eligible WHERE ((SELECT cursor_id FROM params) IS NULL OR id > (SELECT cursor_id FROM params))
      ORDER BY id LIMIT (SELECT page_limit FROM params)
    )
    SELECT totals.total, page.id AS "membershipId"
    FROM totals LEFT JOIN page ON true ORDER BY page.id
  `, [
    staff.tenantId, program.id, asOf, cutoff,
    definition.kind === "frequent_visitors" ? definition.minCheckouts : 0,
    definition.kind === "close_to_reward" ? definition.maxRemaining : 0,
    definition.kind === "close_to_reward" ? definition.rewardId ?? null : null,
    input.afterMembershipId ?? null, input.limit + 1,
  ]);
  const ids = result.rows.map(row => row.membershipId).filter((id): id is string => id !== null);
  const hasMore = ids.length > input.limit;
  const membershipIds = ids.slice(0, input.limit);
  return {
    total: result.rows[0]?.total ?? 0,
    membershipIds,
    nextCursor: hasMore ? membershipIds.at(-1)! : null,
    asOf: asOf.toISOString(),
    countingRule: QUALIFYING_CHECKOUT_RULE,
  };
}

/** Resolve a public programme slug, then apply the same staff and tenant checks. */
export async function selectAudienceBySlug(raw: SlugAudienceQuery): Promise<AudienceResult> {
  const { programSlug, ...query } = raw;
  const slug = z.string().min(1).max(120).parse(programSlug);
  const [program] = await db.select({ id: programs.id }).from(programs).where(eq(programs.slug, slug)).limit(1);
  if (!program) throw new DomainError("NOT_FOUND", "Programme not found in your scope");
  return selectAudience({ ...query, programId: program.id });
}
