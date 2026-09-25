import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appleDevices, appleRegistrations, automationRuns, consentEvents, contactVerificationChallenges, membershipContacts, memberships, outboxJobs, walletPasses } from "@/db/schema";
import { DomainError } from "./loyalty";

const cardTokenPattern = /^card_[A-Za-z0-9_-]{32,80}$/;

export function validCardToken(token: string) {
  return cardTokenPattern.test(token);
}

/**
 * Close a bearer card under its membership row lock. This removes contact and
 * recovery details and retires both bearer and checkout identifiers. The
 * pseudonymous membership, consent history, redemptions and append-only ledger
 * remain until the operator has an approved retention schedule.
 */
export async function closeCard(cardToken: string): Promise<{ closed: true; retention: "pseudonymous-ledger-and-consent-pending-policy" }> {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  return db.transaction(async (tx) => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.cardToken, cardToken)).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");

    await tx.delete(contactVerificationChallenges).where(and(eq(contactVerificationChallenges.tenantId, member.tenantId), eq(contactVerificationChallenges.membershipId, member.id)));
    await tx.delete(membershipContacts).where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id)));
    await tx.insert(consentEvents).values({ tenantId: member.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "2026-09", source: "card_closure" });
    // Queued local messages and wallet refreshes cannot run after closure. Clear
    // message bodies even from completed outbox rows; retain only the membership
    // reference needed to explain the job state.
    await tx.update(outboxJobs).set({
      payload: { membershipId: member.id },
      status: sql`case when ${outboxJobs.status} in ('pending','retry','processing','blocked') then 'suppressed' else ${outboxJobs.status} end`,
      lastError: sql`case when ${outboxJobs.status} in ('pending','retry','processing','blocked') then 'Card closed' else ${outboxJobs.lastError} end`,
    }).where(and(eq(outboxJobs.tenantId, member.tenantId), sql`${outboxJobs.payload} ->> 'membershipId' = ${member.id}`));
    await tx.update(automationRuns).set({ status: "suppressed", reason: "Card closed" })
      .where(and(eq(automationRuns.tenantId, member.tenantId), eq(automationRuns.membershipId, member.id), eq(automationRuns.status, "queued")));
    // There is no live provider revocation adapter yet. Keep issued-pass rows
    // visible to an operator as explicit pending work; the retired scan code
    // and closedAt gate prevent checkout and fresh pass issuance meanwhile.
    await tx.update(walletPasses).set({ status: "revocation_pending", updatedAt: new Date() })
      .where(and(eq(walletPasses.tenantId, member.tenantId), eq(walletPasses.membershipId, member.id)));

    const registeredDevices = await tx.select({ deviceId: appleRegistrations.deviceLibraryIdentifier }).from(appleRegistrations)
      .where(and(eq(appleRegistrations.tenantId, member.tenantId), eq(appleRegistrations.membershipId, member.id)));
    await tx.delete(appleRegistrations)
      .where(and(eq(appleRegistrations.tenantId, member.tenantId), eq(appleRegistrations.membershipId, member.id)));
    for (const deviceId of new Set(registeredDevices.map(row => row.deviceId))) {
      const [otherRegistration] = await tx.select({ deviceId: appleRegistrations.deviceLibraryIdentifier }).from(appleRegistrations)
        .where(eq(appleRegistrations.deviceLibraryIdentifier, deviceId)).limit(1);
      if (!otherRegistration) await tx.delete(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, deviceId));
    }

    await tx.update(memberships).set({
      scanCode: `retired_sc_${randomBytes(24).toString("base64url")}`,
      cardToken: `retired_card_${randomBytes(32).toString("base64url")}`,
      closedAt: new Date(),
    }).where(and(eq(memberships.tenantId, member.tenantId), eq(memberships.id, member.id)));
    return { closed: true as const, retention: "pseudonymous-ledger-and-consent-pending-policy" as const };
  });
}
