import { randomUUID } from "node:crypto";
import { and, eq, isNull, like } from "drizzle-orm";
import { db } from "@/db";
import { memberships, walletPasses } from "@/db/schema";
import { validCardToken } from "@/lib/card-lifecycle";
import { DomainError } from "@/lib/loyalty";
import { credentialHash } from "./data";
import { enqueueWalletRefresh } from "./enqueue";
import type { WalletProvider } from "./types";
import { isPassFastObjectId, passFastConfig, bindPassFastObjectId, assertPassFastBinding, type PassFastConfig, passFastSerial } from "./passfast";
import { walletCardEligibility } from "./eligibility";
import { googleDirectConfig } from "./google-direct";
import { googleObjectId } from "./google";
import { passFastEnv } from "./template-bindings";

export type IssuedPass = typeof walletPasses.$inferSelect;

/**
 * Finds or creates the ACTIVE pass row for a card's current credential. Runs under the membership row lock that staff
 * reissue and closure also take, so a pass can never be minted for a scan code that is being rotated.
 *  - Same credential: the existing row is returned, so downloading or saving twice yields the same serial/object.
 *  - Older credential still marked active (should not happen; defence in depth): it is revoked and a refresh queued.
 * The provider object itself is created by the caller AFTER commit; provider latency never holds the card lock.
 */
export async function issueWalletPass(cardToken: string, provider: WalletProvider, objectIdFor: (passId: string) => string, database: Pick<typeof db, "transaction"> = db): Promise<IssuedPass> {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  return database.transaction(async tx => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.cardToken, cardToken)).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    let managedConfig: PassFastConfig | undefined;
    if (provider === "google") {
      const eligibility = await walletCardEligibility(cardToken, tx);
      if (eligibility.availability.google === "unavailable") throw new DomainError("FORBIDDEN", "Wallet unavailable");
      const config = googleDirectConfig(process.env, eligibility.tenantId, eligibility.locationId, eligibility.programId);
      if (objectIdFor(member.id) !== googleObjectId(member.id, config)) throw new DomainError("FORBIDDEN", "Wallet unavailable");
    }
    // Refuse unmapped tenants before changing any projection or enqueueing work.
    if (isPassFastObjectId(objectIdFor(member.id))) {
      const eligibility = await walletCardEligibility(cardToken, tx);
      if (eligibility.availability[provider] !== "available") throw new DomainError("FORBIDDEN", "Wallet unavailable");
      managedConfig = passFastConfig(await passFastEnv(eligibility.tenantId, eligibility.locationId, tx), eligibility.tenantId, eligibility.locationId);
    }
    const hash = credentialHash(member.scanCode);
    const [active] = await tx.select().from(walletPasses)
      .where(and(eq(walletPasses.tenantId, member.tenantId), eq(walletPasses.membershipId, member.id), eq(walletPasses.provider, provider), isNull(walletPasses.revokedAt)));
    if (active?.credentialHash === hash && isPassFastObjectId(active.providerObjectId) === isPassFastObjectId(objectIdFor(active.id))) {
      if (managedConfig) assertPassFastBinding(active.providerObjectId, managedConfig);
      if (provider === "google" && active.providerObjectId !== objectIdFor(active.id)) throw new DomainError("FORBIDDEN", "Wallet unavailable");
      return active;
    }
    // Selecting Direct must not silently retire or convert a managed-provider projection.
    if (active && provider === "google" && isPassFastObjectId(active.providerObjectId)) throw new DomainError("FORBIDDEN", "Wallet unavailable");
    if (active) {
      await tx.update(walletPasses).set({ revokedAt: new Date(), revokeReason: "superseded", status: active.status === "pending" && (provider === "apple" || isPassFastObjectId(active.providerObjectId)) ? "revoked" : "revocation_pending", updatedAt: new Date() }).where(eq(walletPasses.id, active.id));
      await enqueueWalletRefresh(tx, member.tenantId, member.id);
    }
    const id = randomUUID();
    let providerObjectId = objectIdFor(id);
    if (managedConfig) {
      providerObjectId = bindPassFastObjectId(passFastSerial(providerObjectId), managedConfig);
      // One opaque generation serial across both platforms, with separate local rows and explicit API wallet_type.
      // The membership lock serializes first issuance. A revoked/older-generation row can never donate its serial.
      const [sibling] = await tx.select({ providerObjectId: walletPasses.providerObjectId }).from(walletPasses)
        .where(and(eq(walletPasses.tenantId, member.tenantId), eq(walletPasses.membershipId, member.id),
          eq(walletPasses.credentialHash, hash), isNull(walletPasses.revokedAt), like(walletPasses.providerObjectId, "passfast:%"))).limit(1);
      if (sibling) { assertPassFastBinding(sibling.providerObjectId, managedConfig); providerObjectId = sibling.providerObjectId; }
    }
    const [created] = await tx.insert(walletPasses).values({ id, tenantId: member.tenantId, membershipId: member.id, provider, providerObjectId, status: "pending", credentialHash: hash }).returning();
    if (isPassFastObjectId(created.providerObjectId) || provider === "google") await enqueueWalletRefresh(tx, member.tenantId, member.id);
    return created;
  });
}

/** The active row behind a download ticket, only while it still belongs to the card's current credential. */
export async function activeApplePass(passId: string, reader: Pick<typeof db, "select"> = db): Promise<IssuedPass | null> {
  const [row] = await reader.select().from(walletPasses).where(and(eq(walletPasses.id, passId), eq(walletPasses.provider, "apple"), isNull(walletPasses.revokedAt)));
  return row ?? null;
}
