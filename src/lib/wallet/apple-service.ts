import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { appleDevices, appleRegistrations, memberships, walletPasses } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { validApplePassToken, type ApplePassConfig } from "./apple";
import { walletPassDataByMembershipId } from "./data";

type RegistrationInput = { deviceId: string; passTypeId: string; serial: string; authorization: string; pushToken: string };

function authorized(input: Omit<RegistrationInput, "pushToken">, config: ApplePassConfig) {
  if (input.passTypeId !== config.passTypeId || !/^ApplePass [A-Za-z0-9_-]+$/.test(input.authorization) || !validApplePassToken(input.serial, input.authorization.slice(10), config)) {
    throw new DomainError("FORBIDDEN", "Invalid pass authentication");
  }
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(input.deviceId)) throw new DomainError("INVALID_DEVICE", "Invalid device identifier");
}

export async function registeredApplePass(input: Omit<RegistrationInput, "deviceId" | "pushToken">, config: ApplePassConfig) {
  if (input.passTypeId !== config.passTypeId || !/^ApplePass [A-Za-z0-9_-]+$/.test(input.authorization) || !validApplePassToken(input.serial, input.authorization.slice(10), config)) {
    throw new DomainError("FORBIDDEN", "Invalid pass authentication");
  }
  const [issued] = await db.select().from(walletPasses).where(and(eq(walletPasses.membershipId, input.serial), eq(walletPasses.provider, "apple")));
  if (!issued) throw new DomainError("NOT_FOUND", "Pass not found");
  return walletPassDataByMembershipId(input.serial);
}

export async function registerAppleDevice(input: RegistrationInput, config: ApplePassConfig): Promise<200 | 201> {
  authorized(input, config);
  if (!/^[a-f0-9]{32,300}$/i.test(input.pushToken)) throw new DomainError("INVALID_TOKEN", "Invalid Apple push token");
  const pass = await registeredApplePass(input, config);
  return db.transaction(async (tx) => {
    const [member] = await tx.select({ id: memberships.id, closedAt: memberships.closedAt }).from(memberships)
      .where(and(eq(memberships.tenantId, pass.tenantId), eq(memberships.id, pass.membershipId))).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Pass not found");
    await tx.update(walletPasses).set({ status: "registered" }).where(and(eq(walletPasses.membershipId, pass.membershipId), eq(walletPasses.provider, "apple")));
    await tx.insert(appleDevices).values({ deviceLibraryIdentifier: input.deviceId, pushToken: input.pushToken })
      .onConflictDoUpdate({ target: appleDevices.deviceLibraryIdentifier, set: { pushToken: input.pushToken, updatedAt: new Date() } });
    const inserted = await tx.insert(appleRegistrations).values({ deviceLibraryIdentifier: input.deviceId, tenantId: pass.tenantId, membershipId: pass.membershipId, passTypeIdentifier: input.passTypeId, serialNumber: input.serial })
      .onConflictDoNothing().returning({ deviceLibraryIdentifier: appleRegistrations.deviceLibraryIdentifier });
    return inserted.length ? 201 : 200;
  });
}

export async function unregisterAppleDevice(input: Omit<RegistrationInput, "pushToken">, config: ApplePassConfig): Promise<void> {
  authorized(input, config);
  await registeredApplePass(input, config);
  await db.transaction(async (tx) => {
    await tx.delete(appleRegistrations).where(and(eq(appleRegistrations.deviceLibraryIdentifier, input.deviceId), eq(appleRegistrations.passTypeIdentifier, input.passTypeId), eq(appleRegistrations.serialNumber, input.serial)));
    const other = await tx.select({ id: appleRegistrations.deviceLibraryIdentifier }).from(appleRegistrations).where(eq(appleRegistrations.deviceLibraryIdentifier, input.deviceId)).limit(1);
    if (!other.length) await tx.delete(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, input.deviceId));
  });
}

export async function listUpdatedApplePasses(deviceId: string, passTypeId: string, previousLastUpdated?: string): Promise<{ serialNumbers: string[]; lastUpdated: string } | null> {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(deviceId)) throw new DomainError("INVALID_DEVICE", "Invalid device identifier");
  const since = previousLastUpdated === undefined ? -1 : Number(previousLastUpdated);
  if (!Number.isSafeInteger(since) || since < -1) throw new DomainError("INVALID_TAG", "Invalid update tag");
  const rows = await db.select({ serialNumber: appleRegistrations.serialNumber, updatedAt: walletPasses.updatedAt })
    .from(appleRegistrations)
    .innerJoin(walletPasses, and(eq(walletPasses.membershipId, appleRegistrations.membershipId), eq(walletPasses.tenantId, appleRegistrations.tenantId), eq(walletPasses.provider, "apple")))
    .innerJoin(memberships, and(eq(memberships.id, appleRegistrations.membershipId), eq(memberships.tenantId, appleRegistrations.tenantId)))
    .where(and(eq(appleRegistrations.deviceLibraryIdentifier, deviceId), eq(appleRegistrations.passTypeIdentifier, passTypeId), isNull(memberships.closedAt)));
  const changed = rows.filter((row) => row.updatedAt.getTime() > since);
  if (!changed.length) return null;
  return { serialNumbers: changed.map((row) => row.serialNumber), lastUpdated: String(Math.max(...changed.map((row) => row.updatedAt.getTime()))) };
}
