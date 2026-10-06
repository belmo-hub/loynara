import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appleDevices, appleRegistrations, walletPasses } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { validApplePassToken, type ApplePassConfig } from "./apple";
import { walletCardSnapshot } from "./data";
import type { RevokeReason, WalletPassData, WalletRevokedData } from "./types";

type PassInput = { passTypeId: string; serial: string; authorization: string };
type RegistrationInput = PassInput & { deviceId: string; pushToken: string };

const serialPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const devicePattern = /^[A-Za-z0-9._-]{1,200}$/;

export type ApplePassView =
  | { kind: "active"; passId: string; updatedAt: Date; pass: WalletPassData }
  | { kind: "void"; passId: string; updatedAt: Date; pass: WalletRevokedData };

export function validAppleDeviceId(deviceId: string) { return devicePattern.test(deviceId); }

/**
 * Authenticates one pass and decides what it may show. Format, serial and token are checked before any lookup, and an
 * unknown serial and a wrong token fail identically, so serials cannot be probed. The token is bound to the serial
 * (HMAC), and the serial is a random pass-row id, so one tenant's token can never open another tenant's pass.
 * The pass shows the live card only while its row is unrevoked AND still matches the card's current credential;
 * otherwise it is served voided, without QR code or balance.
 */
export async function authenticatedApplePass(input: PassInput, config: ApplePassConfig): Promise<ApplePassView> {
  const token = /^ApplePass ([A-Za-z0-9_-]{16,100})$/.exec(input.authorization)?.[1];
  if (input.passTypeId !== config.passTypeId || !token || !serialPattern.test(input.serial) || !validApplePassToken(input.serial, token, config)) {
    throw new DomainError("FORBIDDEN", "Invalid pass authentication");
  }
  const [row] = await db.select().from(walletPasses).where(and(eq(walletPasses.id, input.serial), eq(walletPasses.provider, "apple")));
  if (!row) throw new DomainError("FORBIDDEN", "Invalid pass authentication");
  const snapshot = await walletCardSnapshot(row.membershipId);
  if (row.revokedAt === null && snapshot.open && row.credentialHash === snapshot.credentialHash) {
    return { kind: "active", passId: row.id, updatedAt: row.updatedAt, pass: snapshot.pass };
  }
  const reason: RevokeReason = (row.revokeReason as RevokeReason | null) ?? (snapshot.open ? "superseded" : "closed");
  const brand = snapshot.open ? snapshot.pass : snapshot.brand;
  const { tenantId, programId, merchantName, programName, locationName, brandColor, country, locale, appleLogo } = brand;
  return { kind: "void", passId: row.id, updatedAt: row.updatedAt, pass: { tenantId, programId, merchantName, programName, locationName, brandColor, country, locale, membershipId: row.membershipId, reason, ...(appleLogo ? { appleLogo } : {}) } };
}

/** Wallet registers a device for update pushes. Only an active pass may register; a voided one has nothing to receive. */
export async function registerAppleDevice(input: RegistrationInput, config: ApplePassConfig): Promise<200 | 201> {
  if (!validAppleDeviceId(input.deviceId)) throw new DomainError("INVALID_DEVICE", "Invalid device identifier");
  if (!/^[a-f0-9]{32,300}$/i.test(input.pushToken)) throw new DomainError("INVALID_TOKEN", "Invalid Apple push token");
  const view = await authenticatedApplePass(input, config);
  if (view.kind !== "active") throw new DomainError("FORBIDDEN", "Invalid pass authentication");
  return db.transaction(async (tx) => {
    // Lock the pass row: a concurrent reissue/closure revokes it, and then no new registration may appear.
    const [row] = await tx.select().from(walletPasses).where(eq(walletPasses.id, view.passId)).for("update");
    if (!row || row.revokedAt) throw new DomainError("FORBIDDEN", "Invalid pass authentication");
    if (row.status === "pending" || row.status === "downloaded") await tx.update(walletPasses).set({ status: "registered" }).where(eq(walletPasses.id, row.id));
    await tx.insert(appleDevices).values({ deviceLibraryIdentifier: input.deviceId, pushToken: input.pushToken })
      .onConflictDoUpdate({ target: appleDevices.deviceLibraryIdentifier, set: { pushToken: input.pushToken, updatedAt: new Date() } });
    const inserted = await tx.insert(appleRegistrations).values({ deviceLibraryIdentifier: input.deviceId, tenantId: row.tenantId, membershipId: row.membershipId, passTypeIdentifier: input.passTypeId, serialNumber: row.id })
      .onConflictDoNothing().returning({ deviceLibraryIdentifier: appleRegistrations.deviceLibraryIdentifier });
    return inserted.length ? 201 : 200;
  });
}

/** Removing a pass from Wallet. Allowed for voided passes too, so devices clean up after a reissue or closure. */
export async function unregisterAppleDevice(input: Omit<RegistrationInput, "pushToken">, config: ApplePassConfig): Promise<void> {
  if (!validAppleDeviceId(input.deviceId)) throw new DomainError("INVALID_DEVICE", "Invalid device identifier");
  await authenticatedApplePass(input, config);
  await db.transaction(async (tx) => {
    await tx.delete(appleRegistrations).where(and(eq(appleRegistrations.deviceLibraryIdentifier, input.deviceId), eq(appleRegistrations.passTypeIdentifier, input.passTypeId), eq(appleRegistrations.serialNumber, input.serial)));
    const other = await tx.select({ id: appleRegistrations.deviceLibraryIdentifier }).from(appleRegistrations).where(eq(appleRegistrations.deviceLibraryIdentifier, input.deviceId)).limit(1);
    if (!other.length) await tx.delete(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, input.deviceId));
  });
}

/**
 * Serials changed since the device's last tag. Revoked passes are included so the device fetches their voided version.
 * The device library identifier acts as the secret here (Apple sends no pass token on this call): it is never logged
 * by the application and the route is rate limited per device and peer.
 */
export async function listUpdatedApplePasses(deviceId: string, passTypeId: string, previousLastUpdated?: string): Promise<{ serialNumbers: string[]; lastUpdated: string } | null> {
  if (!validAppleDeviceId(deviceId)) throw new DomainError("INVALID_DEVICE", "Invalid device identifier");
  const since = previousLastUpdated === undefined || previousLastUpdated === "" ? -1 : Number(previousLastUpdated);
  if (!Number.isSafeInteger(since) || since < -1) throw new DomainError("INVALID_TAG", "Invalid update tag");
  const rows = await db.select({ serialNumber: appleRegistrations.serialNumber, updatedAt: walletPasses.updatedAt })
    .from(appleRegistrations)
    .innerJoin(walletPasses, and(sql`${walletPasses.id}::text = ${appleRegistrations.serialNumber}`, eq(walletPasses.tenantId, appleRegistrations.tenantId), eq(walletPasses.membershipId, appleRegistrations.membershipId), eq(walletPasses.provider, "apple")))
    .where(and(eq(appleRegistrations.deviceLibraryIdentifier, deviceId), eq(appleRegistrations.passTypeIdentifier, passTypeId)));
  const changed = rows.filter((row) => row.updatedAt.getTime() > since);
  if (!changed.length) return null;
  return { serialNumbers: changed.map((row) => row.serialNumber), lastUpdated: String(Math.max(...changed.map((row) => row.updatedAt.getTime()))) };
}
