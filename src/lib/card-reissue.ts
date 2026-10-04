import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, notExists } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appleDevices, appleRegistrations, cardSecurityEvents, memberships, outboxJobs, programs, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";

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
 *  - Apple Wallet registrations of the old pass are removed, and the Apple pass token is bound to the scan code, so an
 *    old pass can no longer fetch updates (which would otherwise carry the new QR code).
 * Google Wallet objects live in the customer's Google account and cannot be revoked from here (ledger O-026).
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
    const [staff] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, member.tenantId), eq(staffRoles.userId, parsed.actorUserId), eq(staffRoles.active, true)));
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
    const dropped = await tx.delete(appleRegistrations).where(and(eq(appleRegistrations.tenantId, member.tenantId), eq(appleRegistrations.membershipId, member.id))).returning({ deviceId: appleRegistrations.deviceLibraryIdentifier });
    if (dropped.length) {
      // A device that served only this card has no reason to stay on file; devices that hold other cards keep them.
      await tx.delete(appleDevices).where(and(
        inArray(appleDevices.deviceLibraryIdentifier, dropped.map(row => row.deviceId)),
        notExists(tx.select({ one: appleRegistrations.deviceLibraryIdentifier }).from(appleRegistrations).where(eq(appleRegistrations.deviceLibraryIdentifier, appleDevices.deviceLibraryIdentifier))),
      ));
    }
    await tx.insert(cardSecurityEvents).values({
      tenantId: member.tenantId, membershipId: member.id, action: "card_reissued_by_staff", actorUserId: parsed.actorUserId,
      reason: parsed.reason, verificationMethod: parsed.verificationMethod, idempotencyKey: parsed.idempotencyKey,
    });
    // Saved Wallet passes carry the old scan code; the refresh job replaces it where a provider is configured.
    await tx.insert(outboxJobs).values({ tenantId: member.tenantId, kind: "wallet.refresh", payload: { membershipId: member.id } });
    return { membershipId: member.id, cardToken, duplicate: false };
  });
}
