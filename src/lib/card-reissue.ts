import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cardSecurityEvents, memberships, outboxJobs, programs, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";

const input = z.object({
  actorUserId: z.string().min(1),
  locationId: z.uuid(),
  membershipId: z.uuid(),
  reason: z.string().trim().min(10).max(240),
});

/**
 * Staff-assisted reissue for a customer who lost the card link (new phone, deleted bookmark). The SAME membership
 * keeps its balance, card number, ledger and referral history; only the bearer credentials rotate, so the old link
 * and the old QR code stop working everywhere. Nothing is copied to another card and nothing is booked.
 *
 * Human boundary: Loynara cannot prove who is standing at the counter. The owner or manager confirms entitlement
 * (for example the card number together with something only the customer knows) and records a reason, which is
 * kept with the actor in card_security_events.
 */
export async function reissueCardByStaff(raw: z.input<typeof input>): Promise<{ membershipId: string; cardToken: string }> {
  const parsed = input.parse(raw);
  return db.transaction(async tx => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.id, parsed.membershipId)).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    const [program] = await tx.select({ locationId: programs.locationId }).from(programs).where(and(eq(programs.id, member.programId), eq(programs.tenantId, member.tenantId)));
    if (!program || program.locationId !== parsed.locationId) throw new DomainError("NOT_FOUND", "Card not found at this location");
    const [staff] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, member.tenantId), eq(staffRoles.userId, parsed.actorUserId), eq(staffRoles.active, true)));
    if (!staff || staff.role === "cashier" || (staff.role === "manager" && staff.locationId !== parsed.locationId)) throw new DomainError("FORBIDDEN", "Manager or owner access required");
    const cardToken = `card_${randomBytes(32).toString("base64url")}`;
    const scanCode = `sc_${randomBytes(24).toString("base64url")}`;
    await tx.update(memberships).set({ cardToken, scanCode }).where(and(eq(memberships.id, member.id), eq(memberships.tenantId, member.tenantId), isNull(memberships.closedAt)));
    await tx.insert(cardSecurityEvents).values({ tenantId: member.tenantId, membershipId: member.id, action: "card_reissued_by_staff", actorUserId: parsed.actorUserId, reason: parsed.reason });
    // A saved Wallet pass carries the old scan code; the refresh job replaces it where a provider is configured.
    await tx.insert(outboxJobs).values({ tenantId: member.tenantId, kind: "wallet.refresh", payload: { membershipId: member.id } });
    return { membershipId: member.id, cardToken };
  });
}
