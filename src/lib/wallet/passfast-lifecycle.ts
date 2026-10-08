import { and, eq, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { walletPasses } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { walletCardSnapshot } from "./data";
import { PassFastClient, PassFastError, assertPassFastBinding, isPassFastObjectId, passFastConfig, passFastData, passFastSerial, passFastVoidData, PASSFAST_OPERATION_MS } from "./passfast";

/** Same pass lock for initial creation and every refresh. Never take a member lock here (lifecycle takes member -> pass).
 * Pending identity and recovery job committed before any provider request. On a lost response we look up the same serial,
 * not a new credential or pass. Reissue/closure never invoke generate or send the replacement credential to an old serial.
 */
export async function syncPassFastPass(passId: string, deps: { client?: PassFastClient; tenantId?: string; deadline?: number } = {}): Promise<{ saveUrl?: string }> {
  const deadline = deps.deadline ?? Date.now() + PASSFAST_OPERATION_MS;
  // Commit uncertainty before any remote operation. A rolled-back transaction must not erase a possible create.
  await db.transaction(async tx => {
    if (deadline <= Date.now()) throw new PassFastError();
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
    const [candidate] = await tx.select().from(walletPasses).where(and(eq(walletPasses.id, passId), deps.tenantId ? eq(walletPasses.tenantId, deps.tenantId) : undefined));
    if (!candidate || !isPassFastObjectId(candidate.providerObjectId)) throw new DomainError("NOT_FOUND", "Card not found");
    const candidateSnapshot = await walletCardSnapshot(candidate.membershipId, tx);
    const candidateBrand = candidateSnapshot.open ? candidateSnapshot.pass : candidateSnapshot.brand;
    const candidateConfig = passFastConfig(process.env, candidate.tenantId, candidateBrand.locationId);
    if (candidateBrand.tenantId !== candidate.tenantId || !candidateConfig.platforms.includes(candidate.provider as "apple" | "google")) throw new PassFastError();
    assertPassFastBinding(candidate.providerObjectId, candidateConfig);
    await tx.update(walletPasses).set({ status: "creating" }).where(and(eq(walletPasses.id, passId),
      deps.tenantId ? eq(walletPasses.tenantId, deps.tenantId) : undefined, eq(walletPasses.status, "pending"),
      isNull(walletPasses.revokedAt), like(walletPasses.providerObjectId, "passfast:%")));
  });
  return db.transaction(async tx => {
    if (deadline <= Date.now()) throw new PassFastError();
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
    const [row] = await tx.select().from(walletPasses).where(and(eq(walletPasses.id, passId), deps.tenantId ? eq(walletPasses.tenantId, deps.tenantId) : undefined)).for("update");
    if (!row || !isPassFastObjectId(row.providerObjectId)) throw new DomainError("NOT_FOUND", "Card not found");
    if (row.status === "revoked") return {};
    const snapshot = await walletCardSnapshot(row.membershipId, tx);
    const brand = snapshot.open ? snapshot.pass : snapshot.brand;
    const config = passFastConfig(process.env, row.tenantId, brand.locationId);
    if (brand.tenantId !== row.tenantId || !config.platforms.includes(row.provider as "apple" | "google")) throw new PassFastError();
    assertPassFastBinding(row.providerObjectId, config);
    const client = deps.client ?? new PassFastClient(config, fetch, deadline);
    if (client.config.appId !== config.appId || client.config.templateId !== config.templateId
      || (client.config.tenantId && client.config.tenantId !== row.tenantId)
      || (client.config.locationId && client.config.locationId !== brand.locationId)) throw new PassFastError();
    const serial = passFastSerial(row.providerObjectId);

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
