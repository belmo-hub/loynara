import { sql } from "drizzle-orm";
import { db } from "@/db";
import { closeMembershipInTransaction, lifecycleTransaction, validCardToken } from "./card-lifecycle";
import { DomainError } from "./loyalty";

// Staff corrections and someone else's referral bonus are not customer use.
const activity = sql`greatest(m.created_at,m.last_customer_activity_at,
  (SELECT max(l.created_at) FROM ledger_entries l WHERE l.tenant_id=m.tenant_id AND l.membership_id=m.id
    AND l.kind IN ('award','redeem') AND l.source NOT IN ('referral_bonus','staff_correction','synthetic_seed')))`;

export async function recordCustomerActivity(cardToken: string) {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  return lifecycleTransaction(async tx => {
    const result = await tx.execute(sql`SELECT id FROM memberships WHERE card_token=${cardToken} AND closed_at IS NULL FOR UPDATE`);
    if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Card not found");
    await tx.execute(sql`UPDATE memberships SET last_customer_activity_at=clock_timestamp() WHERE id=${result.rows[0].id}::uuid
      AND (last_customer_activity_at IS NULL OR last_customer_activity_at<now()-interval '1 hour')`);
    return { recorded: true };
  });
}

/** Bounded work. Each card commits independently, with only that card locked during archival. */
export async function reviewInactiveCards(batch = 50, deadlineAt = Date.now() + 90_000): Promise<{ closed: number; flagged: number; cleaned: number }> {
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 100) throw new Error("Invalid retention batch");
  if (!Number.isFinite(deadlineAt)) throw new Error("Invalid retention deadline");
  const rows = await db.execute(sql`SELECT m.id FROM memberships m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.closed_at IS NULL AND t.closed_at IS NULL AND m.balance=0 AND ${activity}<=now()-interval '24 months'
    ORDER BY m.id LIMIT ${batch}`);
  let closed = 0;
  for (const row of rows.rows) {
    // Leave time for the archive's complete timeout and subprocess cleanup before the job deadline.
    if (deadlineAt - Date.now() < 62_000) throw new Error("Inactivity review deadline exhausted");
    const didClose = await lifecycleTransaction(async tx => {
      const eligible = await tx.execute(sql`SELECT m.id FROM memberships m JOIN tenants t ON t.id=m.tenant_id
        WHERE m.id=${row.id}::uuid AND m.closed_at IS NULL AND t.closed_at IS NULL AND m.balance=0
          AND ${activity}<=now()-interval '24 months' FOR UPDATE OF m SKIP LOCKED`);
      if (!eligible.rows.length) return false;
      await closeMembershipInTransaction(tx, String(row.id));
      return true;
    });
    if (didClose) closed++;
  }
  if (Date.now() >= deadlineAt) throw new Error("Inactivity review deadline exhausted");
  return lifecycleTransaction(async tx => {
    const flagged = await tx.execute(sql`INSERT INTO inactivity_reviews(tenant_id,membership_id)
      SELECT m.tenant_id,m.id FROM memberships m JOIN tenants t ON t.id=m.tenant_id
      LEFT JOIN inactivity_reviews r ON r.tenant_id=m.tenant_id AND r.membership_id=m.id
      WHERE m.closed_at IS NULL AND t.closed_at IS NULL AND m.balance>0 AND ${activity}<=now()-interval '24 months'
        AND (r.membership_id IS NULL OR r.reviewed_at IS NOT NULL AND r.reviewed_at<=now()-interval '1 month' AND r.flagged_at<=r.reviewed_at)
      ORDER BY m.id LIMIT ${batch}
      ON CONFLICT(tenant_id,membership_id) DO UPDATE SET flagged_at=now() RETURNING membership_id`);
    const cleaned = await tx.execute(sql`WITH expired AS (
      SELECT r.tenant_id,r.membership_id FROM inactivity_reviews r JOIN memberships m ON r.membership_id=m.id AND r.tenant_id=m.tenant_id
      WHERE m.closed_at IS NOT NULL OR m.balance=0 OR ${activity}>now()-interval '24 months'
      ORDER BY r.membership_id LIMIT ${batch} FOR UPDATE OF r SKIP LOCKED
    ) DELETE FROM inactivity_reviews r USING expired e WHERE r.tenant_id=e.tenant_id AND r.membership_id=e.membership_id RETURNING r.membership_id`);
    return { closed, flagged: flagged.rowCount ?? 0, cleaned: cleaned.rowCount ?? 0 };
  });
}

export async function merchantInactivity(actorUserId: string) {
  const result = await db.execute(sql`SELECT m.id,m.card_locator AS "cardLocator",m.balance,r.flagged_at AS "flaggedAt",r.reviewed_at AS "reviewedAt"
    FROM staff_roles s JOIN inactivity_reviews r ON r.tenant_id=s.tenant_id JOIN memberships m ON m.id=r.membership_id AND m.tenant_id=r.tenant_id
    WHERE s.user_id=${actorUserId} AND s.active AND s.role='owner' AND m.closed_at IS NULL AND m.balance>0 AND (r.reviewed_at IS NULL OR r.flagged_at>r.reviewed_at)
    ORDER BY r.flagged_at,m.id LIMIT 100`);
  return result.rows;
}
export async function acknowledgeInactivity(actorUserId: string, membershipId: string) {
  const result = await db.execute(sql`UPDATE inactivity_reviews r SET reviewed_at=now(),reviewed_by=${actorUserId}
    FROM staff_roles s WHERE s.tenant_id=r.tenant_id AND s.user_id=${actorUserId} AND s.active AND s.role='owner' AND r.membership_id=${membershipId}::uuid RETURNING r.membership_id`);
  if (!result.rows.length) throw new DomainError("NOT_FOUND", "Review not found");
  return { reviewed: true };
}
