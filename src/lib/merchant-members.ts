import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { locations, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";
import { formatCardLocator, parseCardLocator } from "./card-locator";
import { RETENTION_DAYS, retentionJoins, retentionPredicate, type RetentionDays, type RetentionFilter } from "./retention";

const memberLimit = 25;
const timelineLimit = 30;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Scope = { tenantId: string; locationId: string | null };
type Cursor = { at: string; id: string };
type ReferralStatus = "none" | "pending" | "qualified" | "review" | "rejected" | "reversed";
type MemberRow = {
  id: string; programId: string; programName: string; programType: "stamp" | "points";
  earningMode: "manual" | "purchase"; programStatus: string; programStarted: boolean; locationId: string; locationName: string;
  balance: number; cardLocator: string; createdAt: Date; closedAt: Date | null;
  qualifyingCheckouts: number; firstQualifyingAt: Date | null; lastQualifyingAt: Date | null;
  activityCount: number; redemptionCount: number; purchaseCount: number; emailMarketingEligible: boolean; cursorAt: string;
  referralStatus: ReferralStatus; qualifiedReferrals: number;
};
type TimelineRow = {
  id: string; kind: "award" | "redeem" | "reversal"; delta: number; source: string;
  createdAt: Date; cursorAt: string; reversalOfId: string | null; reversed: boolean; rewardTitle: string | null; reason: string | null;
};
type RewardRow = { id: string; title: string; cost: number };

export type MerchantMember = {
  id: string; pseudonym: string; cardLocator: string; programName: string; programType: "stamp" | "points";
  locationId: string; locationName: string; balance: number; createdAt: string; closedAt: string | null;
  qualifyingCheckouts: number; firstQualifyingAt: string | null; lastQualifyingAt: string | null;
  activityCount: number; redemptionCount: number; purchaseCount: number | null;
  referralStatus: ReferralStatus; qualifiedReferrals: number;
  emailMarketingEligible: boolean;
  eligibility: "eligible" | "not_yet" | "not_configured" | "closed" | "unavailable" | "not_checked";
};
export type MerchantMemberList = { members: MerchantMember[]; nextCursor: string | null };
export type MerchantMemberDetail = {
  member: MerchantMember;
  eligibleRewards: RewardRow[];
  timeline: Array<{ id: string; kind: TimelineRow["kind"]; delta: number; source: string; createdAt: string; reversalOfId: string | null; reversed: boolean; rewardTitle: string | null; reason: string | null }>;
  nextCursor: string | null;
};

async function memberScope(actorUserId: string): Promise<Scope> {
  const [staff] = await db.select({ tenantId: staffRoles.tenantId, role: staffRoles.role, locationId: staffRoles.locationId })
    .from(staffRoles).where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.active, true))).limit(1);
  if (!staff || (staff.role !== "owner" && staff.role !== "manager") || (staff.role === "manager" && !staff.locationId)) {
    throw new DomainError("FORBIDDEN", "Owner or manager access required");
  }
  return { tenantId: staff.tenantId, locationId: staff.role === "manager" ? staff.locationId : null };
}

function decodeCursor(raw?: string): Cursor | null {
  if (!raw) return null;
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new DomainError("INVALID_CURSOR", "Invalid page cursor");
  try {
    const decoded: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || typeof decoded[1] !== "string" || !uuidPattern.test(decoded[1])) throw new Error("shape");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(decoded[0]) ||
      new Date(decoded[0]).toISOString() !== `${decoded[0].slice(0, 23)}Z`) throw new Error("date");
    return { at: decoded[0], id: decoded[1] };
  } catch { throw new DomainError("INVALID_CURSOR", "Invalid page cursor"); }
}

function encodeCursor(row: { cursorAt: string; id: string }) {
  return Buffer.from(JSON.stringify([row.cursorAt, row.id])).toString("base64url");
}

function iso(value: Date | null) { return value ? value.toISOString() : null; }

function memberView(row: MemberRow, eligibility: MerchantMember["eligibility"] = "not_checked"): MerchantMember {
  return {
    id: row.id,
    pseudonym: `Karte ${formatCardLocator(row.cardLocator)}`,
    cardLocator: formatCardLocator(row.cardLocator),
    programName: row.programName,
    programType: row.programType,
    locationId: row.locationId,
    locationName: row.locationName,
    balance: row.balance,
    createdAt: row.createdAt.toISOString(),
    closedAt: iso(row.closedAt),
    qualifyingCheckouts: row.qualifyingCheckouts,
    firstQualifyingAt: iso(row.firstQualifyingAt),
    lastQualifyingAt: iso(row.lastQualifyingAt),
    activityCount: row.activityCount,
    redemptionCount: row.redemptionCount,
    purchaseCount: row.earningMode === "purchase" ? row.purchaseCount : null,
    referralStatus: row.referralStatus,
    qualifiedReferrals: row.qualifiedReferrals,
    emailMarketingEligible: row.emailMarketingEligible,
    eligibility: row.closedAt ? "closed" : eligibility,
  };
}

// One non-reversed online or reconciled offline staff award request represents one recorded checkout,
// independent of quantity. Purchase amounts and physical visits are not stored.
const activitySummary = `
  SELECT
    count(e.id)::int AS "activityCount",
    count(DISTINCT e.request_id) FILTER (WHERE e.kind = 'award' AND e.source in ('staff_online','staff_offline')
      AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id))::int AS "qualifyingCheckouts",
    min(e.created_at) FILTER (WHERE e.kind = 'award' AND e.source in ('staff_online','staff_offline')
      AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id)) AS "firstQualifyingAt",
    max(e.created_at) FILTER (WHERE e.kind = 'award' AND e.source in ('staff_online','staff_offline')
      AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id)) AS "lastQualifyingAt",
    count(e.id) FILTER (WHERE e.kind = 'redeem'
      AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id))::int AS "redemptionCount",
    count(DISTINCT e.request_id) FILTER (WHERE pa.ledger_entry_id IS NOT NULL AND e.kind = 'award' AND e.source in ('staff_online','staff_offline')
      AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id))::int AS "purchaseCount"
  FROM ledger_entries e LEFT JOIN purchase_awards pa ON pa.tenant_id = e.tenant_id AND pa.ledger_entry_id = e.id
  WHERE e.tenant_id = page.tenant_id AND e.membership_id = page.id
`;

const memberFields = `
  page.id, page."programId", page."programName", page."programType", page."earningMode", page."programStatus", page."programStarted",
  page."locationId", page."locationName", page.balance, page."cardLocator", page."createdAt", page."closedAt", page."cursorAt",
  summary."qualifyingCheckouts", summary."firstQualifyingAt", summary."lastQualifyingAt", summary."activityCount", summary."redemptionCount", summary."purchaseCount",
  COALESCE((
    SELECT referral.status FROM referrals referral
    WHERE referral.tenant_id = page.tenant_id AND referral.referred_membership_id = page.id
  ), 'none') AS "referralStatus",
  (SELECT count(*)::int FROM referrals referral
    WHERE referral.tenant_id = page.tenant_id AND referral.referrer_membership_id = page.id
      AND referral.status = 'qualified') AS "qualifiedReferrals",
  EXISTS (
    SELECT 1 FROM membership_contacts contact
    WHERE contact.tenant_id = page.tenant_id AND contact.membership_id = page.id AND page."closedAt" IS NULL
      AND contact.email IS NOT NULL AND contact.email_verified = true
      AND (SELECT consent.granted FROM consent_events consent
        WHERE consent.tenant_id = page.tenant_id AND consent.membership_id = page.id
          AND consent.channel = 'email' AND consent.purpose = 'marketing'
        ORDER BY consent.created_at DESC, consent.id DESC LIMIT 1) = true
  ) AS "emailMarketingEligible"
`;

export type MemberActivityFilter = "all" | "recorded" | "none" | RetentionFilter;
const RETENTION_FILTERS: RetentionFilter[] = ["recent", "drifting", "never", "near_reward", "reward_ready"];

export async function listMerchantMembers(actorUserId: string, options: { locationId?: string | null; minAgeDays?: 0 | 7; status?: "active" | "closed" | "all"; activity?: MemberActivityFilter; inactiveDays?: RetentionDays; query?: string; cursor?: string; limit?: number }): Promise<MerchantMemberList> {
  const scope = await memberScope(actorUserId);
  if (options.locationId) {
    if (!uuidPattern.test(options.locationId) || (scope.locationId && options.locationId !== scope.locationId)) {
      throw new DomainError("NOT_FOUND", "Location not found in your scope");
    }
    const [location] = await db.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.id, options.locationId), eq(locations.tenantId, scope.tenantId))).limit(1);
    if (!location) throw new DomainError("NOT_FOUND", "Location not found in your scope");
    scope.locationId = location.id;
  }
  const minAgeDays = options.minAgeDays ?? 0;
  if (minAgeDays !== 0 && minAgeDays !== 7) throw new DomainError("INVALID_FILTER", "Invalid minimum card age");
  const activity = options.activity ?? "all";
  if (!["all", "recorded", "none", ...RETENTION_FILTERS].includes(activity)) throw new DomainError("INVALID_FILTER", "Invalid activity filter");
  const retention = RETENTION_FILTERS.includes(activity as RetentionFilter) ? activity as RetentionFilter : null;
  const usesCutoff = retention === "recent" || retention === "drifting";
  // Retention states describe open cards only, so they imply the "active" card status.
  const status = retention ? "active" : options.status ?? "all";
  if (!["all", "active", "closed"].includes(status)) throw new DomainError("INVALID_FILTER", "Invalid card status filter");
  const inactiveDays = options.inactiveDays ?? 30;
  if (!RETENTION_DAYS.includes(inactiveDays)) throw new DomainError("INVALID_FILTER", "Choose 14, 30, 60 or 90 days");
  const raw = options.query?.trim().toLowerCase() || null;
  // A card locator ("K-7QX2MA") matches exactly; otherwise the query is a prefix of the internal card ID.
  const locator = raw ? parseCardLocator(raw) : null;
  const query = raw && !locator ? raw : null;
  if (query && !/^[0-9a-f-]{3,36}$/.test(query)) throw new DomainError("INVALID_QUERY", "Search with a card locator or at least three characters from a card ID");
  const cursor = decodeCursor(options.cursor);
  const limit = options.limit === undefined ? memberLimit : Math.max(1, Math.min(memberLimit, Math.trunc(options.limit)));
  const rows = await pool.query<MemberRow>(`
    WITH page AS (
      SELECT m.id, m.tenant_id, m.balance, m.card_locator AS "cardLocator", m.created_at AS "createdAt", m.closed_at AS "closedAt",
        p.id AS "programId", p.name AS "programName", p.type AS "programType", p.status AS "programStatus",
        p.earning_mode AS "earningMode", (p.effective_at <= now()) AS "programStarted", l.id AS "locationId", l.name AS "locationName",
        to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
      FROM memberships m
      JOIN programs p ON p.id = m.program_id AND p.tenant_id = m.tenant_id
      JOIN locations l ON l.id = p.location_id AND l.tenant_id = m.tenant_id
      ${retention ? retentionJoins("now()") : ""}
      WHERE m.tenant_id = $1 AND ($2::uuid IS NULL OR p.location_id = $2)
        ${retention ? `AND p.status = 'active' AND m.created_at <= now() AND ${retentionPredicate(retention, "(now() - $10::int * interval '24 hours')")}` : ""}
        ${minAgeDays ? "AND m.created_at < now() - interval '168 hours'" : ""}
        AND ($3::text = 'all' OR ($3 = 'active' AND m.closed_at IS NULL) OR ($3 = 'closed' AND m.closed_at IS NOT NULL))
        AND ($4::text IS NULL OR m.id::text LIKE $4)
        AND ($9::text IS NULL OR m.card_locator = $9)
        AND ($5::text NOT IN ('recorded', 'none') OR ($5 = 'recorded') = EXISTS (
          SELECT 1 FROM ledger_entries activity WHERE activity.tenant_id = m.tenant_id AND activity.membership_id = m.id
            AND activity.kind = 'award' AND activity.source in ('staff_online','staff_offline')
            AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = activity.tenant_id AND undo.reversal_of_id = activity.id)
        ))
        AND ($6::timestamptz IS NULL OR (m.created_at, m.id) < ($6, $7::uuid))
      ORDER BY m.created_at DESC, m.id DESC LIMIT $8
    )
    SELECT ${memberFields} FROM page LEFT JOIN LATERAL (${activitySummary}) summary ON true
    ORDER BY page."createdAt" DESC, page.id DESC
  `, [scope.tenantId, scope.locationId, status, query ? `${query}%` : null, activity, cursor?.at ?? null, cursor?.id ?? null, limit + 1, locator, ...(usesCutoff ? [inactiveDays] : [])]);
  const hasMore = rows.rows.length > limit;
  const page = rows.rows.slice(0, limit);
  return { members: page.map(row => memberView(row)), nextCursor: hasMore ? encodeCursor(page.at(-1)!) : null };
}

export async function getMerchantMember(actorUserId: string, membershipId: string, options: { cursor?: string; limit?: number } = {}): Promise<MerchantMemberDetail> {
  const scope = await memberScope(actorUserId);
  if (!uuidPattern.test(membershipId)) throw new DomainError("NOT_FOUND", "Card not found");
  const cursor = decodeCursor(options.cursor);
  const limit = options.limit === undefined ? timelineLimit : Math.max(1, Math.min(timelineLimit, Math.trunc(options.limit)));
  const selected = await pool.query<MemberRow>(`
    WITH page AS (
      SELECT m.id, m.tenant_id, m.balance, m.card_locator AS "cardLocator", m.created_at AS "createdAt", m.closed_at AS "closedAt",
        p.id AS "programId", p.name AS "programName", p.type AS "programType", p.status AS "programStatus",
        p.earning_mode AS "earningMode", (p.effective_at <= now()) AS "programStarted", l.id AS "locationId", l.name AS "locationName",
        to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
      FROM memberships m
      JOIN programs p ON p.id = m.program_id AND p.tenant_id = m.tenant_id
      JOIN locations l ON l.id = p.location_id AND l.tenant_id = m.tenant_id
      WHERE m.tenant_id = $1 AND m.id = $2 AND ($3::uuid IS NULL OR p.location_id = $3)
    )
    SELECT ${memberFields} FROM page LEFT JOIN LATERAL (${activitySummary}) summary ON true
  `, [scope.tenantId, membershipId, scope.locationId]);
  const row = selected.rows[0];
  if (!row) throw new DomainError("NOT_FOUND", "Card not found");

  const entries = await pool.query<TimelineRow>(`
    SELECT e.id, e.kind, e.delta, e.source, e.created_at AS "createdAt",
      to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt", e.reversal_of_id AS "reversalOfId",
      r.reward_title AS "rewardTitle", CASE WHEN e.kind = 'reversal' THEN e.reason END AS reason, EXISTS (
        SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id
      ) AS reversed
    FROM ledger_entries e
    LEFT JOIN redemptions r ON r.tenant_id = e.tenant_id AND r.ledger_entry_id = e.id
    WHERE e.tenant_id = $1 AND e.membership_id = $2
      AND ($3::timestamptz IS NULL OR (e.created_at, e.id) < ($3, $4::uuid))
    ORDER BY e.created_at DESC, e.id DESC LIMIT $5
  `, [scope.tenantId, row.id, cursor?.at ?? null, cursor?.id ?? null, limit + 1]);
  const hasMore = entries.rows.length > limit;
  const timelinePage = entries.rows.slice(0, limit);

  let eligibleRewards: RewardRow[] = [];
  let eligibility: MerchantMember["eligibility"] = "unavailable";
  if (!row.closedAt && row.programStatus === "active" && row.programStarted) {
    const available = await pool.query<RewardRow>(`
      SELECT current_version.id, current_version.title, current_version.cost
      FROM rewards r
      JOIN LATERAL (
        SELECT rv.id, rv.title, rv.cost FROM reward_versions rv
        WHERE rv.tenant_id = r.tenant_id AND rv.reward_id = r.id AND rv.effective_at <= now()
        ORDER BY rv.version DESC LIMIT 1
      ) current_version ON true
      WHERE r.tenant_id = $1 AND r.program_id = $2 AND r.active = true
      ORDER BY r.sort_order, r.id
    `, [scope.tenantId, row.programId]);
    eligibleRewards = available.rows.filter(reward => reward.cost <= row.balance);
    eligibility = available.rows.length === 0 ? "not_configured" : eligibleRewards.length ? "eligible" : "not_yet";
  }
  return {
    member: memberView(row, eligibility),
    eligibleRewards,
    timeline: timelinePage.map(entry => ({ id: entry.id, kind: entry.kind, delta: entry.delta, source: entry.source, createdAt: entry.createdAt.toISOString(), reversalOfId: entry.reversalOfId, reversed: entry.reversed, rewardTitle: entry.rewardTitle, reason: entry.reason })),
    nextCursor: hasMore ? encodeCursor(timelinePage.at(-1)!) : null,
  };
}
