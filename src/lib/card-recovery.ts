import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cardRecoveryChallenges, cardSecurityEvents, membershipContacts, memberships, outboxJobs, programs, tenants } from "@/db/schema";
import { recoveryTokenForChallenge, recoveryTokenHash } from "./contact-token";
import { emailTransportMode } from "./transactional-email";
import { DomainError } from "./loyalty";

const emailInput = z.email().max(320);
const invalid = () => new DomainError("INVALID_RECOVERY", "Dieser Wiederherstellungslink ist ungültig oder abgelaufen.");
export const recoveryGenericMessage = "Wenn zu dieser Adresse eine wiederherstellbare Karte gehört, haben wir dir einen Link geschickt.";

export function normalizeRecoveryEmail(value: string) {
  return emailInput.parse(value.trim().normalize("NFC").toLowerCase());
}

function requireAvailable() {
  if (emailTransportMode() === "disabled") throw new DomainError("RECOVERY_DISABLED", "E-Mail-Wiederherstellung ist derzeit nicht verfügbar.");
}

export async function requestCardRecovery(rawEmail: string): Promise<{ message: string }> {
  requireAvailable();
  const email = normalizeRecoveryEmail(rawEmail);
  await db.transaction(async tx => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '15s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`);
    // Lock the live card after acquiring the email lock. An earlier match can
    // become closed while waiting, and must never authorize a new challenge.
    const [member] = await tx.select({ tenantId: memberships.tenantId, membershipId: memberships.id })
      .from(membershipContacts).innerJoin(memberships, and(eq(memberships.tenantId, membershipContacts.tenantId), eq(memberships.id, membershipContacts.membershipId)))
      .where(and(eq(membershipContacts.email, email), eq(membershipContacts.emailVerified, true), isNull(memberships.closedAt)))
      .orderBy(memberships.id).limit(1).for("update", { of: memberships });
    if (!member) return;
    const [contact] = await tx.select().from(membershipContacts).where(and(
      eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.membershipId),
      eq(membershipContacts.email, email), eq(membershipContacts.emailVerified, true),
    ));
    if (!contact) return;
    await tx.delete(cardRecoveryChallenges).where(eq(cardRecoveryChallenges.email, email));
    const id = randomUUID();
    await tx.insert(cardRecoveryChallenges).values({ id, email, tokenHash: recoveryTokenHash(recoveryTokenForChallenge(id)), expiresAt: new Date(Date.now() + 20 * 60_000) });
    await tx.insert(outboxJobs).values({ tenantId: member.tenantId, kind: "email.recover", payload: { challengeId: id } });
  });
  return { message: recoveryGenericMessage };
}

async function validChallenge(token: string) {
  let hash: string;
  try { hash = recoveryTokenHash(token); } catch { throw invalid(); }
  const [challenge] = await db.select().from(cardRecoveryChallenges).where(eq(cardRecoveryChallenges.tokenHash, hash));
  if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) throw invalid();
  return challenge;
}

export async function recoveryOptions(token: string) {
  const challenge = await validChallenge(token);
  const cards = await db.select({ membershipId: memberships.id, tenantId: memberships.tenantId, merchantName: tenants.name, programmeName: programs.name })
    .from(membershipContacts).innerJoin(memberships, and(eq(memberships.tenantId, membershipContacts.tenantId), eq(memberships.id, membershipContacts.membershipId)))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .where(and(eq(membershipContacts.email, challenge.email), eq(membershipContacts.emailVerified, true), isNull(memberships.closedAt)));
  if (!cards.length) throw invalid();
  return { cards };
}

/** GET never invokes this operation. The POST rotates exactly one bearer credential. */
export async function completeCardRecovery(token: string, membershipId: string) {
  const challenge = await validChallenge(token);
  return db.transaction(async tx => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '15s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${challenge.email}, 0))`);
    // Closure and email delivery also lock the member before its challenge.
    const [member] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for("update");
    if (!member || member.closedAt) throw invalid();
    const [current] = await tx.select().from(cardRecoveryChallenges).where(eq(cardRecoveryChallenges.id, challenge.id)).for("update");
    if (!current || current.consumedAt || current.expiresAt <= new Date()) throw invalid();
    const [contact] = await tx.select().from(membershipContacts)
      .where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id))).for("update");
    if (!contact || !contact.emailVerified || contact.email !== current.email) throw invalid();
    const cardToken = `card_${randomBytes(32).toString("base64url")}`;
    await tx.update(memberships).set({ cardToken }).where(and(eq(memberships.id, member.id), eq(memberships.tenantId, member.tenantId), isNull(memberships.closedAt)));
    await tx.delete(cardRecoveryChallenges).where(eq(cardRecoveryChallenges.email, current.email));
    await tx.insert(cardSecurityEvents).values({ tenantId: member.tenantId, membershipId: member.id, action: "card_credential_rotated" });
    await tx.insert(outboxJobs).values({ tenantId: member.tenantId, kind: "email.recovery_notice", payload: { membershipId: member.id } });
    return { cardToken, membershipId: member.id };
  });
}
