import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cardSecurityEvents, consentEvents, contactVerificationChallenges, membershipContacts, memberships, outboxJobs } from "@/db/schema";
import { validCardToken } from "./card-lifecycle";
import { verificationTokenForChallenge, verificationTokenHash } from "./contact-token";
import { DomainError } from "./loyalty";
import { emailTransportMode } from "./transactional-email";

const emailSchema = z.email().max(320);
const noticeVersion = "2026-09";

function localCaptureAllowed() {
  if (process.env.NODE_ENV === "production" || process.env.EXTERNAL_EMAIL_ENABLED === "true") return false;
  if (!["localhost", "127.0.0.1"].includes(process.env.SMTP_HOST ?? "")) return false;
  try {
    const publicUrl = new URL(process.env.PUBLIC_BASE_URL ?? "");
    const database = new URL(process.env.DATABASE_URL ?? "");
    return publicUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(publicUrl.hostname)
      && ["localhost", "127.0.0.1"].includes(database.hostname);
  } catch { return false; }
}

function syntheticEmail(email: string) { return email.toLowerCase().endsWith(".test"); }

async function cardInTransaction(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], cardToken: string) {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  const [member] = await tx.select().from(memberships).where(eq(memberships.cardToken, cardToken)).for("update");
  if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
  return member;
}

async function latestMarketingConsent(tenantId: string, membershipId: string) {
  const [event] = await db.select({ granted: consentEvents.granted }).from(consentEvents)
    .where(and(eq(consentEvents.tenantId, tenantId), eq(consentEvents.membershipId, membershipId), eq(consentEvents.channel, "email"), eq(consentEvents.purpose, "marketing")))
    .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id)).limit(1);
  return event?.granted === true;
}

export async function contactStatus(cardToken: string): Promise<{ available: boolean; contactPresent: boolean; emailVerified: boolean; marketingEmail: boolean }> {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  const [member] = await db.select({ id: memberships.id, tenantId: memberships.tenantId, closedAt: memberships.closedAt }).from(memberships).where(eq(memberships.cardToken, cardToken));
  if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
  const [contact] = await db.select({ email: membershipContacts.email, emailVerified: membershipContacts.emailVerified }).from(membershipContacts)
    .where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id)));
  const verified = Boolean(contact?.email && contact.emailVerified);
  return {
    available: emailTransportMode() !== "disabled", contactPresent: Boolean(contact?.email), emailVerified: verified,
    marketingEmail: verified && await latestMarketingConsent(member.tenantId, member.id),
  };
}

export async function requestContactVerification(cardToken: string, rawEmail: string): Promise<{ status: "queued" | "verified" }> {
  const email = emailSchema.parse(rawEmail.trim().normalize("NFC").toLowerCase());
  const mode = emailTransportMode();
  if (mode === "disabled") throw new DomainError("CONTACT_DISABLED", "Contact verification is unavailable");
  if (mode === "mailpit" && !syntheticEmail(email)) throw new DomainError("LOCAL_TEST_ONLY", "Only synthetic .test contacts are supported");
  return db.transaction(async tx => {
    const member = await cardInTransaction(tx, cardToken);
    const [contact] = await tx.select().from(membershipContacts)
      .where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id))).for("update");
    if (contact?.email === email && contact.emailVerified) return { status: "verified" as const };
    const changed = Boolean(contact?.email && contact.email !== email);
    if (contact) await tx.update(membershipContacts).set({ email, emailVerified: false, recoveryTokenHash: null })
      .where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id)));
    else await tx.insert(membershipContacts).values({ tenantId: member.tenantId, membershipId: member.id, email, emailVerified: false });
    if (changed) await tx.insert(consentEvents).values({ tenantId: member.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: false, noticeVersion, source: "contact_changed" });
    await tx.delete(contactVerificationChallenges)
      .where(and(eq(contactVerificationChallenges.tenantId, member.tenantId), eq(contactVerificationChallenges.membershipId, member.id)));
    const challengeId = randomUUID();
    const tokenHash = verificationTokenHash(verificationTokenForChallenge(challengeId));
    await tx.insert(contactVerificationChallenges).values({ id: challengeId, tenantId: member.tenantId, membershipId: member.id, email, tokenHash, expiresAt: new Date(Date.now() + 30 * 60_000) });
    await tx.insert(outboxJobs).values({ tenantId: member.tenantId, kind: "email.verify", payload: { membershipId: member.id, challengeId } });
    return { status: "queued" as const };
  });
}

export async function removeRecoveryEmail(cardToken: string): Promise<{ removed: true }> {
  return db.transaction(async tx => {
    const member = await cardInTransaction(tx, cardToken);
    await tx.delete(contactVerificationChallenges)
      .where(and(eq(contactVerificationChallenges.tenantId, member.tenantId), eq(contactVerificationChallenges.membershipId, member.id)));
    await tx.delete(membershipContacts).where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id)));
    await tx.insert(consentEvents).values({ tenantId: member.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: false, noticeVersion, source: "contact_removed" });
    await tx.insert(cardSecurityEvents).values({ tenantId: member.tenantId, membershipId: member.id, action: "recovery_email_removed" });
    return { removed: true as const };
  });
}

export async function consumeContactVerification(token: string): Promise<{ verified: true }> {
  let tokenHash: string;
  try { tokenHash = verificationTokenHash(token); }
  catch { throw new DomainError("INVALID_CHALLENGE", "Verification link is invalid or expired"); }
  return db.transaction(async tx => {
    const [candidate] = await tx.select({ id: contactVerificationChallenges.id, membershipId: contactVerificationChallenges.membershipId, tenantId: contactVerificationChallenges.tenantId })
      .from(contactVerificationChallenges).where(eq(contactVerificationChallenges.tokenHash, tokenHash));
    if (!candidate) throw new DomainError("INVALID_CHALLENGE", "Verification link is invalid or expired");
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.id, candidate.membershipId), eq(memberships.tenantId, candidate.tenantId))).for("update");
    if (!member || member.closedAt) throw new DomainError("INVALID_CHALLENGE", "Verification link is invalid or expired");
    const [challenge] = await tx.select().from(contactVerificationChallenges).where(eq(contactVerificationChallenges.id, candidate.id)).for("update");
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) throw new DomainError("INVALID_CHALLENGE", "Verification link is invalid or expired");
    const [contact] = await tx.select().from(membershipContacts)
      .where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id))).for("update");
    if (!contact || contact.email !== challenge.email) throw new DomainError("INVALID_CHALLENGE", "Verification link is invalid or expired");
    await tx.delete(contactVerificationChallenges).where(eq(contactVerificationChallenges.id, challenge.id));
    await tx.update(membershipContacts).set({ emailVerified: true })
      .where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id)));
    return { verified: true as const };
  });
}

export async function setEmailMarketingPreference(cardToken: string, granted: boolean): Promise<{ marketingEmail: boolean }> {
  if (granted && !localCaptureAllowed()) throw new DomainError("CONTACT_DISABLED", "Marketing email is available only in the local synthetic test");
  return db.transaction(async tx => {
    const member = await cardInTransaction(tx, cardToken);
    const [contact] = await tx.select().from(membershipContacts)
      .where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id))).for("update");
    if (granted && (!contact?.email || !contact.emailVerified || !syntheticEmail(contact.email))) throw new DomainError("EMAIL_UNVERIFIED", "Verify a synthetic email address before opting in");
    const [latest] = await tx.select({ granted: consentEvents.granted }).from(consentEvents)
      .where(and(eq(consentEvents.tenantId, member.tenantId), eq(consentEvents.membershipId, member.id), eq(consentEvents.channel, "email"), eq(consentEvents.purpose, "marketing")))
      .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id)).limit(1);
    if (latest?.granted !== granted) await tx.insert(consentEvents).values({ tenantId: member.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted, noticeVersion, source: "card_preferences" });
    return { marketingEmail: granted };
  });
}
