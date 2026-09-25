import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";

export type AnalyticsWindowDays = 30 | 90;
export type MerchantAnalytics = {
  windowDays: AnalyticsWindowDays;
  from: string;
  asOf: string;
  timezone: "UTC";
  currentActiveCards: number;
  newCards: number;
  qualifyingCheckouts: number;
  participatingCards: number;
  repeatCards: number;
  issued: { stampUnits: number; pointUnits: number; awardActions: number };
  rewards: { redemptions: number; topTitles: Array<{ title: string; count: number }> };
  campaignAttempts: { total: number; complete: number; suppressed: number; retry: number; failed: number; blocked: number };
  series: Array<{ from: string; to: string; newCards: number; checkouts: number }>;
  countingRule: string;
  limits: { availableWindowsDays: [30, 90]; bucketDays: 7; topRewardTitles: 5 };
};

type MembershipCounts = { currentActiveCards: number; newCards: number };
type CheckoutCounts = { qualifyingCheckouts: number; participatingCards: number; repeatCards: number; stampUnits: number; pointUnits: number; awardActions: number };
type RedemptionCounts = { redemptions: number };
type TopTitle = { title: string; count: number };
type AttemptCounts = { status: string; count: number };
type BucketCount = { bucket: number; count: number };

// A checkout is one distinct server-accepted staff-award request on one card. All entries for a
// request must be reversed to stop that checkout counting; partial corrections
// continue to count the accepted checkout. Seed/referral credits never count.
const checkoutCte = `
  WITH accepted_awards AS (
    SELECT e.membership_id, e.request_id, e.created_at, e.delta, p.type
    FROM ledger_entries e
    JOIN memberships m ON m.tenant_id = e.tenant_id AND m.id = e.membership_id
    JOIN programs p ON p.tenant_id = m.tenant_id AND p.id = m.program_id
    WHERE e.tenant_id = $1 AND e.created_at >= $2 AND e.created_at < $3
      AND e.kind = 'award' AND e.source in ('staff_online','staff_offline')
      AND NOT EXISTS (
        SELECT 1 FROM ledger_entries undo
        WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id
          AND undo.created_at < $3
      )
  )`;

export async function getMerchantAnalytics(
  actorUserId: string,
  options: { windowDays: AnalyticsWindowDays; asOf?: Date },
): Promise<MerchantAnalytics> {
  if (options.windowDays !== 30 && options.windowDays !== 90) {
    throw new DomainError("INVALID_WINDOW", "Choose a 30 or 90 day window");
  }
  // Ledger timestamps are assigned by PostgreSQL. Use its clock for live
  // reports so a freshly committed redemption cannot fall just after a host
  // clock that is slightly behind the database.
  const asOf = options.asOf ?? (await pool.query<{ as_of: Date }>("SELECT now() AS as_of")).rows[0].as_of;
  if (!Number.isFinite(asOf.getTime())) throw new DomainError("INVALID_WINDOW", "Invalid report time");
  const [owner] = await db.select({ tenantId: staffRoles.tenantId }).from(staffRoles)
    .where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");

  const from = new Date(asOf.getTime() - options.windowDays * 86_400_000);
  const params = [owner.tenantId, from, asOf];
  const [members, checkout, redemption, titles, attempts, membershipBuckets, checkoutBuckets] = await Promise.all([
    pool.query<MembershipCounts>(`
      SELECT
        count(*) FILTER (WHERE created_at < $3 AND (closed_at IS NULL OR closed_at >= $3))::int AS "currentActiveCards",
        count(*) FILTER (WHERE created_at >= $2 AND created_at < $3)::int AS "newCards"
      FROM memberships WHERE tenant_id = $1
    `, params),
    pool.query<CheckoutCounts>(`${checkoutCte}, per_card AS (
      SELECT membership_id, count(DISTINCT request_id)::int AS checkouts
      FROM accepted_awards GROUP BY membership_id
    )
    SELECT
      (SELECT count(*) FROM (SELECT DISTINCT membership_id, request_id FROM accepted_awards) requests)::int AS "qualifyingCheckouts",
      (SELECT count(*) FROM per_card)::int AS "participatingCards",
      (SELECT count(*) FROM per_card WHERE checkouts >= 2)::int AS "repeatCards",
      coalesce((SELECT sum(delta) FROM accepted_awards WHERE type = 'stamp'), 0)::int AS "stampUnits",
      coalesce((SELECT sum(delta) FROM accepted_awards WHERE type = 'points'), 0)::int AS "pointUnits",
      (SELECT count(*) FROM accepted_awards)::int AS "awardActions"
    `, params),
    pool.query<RedemptionCounts>(`
      SELECT count(*)::int AS redemptions FROM ledger_entries e
      WHERE e.tenant_id = $1 AND e.kind = 'redeem' AND e.created_at >= $2 AND e.created_at < $3
        AND NOT EXISTS (
          SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id
            AND undo.reversal_of_id = e.id AND undo.created_at < $3
        )
    `, params),
    pool.query<TopTitle>(`
      SELECT r.reward_title AS title, count(*)::int AS count
      FROM ledger_entries e
      JOIN redemptions r ON r.tenant_id = e.tenant_id AND r.ledger_entry_id = e.id
      WHERE e.tenant_id = $1 AND e.kind = 'redeem' AND e.created_at >= $2 AND e.created_at < $3
        AND NOT EXISTS (
          SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id
            AND undo.reversal_of_id = e.id AND undo.created_at < $3
        )
      GROUP BY r.reward_title ORDER BY count DESC, r.reward_title LIMIT 5
    `, params),
    pool.query<AttemptCounts>(`
      SELECT status, count(*)::int AS count FROM campaign_attempts
      WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
      GROUP BY status
    `, params),
    pool.query<BucketCount>(`
      SELECT floor(extract(epoch FROM (created_at - $2::timestamptz)) / 604800)::int AS bucket,
        count(*)::int AS count
      FROM memberships WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
      GROUP BY bucket
    `, params),
    pool.query<BucketCount>(`${checkoutCte}, checkout_first AS (
      SELECT membership_id, request_id, min(created_at) AS first_at
      FROM accepted_awards GROUP BY membership_id, request_id
    )
      SELECT floor(extract(epoch FROM (first_at - $2::timestamptz)) / 604800)::int AS bucket,
        count(*)::int AS count
      FROM checkout_first GROUP BY bucket
    `, params),
  ]);

  const perBucketCards = new Map(membershipBuckets.rows.map(row => [row.bucket, row.count]));
  const perBucketCheckouts = new Map(checkoutBuckets.rows.map(row => [row.bucket, row.count]));
  const series = Array.from({ length: Math.ceil(options.windowDays / 7) }, (_, index) => ({
    from: new Date(from.getTime() + index * 7 * 86_400_000).toISOString(),
    to: new Date(Math.min(asOf.getTime(), from.getTime() + (index + 1) * 7 * 86_400_000)).toISOString(),
    newCards: perBucketCards.get(index) ?? 0,
    checkouts: perBucketCheckouts.get(index) ?? 0,
  }));
  const attemptCount = { total: 0, complete: 0, suppressed: 0, retry: 0, failed: 0, blocked: 0 };
  for (const row of attempts.rows) {
    if (row.status in attemptCount && row.status !== "total") {
      attemptCount[row.status as Exclude<keyof typeof attemptCount, "total">] = row.count;
      attemptCount.total += row.count;
    }
  }

  return {
    windowDays: options.windowDays, from: from.toISOString(), asOf: asOf.toISOString(), timezone: "UTC",
    currentActiveCards: members.rows[0].currentActiveCards,
    newCards: members.rows[0].newCards,
    qualifyingCheckouts: checkout.rows[0].qualifyingCheckouts,
    participatingCards: checkout.rows[0].participatingCards,
    repeatCards: checkout.rows[0].repeatCards,
    issued: {
      stampUnits: checkout.rows[0].stampUnits,
      pointUnits: checkout.rows[0].pointUnits,
      awardActions: checkout.rows[0].awardActions,
    },
    rewards: { redemptions: redemption.rows[0].redemptions, topTitles: titles.rows },
    campaignAttempts: attemptCount,
    series,
    countingRule: "Ein Kassenvorgang ist eine eindeutige Karten- und Anfragekennung mit mindestens einer nicht rückgängig gemachten, vom Server bestätigten Online- oder nachträglich synchronisierten Offline-Gutschrift. Ausstehende Offline-Vergaben zählen nicht. Wiederkehrend bedeutet mindestens zwei solche Kassenvorgänge im gewählten Zeitraum. Stempel und Punkte werden getrennt gezählt. Kampagnenwerte zählen Zustellversuche, keine Öffnungen.",
    limits: { availableWindowsDays: [30, 90], bucketDays: 7, topRewardTitles: 5 },
  };
}
