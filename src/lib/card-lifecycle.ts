import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { automationRuns, consentEvents, contactVerificationChallenges, membershipContacts, memberships, outboxJobs } from "@/db/schema";
import { DomainError } from "./loyalty";
import { revokeCardWalletPasses } from "./wallet/enqueue";

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
    // Queued local messages and wallet refreshes cannot run after closure (the
    // one Wallet revocation job is queued below). Clear message bodies even from
    // completed outbox rows; retain only the membership reference needed to
    // explain the job state.
    await tx.update(outboxJobs).set({
      payload: { membershipId: member.id },
      status: sql`case when ${outboxJobs.status} in ('pending','retry','processing','blocked') then 'suppressed' else ${outboxJobs.status} end`,
      lastError: sql`case when ${outboxJobs.status} in ('pending','retry','processing','blocked') then 'Card closed' else ${outboxJobs.lastError} end`,
    }).where(and(eq(outboxJobs.tenantId, member.tenantId), sql`${outboxJobs.payload} ->> 'membershipId' = ${member.id}`));
    await tx.update(automationRuns).set({ status: "suppressed", reason: "Card closed" })
      .where(and(eq(automationRuns.tenantId, member.tenantId), eq(automationRuns.membershipId, member.id), eq(automationRuns.status, "queued")));
    // Saved Wallet passes are revoked, not forgotten: the worker pushes Apple devices to a voided pass (no QR code, no
    // balance) and deactivates Google objects. Apple device registrations of the card stay only until that is
    // delivered (pruned 7 days after revocation by the worker). The pass rows remain as history.
    await revokeCardWalletPasses(tx, member.tenantId, member.id, "closed");

    await tx.update(memberships).set({
      scanCode: `retired_sc_${randomBytes(24).toString("base64url")}`,
      cardToken: `retired_card_${randomBytes(32).toString("base64url")}`,
      closedAt: new Date(),
    }).where(and(eq(memberships.tenantId, member.tenantId), eq(memberships.id, member.id)));
    return { closed: true as const, retention: "pseudonymous-ledger-and-consent-pending-policy" as const };
  });
}
