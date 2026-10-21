import { createHash } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { appleDevices, appleRegistrations, walletPasses } from "@/db/schema";
import { appleSigningConfig, appleWalletStatus } from "./apple";
import { sendApplePassNotifications } from "./apple-push";
import { walletText } from "./content";
import { walletCardSnapshot } from "./data";
import { googleObjectId, GoogleWalletClient, type GoogleMessage } from "./google";
import { googleDirectConfig, googleDirectStatus } from "./google-direct";
import type { RevokeReason, WalletPassData, WalletRevokedData } from "./types";
import { withGooglePassLock } from "./write";
import { isPassFastObjectId, passFastStatus, passFastConfig, PassFastError, type PassFastClient, PASSFAST_OPERATION_MS } from "./passfast";
import { syncPassFastPass } from "./passfast-lifecycle";
import { passFastEnv } from "./template-bindings";

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
      const brand = snapshot.open ? snapshot.pass : snapshot.brand;
      const env = await passFastEnv(original.tenantId, brand.locationId);
      if (brand.tenantId !== original.tenantId || !passFastStatus(env, original.tenantId, brand.locationId).ready
        || !passFastConfig(env, original.tenantId, brand.locationId).platforms.includes(original.provider as "apple" | "google")) { blocked.push("Wallet provider unavailable"); continue; }
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
        const brand = latest.open ? latest.pass : latest.brand;
        const status = googleDirectStatus(process.env, row.tenantId, brand.locationId, brand.programId, "maintenance");
        if (!status.ready) { blocked.push(`Google Wallet: ${status.reason}`); return; }
        const config = googleDirectConfig(process.env, row.tenantId, brand.locationId!, brand.programId, "maintenance");
        if (brand.tenantId !== row.tenantId || row.providerObjectId !== googleObjectId(row.id, config)) { blocked.push("Google Wallet binding unavailable"); return; }
        google ??= new GoogleWalletClient(config);
        if (!live) {
          await google.revoke(revokedView(row, latest), row.providerObjectId, config);
          await tx.update(walletPasses).set({ status: "revoked", syncedAt: new Date() }).where(eq(walletPasses.id, row.id));
        } else if (latest.open) {
          await google.upsert(latest.pass, row.id, config);
          const message = await rewardReadyMessage(tx, row, latest.pass);
          if (message && await google.addMessageOnce(row.providerObjectId, message, config) === "limited") console.warn("Google Wallet reward message skipped: notification limit reached");
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
  const { tenantId, locationId, programId, merchantName, programName, locationName, brandColor, country, locale, appleLogo } = brand;
  return { tenantId, locationId, programId, merchantName, programName, locationName, brandColor, country, locale, membershipId: row.membershipId, reason: (row.revokeReason as RevokeReason | null) ?? "superseded", ...(appleLogo ? { appleLogo } : {}) };
}

/**
 * "Prämie bereit" once per reward cycle, by the reward_ready rule (the cheapest active reward): the message belongs to the
 * ledger entry that lifted the balance to that reward's cost. Retries, later stamps and a redemption that leaves the card
 * ready find the same entry, so the same id. Nothing for a crossing before this pass was issued (a reissue's new pass)
 * or before the reward's current version took effect (an owner edit is not a crossing).
 */
async function rewardReadyMessage(tx: Pick<typeof db, "execute">, row: PassRow, pass: WalletPassData): Promise<GoogleMessage | null> {
  const t = walletText(pass.locale);
  if (!t.rewardReadyMessage) return null;
  const result = await tx.execute(sql`
    SELECT e.id, reward.title FROM memberships m
    JOIN wallet_passes p ON p.tenant_id = m.tenant_id AND p.membership_id = m.id AND p.id = ${row.id}::uuid
    JOIN LATERAL (
      SELECT latest.title, latest.cost, latest.effective_at FROM rewards r
      JOIN LATERAL (
        SELECT rv.title, rv.cost, rv.effective_at FROM reward_versions rv
        WHERE rv.tenant_id = r.tenant_id AND rv.reward_id = r.id AND rv.effective_at <= now()
        ORDER BY rv.version DESC LIMIT 1
      ) latest ON true
      WHERE r.tenant_id = m.tenant_id AND r.program_id = m.program_id AND r.active = true
      ORDER BY latest.cost, r.sort_order, r.id LIMIT 1
    ) reward ON reward.cost <= m.balance
    JOIN LATERAL (
      SELECT l.id, l.created_at, m.balance - sum(l.delta) OVER (ORDER BY l.created_at DESC, l.id DESC ROWS UNBOUNDED PRECEDING) AS before
      FROM ledger_entries l WHERE l.tenant_id = m.tenant_id AND l.membership_id = m.id
    ) e ON e.before < reward.cost
    WHERE m.tenant_id = ${row.tenantId}::uuid AND m.id = ${row.membershipId}::uuid
      AND e.created_at > p.created_at AND e.created_at >= reward.effective_at
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1`);
  const [entry] = result.rows as Array<{ id: string; title: string }>;
  if (!entry) return null;
  const id = createHash("sha256").update("loynara-google-reward-message-v1\0").update(`${row.membershipId}\0${entry.id}`).digest("hex");
  return { id: `reward_${id}`, header: t.rewardReady, body: t.rewardReadyMessage(entry.title), messageType: "TEXT_AND_NOTIFY" };
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
