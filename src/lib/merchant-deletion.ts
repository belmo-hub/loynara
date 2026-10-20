import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { lifecycleTransaction, retentionPolicyVersion, type ClosureResult } from "./card-lifecycle";
import { recordClosureIntent } from "./closure-manifest";
import { DomainError } from "./loyalty";
import { requireRecentOwnerSession } from "./lifecycle-policy";
import { recipientHash } from "./transactional-email";

const inputSchema = z.object({ actorUserId: z.string().min(1), sessionId: z.string().min(1), tenantId: z.uuid(), confirmation: z.string().max(180) });

/** Bulk closure is atomic, even for a full merchant. The later maintenance process performs actual erasure. */
export async function closeMerchant(raw: z.input<typeof inputSchema>): Promise<ClosureResult> {
  const input = inputSchema.parse(raw);
  return lifecycleTransaction(async tx => {
    const roleResult = await tx.execute(sql`SELECT role,active FROM staff_roles WHERE tenant_id=${input.tenantId}::uuid AND user_id=${input.actorUserId}`);
    if (roleResult.rows[0]?.role !== "owner" || !roleResult.rows[0]?.active) throw new DomainError("FORBIDDEN", "Only the active owner can delete this business");
    const tenantResult = await tx.execute(sql`SELECT name,closed_at FROM tenants WHERE id=${input.tenantId}::uuid FOR UPDATE`);
    const tenant = tenantResult.rows[0];
    if (!tenant || tenant.closed_at) throw new DomainError("NOT_FOUND", "Business not found");
    if (input.confirmation !== tenant.name) throw new DomainError("CONFIRMATION_REQUIRED", "Enter the exact business name to confirm deletion");
    const roles = await tx.execute(sql`SELECT role,active FROM staff_roles WHERE tenant_id=${input.tenantId}::uuid AND user_id=${input.actorUserId} FOR UPDATE`);
    const sessionResult = await tx.execute(sql`SELECT "createdAt", "expiresAt" FROM session WHERE id=${input.sessionId} AND "userId"=${input.actorUserId} FOR UPDATE`);
    const session = sessionResult.rows[0] as { createdAt: Date; expiresAt: Date } | undefined;
    if (!session) throw new DomainError("UNAUTHENTICATED", "Sign in required");
    const [{ now }] = (await tx.execute(sql`SELECT clock_timestamp() AS now`)).rows as { now: Date }[];
    requireRecentOwnerSession({ role: String(roles.rows[0]?.role), active: roles.rows[0]?.active === true, createdAt: new Date(session.createdAt), expiresAt: new Date(session.expiresAt) }, new Date(now));
    // Enrollment takes the same tenant admission fence. Existing awards/deliveries finish before these locks.
    await tx.execute(sql`SELECT id FROM memberships WHERE tenant_id=${input.tenantId}::uuid ORDER BY id FOR UPDATE`);
    const retiredContacts = await tx.execute(sql`SELECT DISTINCT c.email FROM membership_contacts c WHERE c.tenant_id=${input.tenantId}::uuid AND c.email IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM membership_contacts other JOIN memberships m ON m.id=other.membership_id AND m.tenant_id=other.tenant_id
        WHERE other.email=c.email AND other.email_verified AND m.closed_at IS NULL AND other.tenant_id<>${input.tenantId}::uuid)`);
    const hashes = retiredContacts.rows.map(row => recipientHash(String(row.email)));
    // Recipient hashes only live in memory long enough to detach shared recovery metadata from this merchant.
    await tx.execute(sql`UPDATE outbox_jobs j SET payload=jsonb_build_object('erasureTenantId',${input.tenantId}::text),
      status=CASE WHEN status IN ('pending','retry','processing','blocked') THEN 'suppressed' ELSE status END,last_error=NULL
      WHERE kind='email.recover' AND (j.id IN (SELECT job_id FROM email_deliveries WHERE recipient_hash IN (SELECT jsonb_array_elements_text(${JSON.stringify(hashes)}::jsonb)))
        OR j.payload->>'challengeId' IN (SELECT r.id::text FROM card_recovery_challenges r JOIN membership_contacts c ON c.email=r.email
          WHERE c.tenant_id=${input.tenantId}::uuid AND NOT EXISTS (SELECT 1 FROM membership_contacts other JOIN memberships m ON m.id=other.membership_id AND m.tenant_id=other.tenant_id
            WHERE other.email=r.email AND other.email_verified AND m.closed_at IS NULL AND other.tenant_id<>${input.tenantId}::uuid)))`);
    await tx.execute(sql`DELETE FROM card_recovery_challenges r WHERE EXISTS (SELECT 1 FROM membership_contacts c WHERE c.tenant_id=${input.tenantId}::uuid AND c.email=r.email)
      AND NOT EXISTS (SELECT 1 FROM membership_contacts c JOIN memberships m ON m.id=c.membership_id AND m.tenant_id=c.tenant_id
        WHERE c.email=r.email AND c.email_verified AND m.closed_at IS NULL AND c.tenant_id<>${input.tenantId}::uuid)`);
    await tx.execute(sql`DELETE FROM customer_export_challenges WHERE tenant_id=${input.tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM contact_verification_challenges WHERE tenant_id=${input.tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM membership_contacts WHERE tenant_id=${input.tenantId}::uuid`);
    await tx.execute(sql`UPDATE outbox_jobs SET payload=CASE WHEN payload ? 'membershipId' THEN jsonb_build_object('membershipId',payload->>'membershipId') ELSE '{}'::jsonb END,
      status=CASE WHEN status IN ('pending','retry','processing','blocked') THEN 'suppressed' ELSE status END,last_error=NULL WHERE tenant_id=${input.tenantId}::uuid`);
    await tx.execute(sql`UPDATE automation_rules SET enabled=false WHERE tenant_id=${input.tenantId}::uuid`);
    await tx.execute(sql`UPDATE automation_runs SET status='suppressed',reason='Business closed' WHERE tenant_id=${input.tenantId}::uuid AND status='queued'`);
    await tx.execute(sql`UPDATE campaigns SET status='cancelled',updated_at=now() WHERE tenant_id=${input.tenantId}::uuid AND status<>'complete'`);
    await tx.execute(sql`UPDATE campaign_recipients SET status='suppressed',suppress_reason='Business closed' WHERE tenant_id=${input.tenantId}::uuid AND status='queued'`);
    await tx.execute(sql`UPDATE tap_requests SET status='cancelled' WHERE tenant_id=${input.tenantId}::uuid AND status='pending_staff'`);
    await tx.execute(sql`UPDATE wallet_passes SET revoked_at=now(),revoke_reason='closed',updated_at=now(),
      status=CASE WHEN status='pending' AND (provider='apple' OR provider_object_id LIKE 'passfast:%') THEN 'revoked' ELSE 'revocation_pending' END
      WHERE tenant_id=${input.tenantId}::uuid AND revoked_at IS NULL`);
    await tx.execute(sql`INSERT INTO outbox_jobs(tenant_id,kind,payload)
      SELECT DISTINCT tenant_id,'wallet.refresh',jsonb_build_object('membershipId',membership_id::text,'coalescingVersion','1')
      FROM wallet_passes WHERE tenant_id=${input.tenantId}::uuid AND status<>'revoked'`);
    await tx.execute(sql`UPDATE memberships SET closed_at=coalesce(closed_at,now()),
      card_token='retired_card_'||gen_random_uuid()::text,scan_code='retired_sc_'||gen_random_uuid()::text
      WHERE tenant_id=${input.tenantId}::uuid AND closed_at IS NULL`);
    await tx.execute(sql`UPDATE programs SET status='archived',tap_mode='disabled' WHERE tenant_id=${input.tenantId}::uuid`);
    await tx.execute(sql`UPDATE secure_tags SET status='revoked',revoked_at=coalesce(revoked_at,now()) WHERE tenant_id=${input.tenantId}::uuid AND status IN ('active','provisioned')`);
    await tx.execute(sql`UPDATE staff_invites SET revoked_at=coalesce(revoked_at,now()) WHERE tenant_id=${input.tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM staff_push_subscriptions WHERE tenant_id=${input.tenantId}::uuid`);
    await tx.execute(sql`DELETE FROM session WHERE "userId" IN (SELECT user_id FROM staff_roles WHERE tenant_id=${input.tenantId}::uuid)`);
    await tx.execute(sql`UPDATE staff_roles SET active=false WHERE tenant_id=${input.tenantId}::uuid`);
    await tx.execute(sql`UPDATE subscriptions SET status='cancelled',updated_at=now() WHERE tenant_id=${input.tenantId}::uuid`);
    const receiptId = randomUUID();
    await tx.execute(sql`INSERT INTO deletion_receipts(id,scope,policy_version,requested_at,remote_outcome) VALUES(${receiptId}::uuid,'tenant',${retentionPolicyVersion},${now},'pending')`);
    await tx.execute(sql`UPDATE tenants SET closed_at=${now},deletion_receipt_id=${receiptId}::uuid WHERE id=${input.tenantId}::uuid`);
    await recordClosureIntent({scope:"tenant",tenant_id:input.tenantId,member_id:null,cutoff_at:new Date(now).toISOString(),intent_id:receiptId});
    return { closed: true, retention: "erasure-queued", policyVersion: retentionPolicyVersion, receiptId, deleteBy: new Date(new Date(now).getTime()+7*86400_000).toISOString() };
  });
}

export async function deletionReceipt(id: string) {
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Receipt not found");
  const result = await db.execute(sql`SELECT id,scope,policy_version,requested_at,completed_at,remote_outcome,exception
    FROM deletion_receipts WHERE id=${id}::uuid AND (completed_at IS NULL OR completed_at>now()-interval '30 days')`);
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Receipt not found");
  return result.rows[0];
}
