import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { automationRuns, consentEvents, contactVerificationChallenges, membershipContacts, memberships, outboxJobs } from "@/db/schema";
import { recordClosureIntent } from "./closure-manifest";
import { DomainError } from "./loyalty";
import { recipientHash } from "./transactional-email";
import { revokeCardWalletPasses } from "./wallet/enqueue";

const cardTokenPattern = /^card_[A-Za-z0-9_-]{32,80}$/;
export const retentionPolicyVersion = "2026-10-15";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ClosureResult = { closed: true; retention: "erasure-queued"; policyVersion: string; receiptId: string; deleteBy: string };
export function validCardToken(token: string) { return cardTokenPattern.test(token); }

/** Retry only database-aborted transactions. No messages are sent; repeated closure intents remain idempotent obligations. */
export async function lifecycleTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.transaction(work); }
    catch (error) {
      const cause = (error as { cause?: { code?: string }; code?: string });
      if (attempt >= 2 || !["40P01", "40001"].includes(cause.cause?.code ?? cause.code ?? "")) throw error;
    }
  }
}

/** Caller and all competing loyalty writes use the membership lock. Durable closure archival must finish before commit. */
export async function closeMembershipInTransaction(tx: Transaction, membershipId: string): Promise<ClosureResult> {
  const [member] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for("update");
  if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
  const [contact] = await tx.select().from(membershipContacts).where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id)));
  // Link challenge-only recovery jobs to this erasure graph before discarding the last address.
  // A shared address still serving another live card must keep its recovery flow.
  if (contact?.email) {
    const emailHash = recipientHash(contact.email);
    await tx.execute(sql`
      UPDATE outbox_jobs j SET payload=jsonb_build_object('membershipId', ${member.id}::text),
        status=CASE WHEN j.status IN ('pending','retry','processing','blocked') THEN 'suppressed' ELSE j.status END,
        last_error=NULL
      WHERE j.kind='email.recover' AND (
        j.payload->>'challengeId' IN (SELECT id::text FROM card_recovery_challenges WHERE email=${contact.email})
        OR j.id IN (SELECT job_id FROM email_deliveries WHERE recipient_hash=${emailHash}))
      AND NOT EXISTS (SELECT 1 FROM membership_contacts c JOIN memberships m ON m.tenant_id=c.tenant_id AND m.id=c.membership_id
        WHERE c.email=${contact.email} AND c.email_verified AND m.closed_at IS NULL AND m.id<>${member.id}::uuid)`);
    await tx.execute(sql`DELETE FROM card_recovery_challenges r WHERE r.email=${contact.email}
      AND NOT EXISTS (SELECT 1 FROM membership_contacts c JOIN memberships m ON m.tenant_id=c.tenant_id AND m.id=c.membership_id
        WHERE c.email=r.email AND c.email_verified AND m.closed_at IS NULL AND m.id<>${member.id}::uuid)`);
  }
  await tx.delete(contactVerificationChallenges).where(and(eq(contactVerificationChallenges.tenantId, member.tenantId), eq(contactVerificationChallenges.membershipId, member.id)));
  await tx.execute(sql`DELETE FROM customer_export_challenges WHERE tenant_id=${member.tenantId}::uuid AND membership_id=${member.id}::uuid`);
  await tx.delete(membershipContacts).where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id)));
  await tx.insert(consentEvents).values({ tenantId: member.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "2026-10-15", source: "card_closure" });
  // Resolve indirect jobs before their identifying payload is scrubbed.
  await tx.execute(sql`UPDATE outbox_jobs SET payload=jsonb_build_object('membershipId', ${member.id}::text)
    WHERE tenant_id=${member.tenantId}::uuid AND (payload->>'tapRequestId' IN (SELECT id::text FROM tap_requests WHERE membership_id=${member.id}::uuid)
      OR payload->>'recipientId' IN (SELECT id::text FROM campaign_recipients WHERE membership_id=${member.id}::uuid)
      OR payload->>'runId' IN (SELECT id::text FROM automation_runs WHERE membership_id=${member.id}::uuid))`);
  await tx.update(outboxJobs).set({ payload: { membershipId: member.id },
    status: sql`case when ${outboxJobs.status} in ('pending','retry','processing','blocked') then 'suppressed' else ${outboxJobs.status} end`,
    lastError: null,
  }).where(and(eq(outboxJobs.tenantId, member.tenantId), sql`${outboxJobs.payload} ->> 'membershipId' = ${member.id}`));
  await tx.update(automationRuns).set({ status: "suppressed", reason: "Card closed" })
    .where(and(eq(automationRuns.tenantId, member.tenantId), eq(automationRuns.membershipId, member.id), eq(automationRuns.status, "queued")));
  await tx.execute(sql`UPDATE campaign_recipients SET status='suppressed', suppress_reason='Card closed' WHERE tenant_id=${member.tenantId}::uuid AND membership_id=${member.id}::uuid AND status='queued'`);
  await tx.execute(sql`UPDATE tap_requests SET status='cancelled' WHERE tenant_id=${member.tenantId}::uuid AND membership_id=${member.id}::uuid AND status='pending_staff'`);
  await revokeCardWalletPasses(tx, member.tenantId, member.id, "closed");
  const remotePending = (await tx.execute(sql`SELECT 1 FROM wallet_passes WHERE tenant_id=${member.tenantId}::uuid AND membership_id=${member.id}::uuid AND status<>'revoked' LIMIT 1`)).rows.length > 0;
  const receiptId = randomUUID();
  const [{ closedAt: closedAtValue }] = (await tx.execute(sql`SELECT clock_timestamp() AS "closedAt"`)).rows as { closedAt: string }[];
  const closedAt = new Date(closedAtValue);
  await tx.execute(sql`INSERT INTO deletion_receipts(id,scope,policy_version,requested_at,remote_outcome)
    VALUES (${receiptId}::uuid,'member',${retentionPolicyVersion},${closedAt},'pending')`);
  await tx.update(memberships).set({ scanCode: `retired_sc_${randomBytes(24).toString("base64url")}`,
    cardToken: `retired_card_${randomBytes(32).toString("base64url")}`, closedAt,
  }).where(and(eq(memberships.tenantId, member.tenantId), eq(memberships.id, member.id)));
  await tx.execute(sql`UPDATE memberships SET deletion_receipt_id=${receiptId}::uuid WHERE id=${member.id}::uuid`);
  await recordClosureIntent({scope:"member",tenant_id:member.tenantId,member_id:member.id,cutoff_at:closedAt.toISOString(),intent_id:receiptId});
  return { closed: true, retention: "erasure-queued", policyVersion: retentionPolicyVersion, receiptId, deleteBy: new Date(closedAt.getTime() + (remotePending ? 7 : 1) * 86400_000).toISOString() };
}

export async function closeCard(cardToken: string): Promise<ClosureResult> {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  return lifecycleTransaction(async tx => {
    const [member] = await tx.select({ id: memberships.id, closedAt: memberships.closedAt }).from(memberships).where(eq(memberships.cardToken, cardToken)).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    return closeMembershipInTransaction(tx, member.id);
  });
}
