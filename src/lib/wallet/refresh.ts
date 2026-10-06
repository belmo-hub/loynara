import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { appleDevices, appleRegistrations, walletPasses } from "@/db/schema";
import { appleSigningConfig, appleWalletStatus } from "./apple";
import { sendApplePassNotifications } from "./apple-push";
import { walletCardSnapshot } from "./data";
import { googleConfig, googleWalletStatus, GoogleWalletClient } from "./google";
import type { RevokeReason, WalletRevokedData } from "./types";

export type WalletRefreshResult = { status: "complete" } | { status: "blocked"; reason: string };
type PassRow = typeof walletPasses.$inferSelect;

/**
 * Brings every unrevoked or revocation-pending pass of one card in line with Loynara. The card is read fresh from the
 * database; providers only receive a copy and are never read back. A pass whose card was reissued or closed (or whose
 * credential no longer matches, defence in depth) is revoked: Apple devices are pushed so they fetch the voided pass,
 * Google objects are set INACTIVE without barcode. Loyalty state is never touched here, so a provider failure can only
 * delay the Wallet copy; the worker retries with backoff and an operator can replay blocked jobs.
 */
export async function refreshWalletForMembership(membershipId: string, deps: { google?: GoogleWalletClient; applePush?: typeof sendApplePassNotifications } = {}): Promise<WalletRefreshResult> {
  const rows = await db.select().from(walletPasses).where(and(eq(walletPasses.membershipId, membershipId), ne(walletPasses.status, "revoked")));
  if (!rows.length) return { status: "complete" };
  const snapshot = await walletCardSnapshot(membershipId);
  const blocked: string[] = [];
  let google = deps.google;
  for (const original of rows) {
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
    if (row.provider === "google") {
      const status = googleWalletStatus();
      if (!status.ready) { blocked.push(`Google Wallet: ${status.reason}`); continue; }
      const config = googleConfig();
      google ??= new GoogleWalletClient(config);
      if (revoked) {
        await google.revoke(revoked, row.providerObjectId, config);
        await finishRevocation(row);
      } else if (snapshot.open) {
        await google.upsert(snapshot.pass, row.id, config);
        await db.update(walletPasses).set({ status: row.status === "pending" ? "created" : row.status, syncedAt: new Date(), updatedAt: new Date() }).where(eq(walletPasses.id, row.id));
      }
    } else if (row.provider === "apple") {
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
 * Device identifiers and push tokens of revoked passes are kept only long enough to deliver the voided pass. A week
 * covers devices that were offline; afterwards they are deleted (the voided pass on the device keeps working offline).
 */
export async function pruneRevokedAppleRegistrations(pool: Pick<Pool, "query">, olderThanDays = 7) {
  await pool.query(
    `DELETE FROM apple_registrations r USING wallet_passes p
     WHERE p.provider = 'apple' AND p.id::text = r.serial_number AND p.revoked_at IS NOT NULL AND p.revoked_at < now() - make_interval(days => $1::int)`,
    [olderThanDays],
  );
  await pool.query("DELETE FROM apple_devices d WHERE NOT EXISTS (SELECT 1 FROM apple_registrations r WHERE r.device_library_identifier = d.device_library_identifier)");
}
