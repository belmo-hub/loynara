import { sql } from "drizzle-orm";
import type { db } from "@/db";

type Query = Pick<Parameters<Parameters<typeof db.transaction>[0]>[0], "execute">;

/**
 * Queues a Wallet refresh for one card inside the caller's loyalty transaction, so it commits or rolls back with the
 * balance change. Two rules keep provider traffic proportional to what customers actually hold:
 *  - nothing is queued for a card without an unrevoked pass (most cards, and every card while Wallet is disabled);
 *  - at most one not-yet-claimed refresh exists per card: the worker reads the CURRENT state when it runs, so one pending
 *    job already covers every later change. Ten stamps in a minute cause one provider update, not ten.
 * A covering pending row stays locked until the caller commits, including an insert conflict with a not-yet-visible
 * row, so a worker cannot claim it and read precommit state.
 * A job that is already running or waiting to retry does not absorb new changes; the next change queues a fresh one.
 */
export async function enqueueWalletRefresh(tx: Query, tenantId: string, membershipId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO outbox_jobs (tenant_id, kind, payload)
    SELECT ${tenantId}::uuid, 'wallet.refresh', jsonb_build_object('membershipId', ${membershipId}::text, 'coalescingVersion', '1')
    WHERE EXISTS (SELECT 1 FROM wallet_passes WHERE tenant_id = ${tenantId}::uuid AND membership_id = ${membershipId}::uuid AND status <> 'revoked')
      AND NOT EXISTS (SELECT 1 FROM outbox_jobs WHERE tenant_id = ${tenantId}::uuid AND kind = 'wallet.refresh' AND status = 'pending' AND payload ->> 'membershipId' = ${membershipId}::text FOR UPDATE)
    ON CONFLICT (tenant_id, (payload ->> 'membershipId'))
      WHERE kind = 'wallet.refresh' AND status = 'pending' AND payload ->> 'coalescingVersion' = '1'
    DO UPDATE SET payload = outbox_jobs.payload`);
}

/**
 * Revokes every unrevoked pass of a card inside the caller's reissue/closure transaction and queues the provider work:
 * Apple devices get a push and fetch a voided pass, Google objects are deactivated. An Apple pass that was never
 * downloaded has nothing to withdraw and is closed out at once. History rows are kept, never deleted.
 */
export async function revokeCardWalletPasses(tx: Query, tenantId: string, membershipId: string, reason: "reissued" | "closed"): Promise<void> {
  await tx.execute(sql`
    UPDATE wallet_passes SET revoked_at = now(), revoke_reason = ${reason}, updated_at = now(),
      status = CASE WHEN status = 'pending' AND (provider = 'apple' OR provider_object_id LIKE 'passfast:%') THEN 'revoked' ELSE 'revocation_pending' END
    WHERE tenant_id = ${tenantId}::uuid AND membership_id = ${membershipId}::uuid AND revoked_at IS NULL`);
  await enqueueWalletRefresh(tx, tenantId, membershipId);
}

/**
 * Programme-wide changes (merchant name, colour, logo, programme name, rewards) reach every card that holds a pass:
 * one coalesced refresh per such card. `programId` omitted = every programme of the merchant (the merchant name).
 */
export async function enqueueWalletProgramRefresh(tx: Query, tenantId: string, programId?: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO outbox_jobs (tenant_id, kind, payload)
    SELECT DISTINCT ${tenantId}::uuid, 'wallet.refresh', jsonb_build_object('membershipId', m.id::text, 'coalescingVersion', '1')
    FROM wallet_passes p
    JOIN memberships m ON m.id = p.membership_id AND m.tenant_id = p.tenant_id
    WHERE p.tenant_id = ${tenantId}::uuid AND p.status <> 'revoked' AND p.revoked_at IS NULL AND m.closed_at IS NULL
      ${programId ? sql`AND m.program_id = ${programId}::uuid` : sql``}
      AND NOT EXISTS (SELECT 1 FROM outbox_jobs j WHERE j.tenant_id = ${tenantId}::uuid AND j.kind = 'wallet.refresh' AND j.status = 'pending' AND j.payload ->> 'membershipId' = m.id::text FOR UPDATE)
    ON CONFLICT (tenant_id, (payload ->> 'membershipId'))
      WHERE kind = 'wallet.refresh' AND status = 'pending' AND payload ->> 'coalescingVersion' = '1'
    DO UPDATE SET payload = outbox_jobs.payload`);
}
