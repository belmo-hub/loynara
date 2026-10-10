import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cardSecurityEvents, memberships, programs, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";
import { revokeCardWalletPasses } from "./wallet/enqueue";

/** How the merchant satisfied themselves that the person belongs to the card. A merchant statement, never proof by Loynara. */
export const VERIFICATION_METHODS = ["card_link", "stored_contact", "other_check"] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

const input = z.object({
  actorUserId: z.string().min(1),
  locationId: z.uuid(),
  membershipId: z.uuid(),
  reason: z.string().trim().min(10).max(240),
  verificationMethod: z.enum(VERIFICATION_METHODS),
  /** The explicit "Berechtigung geprüft" confirmation. Anything but literal true is refused. */
  entitlementConfirmed: z.literal(true),
  idempotencyKey: z.string().min(8).max(100),
});

export type ReissueResult = { membershipId: string; cardToken: string; duplicate: boolean };

/**
 * Staff-assisted reissue for a customer who lost the card link (new phone, deleted bookmark).
 *
 * The SAME membership keeps its balance, locator, ledger and referral history. Nothing is booked, nothing is copied to
 * another card, no visit is recorded, so analytics and referral qualification are unaffected. Only bearer access rotates:
 *  - the card token (link) and the scan code (QR) are replaced, so the old link and QR stop working everywhere;
 *  - an NFC tap cookie carries the old card token and therefore no longer resolves to the card;
 *  - every saved Wallet pass is revoked (lib/wallet/enqueue): an old Apple pass can only ever fetch a voided version
 *    without QR code or balance, an old Google object is set INACTIVE without barcode. A pass added from the new link is
 *    a new Apple serial / Google object, so Wallet never becomes a way around the reissue.
 *
 * Human boundary: Loynara cannot see who is standing at the counter. The owner or manager states that entitlement was
 * checked, names how, and gives a reason; actor, time, reason and method are kept in the append-only card_security_events.
 *
 * Retry: the same idempotency key from the same actor returns the current link again instead of rotating a second time.
 * Different keys are different decisions; the last one wins and every earlier link is dead.
 */
export async function reissueCardByStaff(raw: z.input<typeof input>): Promise<ReissueResult> {
  const parsed = input.parse(raw);
  return db.transaction(async tx => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.id, parsed.membershipId)).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    const [program] = await tx.select({ locationId: programs.locationId }).from(programs).where(and(eq(programs.id, member.programId), eq(programs.tenantId, member.tenantId)));
    if (!program || program.locationId !== parsed.locationId) throw new DomainError("NOT_FOUND", "Card not found at this location");
    // Match checkout/onboarding identity-before-role ordering. Authorized reissue holds the active role until commit;
    // revocation that owns it first makes PostgreSQL recheck the active predicate before any credential mutation.
    await tx.execute(sql`SELECT id FROM "user" WHERE id = ${parsed.actorUserId} FOR KEY SHARE`);
    const [staff] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, member.tenantId), eq(staffRoles.userId, parsed.actorUserId), eq(staffRoles.active, true))).for("share");
    if (!staff || staff.role === "cashier" || (staff.role === "manager" && staff.locationId !== parsed.locationId)) throw new DomainError("FORBIDDEN", "Manager or owner access required");

    const [prior] = await tx.select().from(cardSecurityEvents).where(and(eq(cardSecurityEvents.tenantId, member.tenantId), eq(cardSecurityEvents.idempotencyKey, parsed.idempotencyKey)));
    if (prior) {
      const [latest] = await tx.select({ id: cardSecurityEvents.id }).from(cardSecurityEvents)
        .where(and(eq(cardSecurityEvents.tenantId, member.tenantId), eq(cardSecurityEvents.membershipId, member.id), eq(cardSecurityEvents.action, "card_reissued_by_staff")))
        .orderBy(desc(cardSecurityEvents.createdAt), desc(cardSecurityEvents.id)).limit(1);
      if (prior.membershipId !== member.id || prior.actorUserId !== parsed.actorUserId || prior.action !== "card_reissued_by_staff" || latest?.id !== prior.id) throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      return { membershipId: member.id, cardToken: member.cardToken, duplicate: true };
    }

    const cardToken = `card_${randomBytes(32).toString("base64url")}`;
    const scanCode = `sc_${randomBytes(24).toString("base64url")}`;
    await tx.update(memberships).set({ cardToken, scanCode }).where(and(eq(memberships.id, member.id), eq(memberships.tenantId, member.tenantId), isNull(memberships.closedAt)));
    await tx.insert(cardSecurityEvents).values({
      tenantId: member.tenantId, membershipId: member.id, action: "card_reissued_by_staff", actorUserId: parsed.actorUserId,
      reason: parsed.reason, verificationMethod: parsed.verificationMethod, idempotencyKey: parsed.idempotencyKey,
    });
    // Saved Wallet passes belong to the OLD credential and may sit on the lost phone. They are revoked, never updated:
    // Apple devices fetch a voided pass, Google objects are deactivated. The customer adds a new pass from the new link.
    await revokeCardWalletPasses(tx, member.tenantId, member.id, "reissued");
    return { membershipId: member.id, cardToken, duplicate: false };
  });
}
