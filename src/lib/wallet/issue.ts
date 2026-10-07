import { randomUUID } from "node:crypto";
import { and, eq, isNull, like } from "drizzle-orm";
import { db } from "@/db";
import { memberships, walletPasses } from "@/db/schema";
import { validCardToken } from "@/lib/card-lifecycle";
import { DomainError } from "@/lib/loyalty";
import { credentialHash } from "./data";
import { enqueueWalletRefresh } from "./enqueue";
import type { WalletProvider } from "./types";
import { isPassFastObjectId } from "./passfast";

export type IssuedPass = typeof walletPasses.$inferSelect;

/**
 * Finds or creates the ACTIVE pass row for a card's current credential. Runs under the membership row lock that staff
 * reissue and closure also take, so a pass can never be minted for a scan code that is being rotated.
 *  - Same credential: the existing row is returned, so downloading or saving twice yields the same serial/object.
 *  - Older credential still marked active (should not happen; defence in depth): it is revoked and a refresh queued.
 * The provider object itself is created by the caller AFTER commit; provider latency never holds the card lock.
 */
export async function issueWalletPass(cardToken: string, provider: WalletProvider, objectIdFor: (passId: string) => string): Promise<IssuedPass> {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  return db.transaction(async tx => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.cardToken, cardToken)).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    const hash = credentialHash(member.scanCode);
    const [active] = await tx.select().from(walletPasses)
      .where(and(eq(walletPasses.tenantId, member.tenantId), eq(walletPasses.membershipId, member.id), eq(walletPasses.provider, provider), isNull(walletPasses.revokedAt)));
    if (active?.credentialHash === hash && isPassFastObjectId(active.providerObjectId) === isPassFastObjectId(objectIdFor(active.id))) return active;
    if (active) {
      await tx.update(walletPasses).set({ revokedAt: new Date(), revokeReason: "superseded", status: active.status === "pending" && (provider === "apple" || isPassFastObjectId(active.providerObjectId)) ? "revoked" : "revocation_pending", updatedAt: new Date() }).where(eq(walletPasses.id, active.id));
      await enqueueWalletRefresh(tx, member.tenantId, member.id);
    }
    const id = randomUUID();
    let providerObjectId = objectIdFor(id);
    if (isPassFastObjectId(providerObjectId)) {
      // One opaque generation serial across both platforms, with separate local rows and explicit API wallet_type.
      // The membership lock serializes first issuance. A revoked/older-generation row can never donate its serial.
      const [sibling] = await tx.select({ providerObjectId: walletPasses.providerObjectId }).from(walletPasses)
        .where(and(eq(walletPasses.tenantId, member.tenantId), eq(walletPasses.membershipId, member.id),
          eq(walletPasses.credentialHash, hash), isNull(walletPasses.revokedAt), like(walletPasses.providerObjectId, "passfast:%"))).limit(1);
      if (sibling) providerObjectId = sibling.providerObjectId;
    }
    const [created] = await tx.insert(walletPasses).values({ id, tenantId: member.tenantId, membershipId: member.id, provider, providerObjectId, status: "pending", credentialHash: hash }).returning();
    if (isPassFastObjectId(created.providerObjectId)) await enqueueWalletRefresh(tx, member.tenantId, member.id);
    return created;
  });
}

/** The active row behind a download ticket, only while it still belongs to the card's current credential. */
export async function activeApplePass(passId: string): Promise<IssuedPass | null> {
  const [row] = await db.select().from(walletPasses).where(and(eq(walletPasses.id, passId), eq(walletPasses.provider, "apple"), isNull(walletPasses.revokedAt)));
  return row ?? null;
}
