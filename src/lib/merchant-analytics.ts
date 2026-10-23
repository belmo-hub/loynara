import { pool } from "@/db";
import type { PoolClient } from "pg";
import { DomainError } from "./loyalty";

export type AnalyticsWindowDays = 30 | 90;
/** W is 7 only for the weekly owner report's exact calendar week. */
export type MerchantAnalytics<W extends number = AnalyticsWindowDays> = {
  windowDays: W;
  from: string;
  asOf: string;
  timezone: "UTC";
  currentActiveCards: number;
  newCards: number;
  qualifyingCheckouts: number;
  participatingCards: number;
  repeatCards: number;
  /** Cards with a counted award whose previous counted award was at least 21 days earlier. */
  wonBack: number;
  issued: { stampUnits: number; pointUnits: number; awardActions: number };
  rewards: { redemptions: number; topTitles: Array<{ title: string; count: number }> };
  referrals: { attributed: number; qualified: number; reversed: number };
  campaignAttempts: { total: number; complete: number; suppressed: number; retry: number; failed: number; blocked: number };
  locationActivity: Array<{ locationId: string; name: string; awardActions: number; stampUnits: number; pointUnits: number }>;
  staffActivity: Array<{ userId: string; name: string; awardActions: number; stampUnits: number; pointUnits: number }>;
  series: Array<{ from: string; to: string; newCards: number; checkouts: number }>;
  countingRule: string;
  limits: { availableWindowsDays: [30, 90]; bucketDays: 7; topRewardTitles: 5 };
};

type MembershipCounts = { currentActiveCards: number; newCards: number };
type CheckoutCounts = { qualifyingCheckouts: number; participatingCards: number; repeatCards: number; stampUnits: number; pointUnits: number; awardActions: number };
type RedemptionCounts = { redemptions: number };
type TopTitle = { title: string; count: number };
type AttemptCounts = { status: string; count: number };
type ReferralCounts = { attributed: number; qualified: number; reversed: number };
type BucketCount = { bucket: number; count: number };

// A checkout is one distinct server-accepted staff-award request on one card. All entries for a
// request must be reversed to stop that checkout counting; partial corrections
// continue to count the accepted checkout. Seed/referral credits never count.
const checkoutCte = `
  WITH accepted_awards AS (
    SELECT e.membership_id, e.request_id, e.created_at, e.delta, e.actor_user_id, e.location_id, p.type
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
  snapshot?: PoolClient,
): Promise<MerchantAnalytics> {
  if (options.windowDays !== 30 && options.windowDays !== 90) {
    throw new DomainError("INVALID_WINDOW", "Choose a 30 or 90 day window");
  }
  return inSnapshot(snapshot, async client => {
    // Ledger timestamps are assigned by PostgreSQL. Use its clock for live
    // reports so a freshly committed redemption cannot fall just after a host
    // clock that is slightly behind the database.
    const asOf = options.asOf ?? (await client.query<{ as_of: Date }>("SELECT now() AS as_of")).rows[0].as_of;
    if (!Number.isFinite(asOf.getTime())) throw new DomainError("INVALID_WINDOW", "Invalid report time");
    const [owner] = (await client.query<{ tenantId: string }>(
      `SELECT tenant_id AS "tenantId" FROM staff_roles WHERE user_id = $1 AND role = 'owner' AND active = true LIMIT 1`,
      [actorUserId],
    )).rows;
    if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
    return readAnalytics(client, owner.tenantId, new Date(asOf.getTime() - options.windowDays * 86_400_000), asOf, options.windowDays);
  });
}

/** The same figures for an exact [from, to) window, e.g. a Berlin calendar week. Callers check access themselves. */
export function getTenantWindowAnalytics(tenantId: string, from: Date, to: Date) {
  return inSnapshot(undefined, client => readAnalytics(client, tenantId, from, to, 7));
}

async function inSnapshot<T>(snapshot: PoolClient | undefined, read: (client: PoolClient) => Promise<T>): Promise<T> {
  if (snapshot) return read(snapshot);
  const client = await pool.connect();
  let discardClient = false;
  try {
    // Related aggregates and their labels describe the same committed state.
    // Read-only MVCC neither locks award writers nor calls providers.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
    const result = await read(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discardClient = true; }
    throw error;
  } finally {
    client.release(discardClient);
  }
}

async function readAnalytics<W extends number>(client: PoolClient, tenantId: string, from: Date, asOf: Date, windowDays: W): Promise<MerchantAnalytics<W>> {
    const params = [tenantId, from, asOf];
    const [members, checkout, redemption, titles, attempts, referralCounts, membershipBuckets, checkoutBuckets, staffActivity, locationActivity, wonBack] = await Promise.all([
      client.query<MembershipCounts>(`
        SELECT
          count(*) FILTER (WHERE created_at < $3 AND (closed_at IS NULL OR closed_at >= $3))::int AS "currentActiveCards",
          count(*) FILTER (WHERE created_at >= $2 AND created_at < $3)::int AS "newCards"
        FROM memberships WHERE tenant_id = $1
      `, params),
      client.query<CheckoutCounts>(`${checkoutCte}, per_card AS (
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
      client.query<RedemptionCounts>(`
        SELECT count(*)::int AS redemptions FROM ledger_entries e
        WHERE e.tenant_id = $1 AND e.kind = 'redeem' AND e.created_at >= $2 AND e.created_at < $3
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id
              AND undo.reversal_of_id = e.id AND undo.created_at < $3
          )
      `, params),
      client.query<TopTitle>(`
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
      client.query<AttemptCounts>(`
        SELECT status, count(*)::int AS count FROM campaign_attempts
        WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
        GROUP BY status
      `, params),
      client.query<ReferralCounts>(`
        SELECT
          count(*) FILTER (WHERE created_at >= $2 AND created_at < $3)::int AS attributed,
          count(*) FILTER (WHERE qualified_at >= $2 AND qualified_at < $3)::int AS qualified,
          count(*) FILTER (WHERE reversed_at >= $2 AND reversed_at < $3)::int AS reversed
        FROM referrals WHERE tenant_id = $1
      `, params),
      client.query<BucketCount>(`
        SELECT floor(extract(epoch FROM (created_at - $2::timestamptz)) / 604800)::int AS bucket,
          count(*)::int AS count
        FROM memberships WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
        GROUP BY bucket
      `, params),
      client.query<BucketCount>(`${checkoutCte}, checkout_first AS (
        SELECT membership_id, request_id, min(created_at) AS first_at
        FROM accepted_awards GROUP BY membership_id, request_id
      )
        SELECT floor(extract(epoch FROM (first_at - $2::timestamptz)) / 604800)::int AS bucket,
          count(*)::int AS count
        FROM checkout_first GROUP BY bucket
      `, params),
      client.query<MerchantAnalytics["staffActivity"][number]>(`${checkoutCte}
        SELECT a.actor_user_id AS "userId", u.name,
          count(*)::int AS "awardActions",
          coalesce(sum(a.delta) FILTER (WHERE a.type = 'stamp'), 0)::int AS "stampUnits",
          coalesce(sum(a.delta) FILTER (WHERE a.type = 'points'), 0)::int AS "pointUnits"
        FROM accepted_awards a JOIN "user" u ON u.id = a.actor_user_id
        GROUP BY a.actor_user_id, u.name ORDER BY u.name, a.actor_user_id
      `, params),
      client.query<MerchantAnalytics["locationActivity"][number]>(`${checkoutCte}, activity AS (
        SELECT location_id, count(*)::int AS award_actions,
          coalesce(sum(delta) FILTER (WHERE type = 'stamp'), 0)::int AS stamp_units,
          coalesce(sum(delta) FILTER (WHERE type = 'points'), 0)::int AS point_units
        FROM accepted_awards GROUP BY location_id
      )
        SELECT l.id AS "locationId", l.name,
          coalesce(a.award_actions, 0)::int AS "awardActions",
          coalesce(a.stamp_units, 0)::int AS "stampUnits",
          coalesce(a.point_units, 0)::int AS "pointUnits"
        FROM locations l LEFT JOIN activity a ON a.location_id = l.id
        WHERE l.tenant_id = $1 ORDER BY l.name, l.id
      `, params),
      // Won back: a counted award in the window whose card's previous counted award was 21 days (504 hours) or more
      // earlier. Hours, not days, so the gap does not depend on the session time zone or a DST change.
      client.query<{ wonBack: number }>(`${checkoutCte}
        SELECT count(DISTINCT a.membership_id)::int AS "wonBack"
        FROM accepted_awards a
        CROSS JOIN LATERAL (
          SELECT max(e.created_at) AS previous_at FROM ledger_entries e
          WHERE e.tenant_id = $1 AND e.membership_id = a.membership_id AND e.created_at < a.created_at
            AND e.kind = 'award' AND e.source in ('staff_online','staff_offline')
            AND NOT EXISTS (
              SELECT 1 FROM ledger_entries undo
              WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id AND undo.created_at < $3
            )
        ) previous
        WHERE previous.previous_at <= a.created_at - interval '504 hours'
      `, params),
    ]);

    const perBucketCards = new Map(membershipBuckets.rows.map(row => [row.bucket, row.count]));
    const perBucketCheckouts = new Map(checkoutBuckets.rows.map(row => [row.bucket, row.count]));
    const series = Array.from({ length: Math.ceil(windowDays / 7) }, (_, index) => ({
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
      windowDays, from: from.toISOString(), asOf: asOf.toISOString(), timezone: "UTC",
      currentActiveCards: members.rows[0].currentActiveCards,
      newCards: members.rows[0].newCards,
      qualifyingCheckouts: checkout.rows[0].qualifyingCheckouts,
      participatingCards: checkout.rows[0].participatingCards,
      repeatCards: checkout.rows[0].repeatCards,
      wonBack: wonBack.rows[0].wonBack,
      issued: {
        stampUnits: checkout.rows[0].stampUnits,
        pointUnits: checkout.rows[0].pointUnits,
        awardActions: checkout.rows[0].awardActions,
      },
      rewards: { redemptions: redemption.rows[0].redemptions, topTitles: titles.rows },
      referrals: referralCounts.rows[0],
      campaignAttempts: attemptCount,
      series,
      staffActivity: staffActivity.rows,
      locationActivity: locationActivity.rows,
      countingRule: "Eine Buchung zählt, wenn dein Team sie bestätigt hat und sie nicht vollständig korrigiert wurde. Offline gemachte Buchungen zählen erst, wenn sie übertragen sind. Wiederkehrend heißt: mindestens zwei solche Buchungen im gewählten Zeitraum. Zurückgewonnen heißt: eine Buchung mindestens 21 Tage nach der vorherigen derselben Karte. Stempel und Punkte zählen getrennt. Bei Empfehlungen zählt jeder Schritt (Anmeldung, Bonus, Korrektur) an seinem eigenen Tag.",
      limits: { availableWindowsDays: [30, 90], bucketDays: 7, topRewardTitles: 5 },
    };
}

export type SpendFigures = {
  /** Counted visits: distinct staff-award requests per card, as in the checkout rule above. */
  visits: number;
  /** Confirmed purchase amounts plus, for visits without one, the programme's average; integer minor units. */
  spentMinor: number;
  realMinor: number;
  estimatedMinor: number;
  /** Visits without a purchase amount whose programme has no average entered: counted, not priced. */
  unpricedVisits: number;
  averagePerVisitMinor: number | null;
  /** Spend of cards that joined inside the window; null for the since-start figure. */
  newCardMinor: number | null;
  returningCardMinor: number | null;
};
export type MerchantSpend = {
  asOf: string;
  currency: string;
  overall: { recent: SpendFigures; total: SpendFigures };
  locations: Array<{ locationId: string; name: string; recentFrom: string; recent: SpendFigures; total: SpendFigures }>;
};
type SpendRow = { locationId: string; name: string; recentFrom: Date; period: "recent" | "total"; visits: number; pricedVisits: number; estimatedVisits: number; realMinor: string; estimatedMinor: string; newCardMinor: string };
type SpendSums = { visits: number; priced: number; estimated: number; real: bigint; estimatedMinor: bigint; newCard: bigint | null };

export const SPEND_RECENT_DAYS = 30;
const ZERO = BigInt(0), TWO = BigInt(2);

/**
 * "Spent by your Loynara customers" for the last 30 local calendar days (today and the 29 before, in each location's
 * time zone, so a DST change moves no visit across the edge) and since the start. Real amounts come from the purchase
 * row of each counted, uncorrected award; a reversal removes its entry's amount, so a corrected-and-rebooked purchase
 * counts the rebooked amount. Bonus sources never count. Visits without a purchase row are estimated with the
 * programme's average (null = counted but unpriced).
 */
export async function getMerchantSpend(actorUserId: string, options: { asOf?: Date } = {}): Promise<MerchantSpend> {
  return inSnapshot(undefined, async client => {
    const asOf = options.asOf ?? (await client.query<{ as_of: Date }>("SELECT now() AS as_of")).rows[0].as_of;
    if (!Number.isFinite(asOf.getTime())) throw new DomainError("INVALID_WINDOW", "Invalid report time");
    const [owner] = (await client.query<{ tenantId: string; currency: string }>(
      `SELECT r.tenant_id AS "tenantId", t.currency FROM staff_roles r JOIN tenants t ON t.id = r.tenant_id
       WHERE r.user_id = $1 AND r.role = 'owner' AND r.active = true LIMIT 1`,
      [actorUserId],
    )).rows;
    if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
    const { rows } = await client.query<SpendRow>(`
      WITH loc AS (
        SELECT l.id, l.name,
          (((($2::timestamptz AT TIME ZONE l.timezone)::date - ${SPEND_RECENT_DAYS - 1})::timestamp) AT TIME ZONE l.timezone) AS recent_from
        FROM locations l WHERE l.tenant_id = $1
      ), counted AS (
        SELECT e.location_id, e.membership_id, e.request_id, e.created_at, m.created_at AS card_created_at,
          pa.amount_minor, p.average_visit_spend_minor AS average
        FROM ledger_entries e
        JOIN memberships m ON m.tenant_id = e.tenant_id AND m.id = e.membership_id
        JOIN programs p ON p.tenant_id = m.tenant_id AND p.id = m.program_id
        LEFT JOIN purchase_awards pa ON pa.tenant_id = e.tenant_id AND pa.ledger_entry_id = e.id
        WHERE e.tenant_id = $1 AND e.created_at < $2
          AND e.kind = 'award' AND e.source in ('staff_online','staff_offline')
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entries undo
            WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id AND undo.created_at < $2
          )
      ), visits AS (
        SELECT location_id, min(created_at) AS at, min(card_created_at) AS card_created_at,
          sum(amount_minor)::bigint AS real_minor, max(average) AS average
        FROM counted GROUP BY location_id, membership_id, request_id
      )
      SELECT l.id AS "locationId", l.name, l.recent_from AS "recentFrom", w.period,
        count(v.at)::int AS visits,
        count(v.real_minor)::int AS "pricedVisits",
        count(v.average) FILTER (WHERE v.real_minor IS NULL)::int AS "estimatedVisits",
        coalesce(sum(v.real_minor), 0)::bigint::text AS "realMinor",
        coalesce(sum(v.average) FILTER (WHERE v.real_minor IS NULL), 0)::bigint::text AS "estimatedMinor",
        coalesce(sum(coalesce(v.real_minor, v.average)) FILTER (WHERE v.card_created_at >= l.recent_from), 0)::bigint::text AS "newCardMinor"
      FROM loc l
      CROSS JOIN (VALUES ('recent'), ('total')) w(period)
      LEFT JOIN visits v ON v.location_id = l.id AND (w.period = 'total' OR v.at >= l.recent_from)
      GROUP BY l.id, l.name, l.recent_from, w.period
      ORDER BY l.name, l.id, w.period
    `, [owner.tenantId, asOf]);

    const sums = (list: SpendRow[], period: SpendRow["period"]): SpendSums => list.filter(row => row.period === period).reduce<SpendSums>((sum, row) => ({
      visits: sum.visits + row.visits, priced: sum.priced + row.pricedVisits, estimated: sum.estimated + row.estimatedVisits,
      real: sum.real + BigInt(row.realMinor), estimatedMinor: sum.estimatedMinor + BigInt(row.estimatedMinor),
      newCard: period === "recent" ? (sum.newCard ?? ZERO) + BigInt(row.newCardMinor) : null,
    }), { visits: 0, priced: 0, estimated: 0, real: ZERO, estimatedMinor: ZERO, newCard: null });
    const ids = [...new Set(rows.map(row => row.locationId))];
    return {
      asOf: asOf.toISOString(),
      currency: owner.currency,
      overall: { recent: spendFigures(sums(rows, "recent")), total: spendFigures(sums(rows, "total")) },
      locations: ids.map(id => {
        const own = rows.filter(row => row.locationId === id);
        return { locationId: id, name: own[0].name, recentFrom: own[0].recentFrom.toISOString(), recent: spendFigures(sums(own, "recent")), total: spendFigures(sums(own, "total")) };
      }),
    };
  });
}

function spendFigures(sum: SpendSums): SpendFigures {
  const spent = sum.real + sum.estimatedMinor;
  const pricedVisits = BigInt(sum.priced + sum.estimated);
  return {
    visits: sum.visits,
    spentMinor: Number(spent),
    realMinor: Number(sum.real),
    estimatedMinor: Number(sum.estimatedMinor),
    unpricedVisits: sum.visits - sum.priced - sum.estimated,
    // Integer half-up rounding over priced visits only, so unpriced visits do not pull the average down.
    averagePerVisitMinor: pricedVisits === ZERO ? null : Number((TWO * spent + pricedVisits) / (TWO * pricedVisits)),
    newCardMinor: sum.newCard === null ? null : Number(sum.newCard),
    returningCardMinor: sum.newCard === null ? null : Number(spent - sum.newCard),
  };
}
