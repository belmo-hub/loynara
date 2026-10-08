import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { appleDevices, appleRegistrations, walletPasses } from "@/db/schema";
import { appleSigningConfig, appleWalletStatus } from "./apple";
import { sendApplePassNotifications } from "./apple-push";
import { walletCardSnapshot } from "./data";
import { googleConfig, googleWalletStatus, GoogleWalletClient } from "./google";
import type { RevokeReason, WalletRevokedData } from "./types";
import { withGooglePassLock } from "./write";
import { isPassFastObjectId, passFastStatus, PassFastError, type PassFastClient, PASSFAST_OPERATION_MS } from "./passfast";
import { syncPassFastPass } from "./passfast-lifecycle";

export type WalletRefreshResult = { status: "complete" } | { status: "blocked"; reason: string };
type PassRow = typeof walletPasses.$inferSelect;

/**
 * Brings every unrevoked or revocation-pending pass of one card in line with Loynara. The card is read fresh from the
 * database; providers only receive a copy and are never read back. A pass whose card was reissued or closed (or whose
 * credential no longer matches, defence in depth) is revoked: Apple devices are pushed so they fetch the voided pass,
 * Google objects are set INACTIVE without barcode. Loyalty state is never touched here, so a provider failure can only
 * delay the Wallet copy; the worker retries with backoff and an operator can replay blocked jobs.
 */
export async function refreshWalletForMembership(membershipId: string, deps: { google?: GoogleWalletClient; applePush?: typeof sendApplePassNotifications; expectedTenantId?: string; passfast?: PassFastClient } = {}): Promise<WalletRefreshResult> {
  const passFastDeadline = Date.now() + PASSFAST_OPERATION_MS;
  // Worker payloads have no membership FK. Bind their lookup to the outbox tenant before reading or contacting a provider.
  const rows = await db.select().from(walletPasses).where(and(eq(walletPasses.membershipId, membershipId), ne(walletPasses.status, "revoked"), deps.expectedTenantId ? eq(walletPasses.tenantId, deps.expectedTenantId) : undefined));
  if (!rows.length) return { status: "complete" };
  const snapshot = await walletCardSnapshot(membershipId);
  const blocked: string[] = [];
  let google = deps.google;
  let passFastFailed = false;
  for (const original of rows) {
    if (isPassFastObjectId(original.providerObjectId)) {
      if (!passFastStatus(process.env, original.tenantId).ready && !deps.passfast) { blocked.push("Wallet provider unavailable"); continue; }
      try { await syncPassFastPass(original.id, { client: deps.passfast, tenantId: original.tenantId, deadline: passFastDeadline }); }
      catch { passFastFailed = true; } // Still retire the other platform; retain this job for bounded retry.
      continue;
    }
    if (original.provider === "google") {
      await withGooglePassLock(original.id, async (tx, current) => {
        if (!current || current.status === "revoked") return;
        let row = current;
        // A waiting worker must read again AFTER the previous provider write and any committed lifecycle change.
        const latest = await walletCardSnapshot(row.membershipId, tx);
        const live = latest.open && row.revokedAt === null && row.credentialHash === latest.credentialHash;
        if (!live && row.revokedAt === null) {
          [row] = await tx.update(walletPasses).set({ revokedAt: new Date(), revokeReason: latest.open ? "superseded" : "closed", status: "revocation_pending" })
            .where(eq(walletPasses.id, row.id)).returning();
        }
        const status = googleWalletStatus();
        if (!status.ready) { blocked.push(`Google Wallet: ${status.reason}`); return; }
        const config = googleConfig();
        google ??= new GoogleWalletClient(config);
        if (!live) {
          await google.revoke(revokedView(row, latest), row.providerObjectId, config);
          await tx.update(walletPasses).set({ status: "revoked", syncedAt: new Date() }).where(eq(walletPasses.id, row.id));
        } else if (latest.open) {
          await google.upsert(latest.pass, row.id, config);
          await tx.update(walletPasses).set({ status: row.status === "pending" ? "created" : row.status, syncedAt: new Date(), updatedAt: new Date() }).where(eq(walletPasses.id, row.id));
        }
      });
      continue;
    }
    let row = original;
    const live = snapshot.open && row.revokedAt === null && row.credentialHash === snapshot.credentialHash;
    if (!live && row.revokedAt === null) {
      const reason: RevokeReason = snapshot.open ? "superseded" : "closed";
      const [updated] = await db.update(walletPasses).set({
        revokedAt: new Date(), revokeReason: reason,
        status: sql`case when ${walletPasses.provider} = 'apple' and ${walletPasses.status} = 'pending' then 'revoked' else 'revocation_pending' end`,
      }).where(and(eq(walletPasses.id, row.id), isNull(walletPasses.revokedAt))).returning();
      if (!updated) continue; // revoked concurrently; that writer queued its own refresh
      row = updated;
    }
    // An Apple pass that was never downloaded has nothing to withdraw.
    if (row.status === "revoked") continue;
    const revoked: WalletRevokedData | null = live ? null : revokedView(row, snapshot);
    if (row.provider === "apple") {
      const status = appleWalletStatus();
      if (!status.ready) { blocked.push(`Apple Wallet: ${status.reason}`); continue; }
      const config = appleSigningConfig();
      // A strictly increasing update tag, then a push: the device lists this serial and fetches the current pass.
      await db.update(walletPasses).set({ updatedAt: sql`greatest(now(), ${walletPasses.updatedAt} + interval '1 millisecond')` }).where(eq(walletPasses.id, row.id));
      const devices = await db.select({ deviceId: appleDevices.deviceLibraryIdentifier, pushToken: appleDevices.pushToken })
        .from(appleRegistrations)
        .innerJoin(appleDevices, eq(appleDevices.deviceLibraryIdentifier, appleRegistrations.deviceLibraryIdentifier))
        .where(and(eq(appleRegistrations.serialNumber, row.id), eq(appleRegistrations.passTypeIdentifier, config.passTypeId)));
      const invalid = await (deps.applePush ?? sendApplePassNotifications)(devices, config);
      for (const deviceId of invalid) {
        await db.transaction(async (tx) => {
          await tx.delete(appleRegistrations).where(eq(appleRegistrations.deviceLibraryIdentifier, deviceId));
          await tx.delete(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, deviceId));
        });
      }
      if (revoked) await finishRevocation(row);
      else await db.update(walletPasses).set({ syncedAt: new Date() }).where(eq(walletPasses.id, row.id));
    }
  }
  if (passFastFailed) throw new PassFastError();
  return blocked.length ? { status: "blocked", reason: blocked.join("; ") } : { status: "complete" };
}

function revokedView(row: PassRow, snapshot: Awaited<ReturnType<typeof walletCardSnapshot>>): WalletRevokedData {
  const brand = snapshot.open ? snapshot.pass : snapshot.brand;
  const { tenantId, programId, merchantName, programName, locationName, brandColor, country, locale, appleLogo } = brand;
  return { tenantId, programId, merchantName, programName, locationName, brandColor, country, locale, membershipId: row.membershipId, reason: (row.revokeReason as RevokeReason | null) ?? "superseded", ...(appleLogo ? { appleLogo } : {}) };
}

async function finishRevocation(row: PassRow) {
  await db.update(walletPasses).set({ status: "revoked", syncedAt: new Date() }).where(eq(walletPasses.id, row.id));
}

/**
 * After a successful refresh, older failed or blocked refreshes of the same card describe a state that no longer
 * exists: the current pass already shows everything they were about. They are suppressed so that open failures in
 * monitoring mean "a card's Wallet copy is behind NOW", not "something once failed".
 */
export async function supersedeOlderWalletRefreshes(pool: Pick<Pool, "query">, job: { id: string; tenantId: string; payload: Record<string, unknown> }) {
  await pool.query(
    `UPDATE outbox_jobs SET status = 'suppressed', last_error = 'Superseded by a later successful wallet refresh'
     WHERE kind = 'wallet.refresh' AND status IN ('blocked', 'failed') AND tenant_id = $1 AND payload ->> 'membershipId' = $2 AND id <> $3
       AND created_at <= (SELECT created_at FROM outbox_jobs WHERE id = $3)`,
    [job.tenantId, String(job.payload.membershipId), job.id],
  );
}

/**
 * Keep registrations throughout a provider outage and for a week after a successful revocation push. Each sweep
 * removes at most 1000 registrations and 1000 orphan devices, so retention maintenance cannot monopolize the worker.
 */
export async function pruneRevokedAppleRegistrations(pool: Pick<Pool, "query">, olderThanDays = 7) {
  await pool.query(
    `WITH expired AS (
       SELECT r.ctid FROM apple_registrations r
       JOIN wallet_passes p ON p.id::text = r.serial_number AND p.tenant_id = r.tenant_id AND p.membership_id = r.membership_id
       WHERE p.provider = 'apple' AND p.status = 'revoked' AND p.revoked_at IS NOT NULL
         AND p.synced_at < now() - make_interval(days => $1::int)
       ORDER BY r.device_library_identifier, r.pass_type_identifier, r.serial_number
       LIMIT 1000 FOR UPDATE OF r SKIP LOCKED
     ) DELETE FROM apple_registrations r USING expired WHERE r.ctid = expired.ctid`,
    [olderThanDays],
  );
  await pool.query(`WITH orphaned AS (
    SELECT d.device_library_identifier FROM apple_devices d
    WHERE NOT EXISTS (SELECT 1 FROM apple_registrations r WHERE r.device_library_identifier = d.device_library_identifier)
    ORDER BY d.device_library_identifier LIMIT 1000 FOR UPDATE OF d SKIP LOCKED
  ) DELETE FROM apple_devices d USING orphaned WHERE d.device_library_identifier = orphaned.device_library_identifier`);
}
