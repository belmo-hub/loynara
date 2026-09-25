import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appleDevices, appleRegistrations, walletPasses } from "@/db/schema";
import { appleSigningConfig, appleWalletStatus } from "./apple";
import { sendApplePassNotifications } from "./apple-push";
import { walletPassDataByMembershipId } from "./data";
import { googleConfig, googleWalletStatus, GoogleWalletClient } from "./google";

export type WalletRefreshResult = { status: "complete" } | { status: "blocked"; reason: string };

export async function refreshWalletForMembership(membershipId: string): Promise<WalletRefreshResult> {
  const issued = await db.select().from(walletPasses).where(eq(walletPasses.membershipId, membershipId));
  if (!issued.length) return { status: "complete" };
  const pass = await walletPassDataByMembershipId(membershipId);
  const blocked: string[] = [];
  for (const issuedPass of issued) {
    if (issuedPass.provider === "google") {
      const status = googleWalletStatus();
      if (!status.ready) { blocked.push(`Google Wallet: ${status.reason}`); continue; }
      const config = googleConfig();
      await new GoogleWalletClient(config).upsert(pass, config);
      await db.update(walletPasses).set({ updatedAt: new Date() }).where(eq(walletPasses.id, issuedPass.id));
    } else if (issuedPass.provider === "apple") {
      const status = appleWalletStatus();
      if (!status.ready) { blocked.push(`Apple Wallet: ${status.reason}`); continue; }
      const config = appleSigningConfig();
      await db.update(walletPasses).set({ updatedAt: sql`greatest(now(), ${walletPasses.updatedAt} + interval '1 millisecond')` }).where(eq(walletPasses.id, issuedPass.id));
      const devices = await db.select({ deviceId: appleDevices.deviceLibraryIdentifier, pushToken: appleDevices.pushToken })
        .from(appleRegistrations)
        .innerJoin(appleDevices, eq(appleDevices.deviceLibraryIdentifier, appleRegistrations.deviceLibraryIdentifier))
        .where(and(eq(appleRegistrations.membershipId, membershipId), eq(appleRegistrations.passTypeIdentifier, config.passTypeId)));
      const invalid = await sendApplePassNotifications(devices, config);
      for (const deviceId of invalid) {
        await db.transaction(async (tx) => {
          await tx.delete(appleRegistrations).where(eq(appleRegistrations.deviceLibraryIdentifier, deviceId));
          await tx.delete(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, deviceId));
        });
      }
    }
  }
  return blocked.length ? { status: "blocked", reason: blocked.join("; ") } : { status: "complete" };
}
