import { and, eq, isNull, like } from "drizzle-orm";
import { db } from "@/db";
import { walletPasses } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { walletCardSnapshot } from "./data";
import { PassFastClient, PassFastError, isPassFastObjectId, passFastConfig, passFastData, passFastSerial, passFastVoidData } from "./passfast";

/** Same pass lock for initial creation and every refresh. Never take a member lock here (lifecycle takes member -> pass).
 * Pending identity and recovery job committed before any provider request. On a lost response we look up the same serial,
 * not a new credential or pass. Reissue/closure never invoke generate or send the replacement credential to an old serial.
 */
export async function syncPassFastPass(passId: string, deps: { client?: PassFastClient; tenantId?: string } = {}): Promise<{ saveUrl?: string }> {
  const client = deps.client ?? new PassFastClient(passFastConfig());
  // Commit uncertainty before any remote operation. A rolled-back transaction must not erase a possible create.
  await db.update(walletPasses).set({ status: "creating" }).where(and(eq(walletPasses.id, passId),
    deps.tenantId ? eq(walletPasses.tenantId, deps.tenantId) : undefined, eq(walletPasses.status, "pending"),
    isNull(walletPasses.revokedAt), like(walletPasses.providerObjectId, "passfast:%")));
  return db.transaction(async tx => {
    const [row] = await tx.select().from(walletPasses).where(and(eq(walletPasses.id, passId), deps.tenantId ? eq(walletPasses.tenantId, deps.tenantId) : undefined)).for("update");
    if (!row || !isPassFastObjectId(row.providerObjectId)) throw new DomainError("NOT_FOUND", "Card not found");
    if (row.status === "revoked") return {};
    const serial = passFastSerial(row.providerObjectId);
    const snapshot = await walletCardSnapshot(row.membershipId, tx);
    const live = snapshot.open && row.revokedAt === null && snapshot.credentialHash === row.credentialHash;
    if (!live) {
      const existing = await client.get(serial, row.provider as "apple" | "google");
      // Do not manufacture a pass for a revoked credential or interpret an uncertain timed-out create as absent forever.
      if (!existing) throw new PassFastError(404);
      if (existing.status === "active") {
        const brand = snapshot.open ? snapshot.pass : snapshot.brand;
        await client.update(serial, row.provider as "apple" | "google", { merchantName: brand.merchantName, programName: brand.programName,
          locationName: brand.locationName, locale: brand.locale, programType: brand.programType ?? "stamp", ...passFastVoidData });
      }
      await client.void(serial, row.provider as "apple" | "google");
      await tx.update(walletPasses).set({ status: "revoked", revokedAt: row.revokedAt ?? new Date(), revokeReason: row.revokeReason ?? (snapshot.open ? "superseded" : "closed"), syncedAt: new Date() }).where(eq(walletPasses.id, row.id));
      return {};
    }
    const platform = row.provider as "apple" | "google";
    let existing = await client.get(serial, platform);
    if (!existing) {
      await client.generate(serial, platform, passFastData(snapshot.pass));
      existing = await client.get(serial, platform);
    }
    if (existing?.status !== "active") throw new PassFastError();
    // get_or_create returns an existing snapshot. Always align its current display before issuing a save/download result.
    await client.update(serial, platform, passFastData(snapshot.pass));
    const current = platform === "google" ? await client.get(serial, platform) : existing;
    if (current?.status !== "active") throw new PassFastError();
    await tx.update(walletPasses).set({ status: ["pending", "creating"].includes(row.status) ? "created" : row.status, syncedAt: new Date(), updatedAt: new Date() }).where(eq(walletPasses.id, row.id));
    return { ...(current.saveUrl ? { saveUrl: current.saveUrl } : {}) };
  });
}
