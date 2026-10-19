import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cardSecurityEvents, consentEvents, contactVerificationChallenges, locations, membershipContacts, memberships, outboxJobs, programs, tenants } from "@/db/schema";
import { validCardToken } from "./card-lifecycle";
import { verificationTokenForChallenge, verificationTokenHash } from "./contact-token";
import { DomainError } from "./loyalty";
import { emailTransportMode, promotionalEmailMode } from "./transactional-email";

const emailSchema = z.email().max(320);
// The card offer's consent text (Legal, 19 Oct 2026) names the shop, the content, the channel and the withdrawal.
const noticeVersion = "2026-10-19";

function syntheticEmail(email: string) { return email.toLowerCase().endsWith(".test"); }
// The card link is a bearer link, so the card only ever sees the stored address masked: first character and domain.
const maskEmail = (email: string) => `${email[0]}•••${email.slice(email.lastIndexOf("@"))}`;

async function cardInTransaction(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], cardToken: string) {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  const [member] = await tx.select().from(memberships).where(eq(memberships.cardToken, cardToken)).for("update");
  if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
  return member;
}

type Query = Pick<typeof db, "select">;

async function latestMarketingConsent(tenantId: string, membershipId: string, query: Query = db) {
  const [event] = await query.select({ granted: consentEvents.granted }).from(consentEvents)
    .where(and(eq(consentEvents.tenantId, tenantId), eq(consentEvents.membershipId, membershipId), eq(consentEvents.channel, "email"), eq(consentEvents.purpose, "marketing")))
    .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id)).limit(1);
  return event?.granted === true;
}

export type ContactStatus = {
  available: boolean; marketingAvailable: boolean; marketingExternal: boolean; contactPresent: boolean; emailVerified: boolean; marketingEmail: boolean;
  /** The stored address masked ("y•••@gmail.com"), never in full. */
  maskedEmail: string | null;
  /** An unclicked confirmation link and whether it also confirms the marketing consent. */
  pending: "recovery" | "marketing" | null;
  /** Show the e-mail offer under the card: stamped at least once, no address and no e-mail choice ever made ("Nein, danke" is one). */
  offer: boolean;
};

export async function contactStatus(cardToken: string): Promise<ContactStatus> {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  const [member] = await db.select({ id: memberships.id, tenantId: memberships.tenantId, closedAt: memberships.closedAt }).from(memberships).where(eq(memberships.cardToken, cardToken));
  if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
  const [contact] = await db.select({ email: membershipContacts.email, emailVerified: membershipContacts.emailVerified }).from(membershipContacts)
    .where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id)));
  const verified = Boolean(contact?.email && contact.emailVerified);
  const marketingMode = promotionalEmailMode();
  const available = emailTransportMode() !== "disabled";
  const facts = (await db.execute(sql`SELECT
      (SELECT c.marketing FROM contact_verification_challenges c WHERE c.tenant_id = ${member.tenantId}::uuid AND c.membership_id = ${member.id}::uuid ORDER BY c.created_at DESC LIMIT 1) AS "pendingMarketing",
      EXISTS (SELECT 1 FROM ledger_entries e WHERE e.tenant_id = ${member.tenantId}::uuid AND e.membership_id = ${member.id}::uuid AND e.kind = 'award') AS "stamped",
      EXISTS (SELECT 1 FROM consent_events e WHERE e.tenant_id = ${member.tenantId}::uuid AND e.membership_id = ${member.id}::uuid AND e.channel = 'email' AND e.purpose = 'marketing') AS "chosen"`)).rows[0] as { pendingMarketing: boolean | null; stamped: boolean; chosen: boolean };
  return {
    available, marketingAvailable: marketingMode !== "disabled", marketingExternal: marketingMode === "mailgun_eu", contactPresent: Boolean(contact?.email), emailVerified: verified,
    maskedEmail: contact?.email ? maskEmail(contact.email) : null,
    marketingEmail: verified && await latestMarketingConsent(member.tenantId, member.id),
    pending: facts.pendingMarketing === null ? null : facts.pendingMarketing ? "marketing" : "recovery",
    offer: available && marketingMode !== "disabled" && !contact?.email && facts.stamped && !facts.chosen,
  };
}

/** The address a resend goes to, so the route can hold it to the per-destination limit like a typed one. */
export async function storedContactEmail(cardToken: string) {
  if (!validCardToken(cardToken)) return null;
  const [row] = await db.select({ email: membershipContacts.email }).from(memberships)
    .innerJoin(membershipContacts, and(eq(membershipContacts.tenantId, memberships.tenantId), eq(membershipContacts.membershipId, memberships.id)))
    .where(eq(memberships.cardToken, cardToken));
  return row?.email ?? null;
}

/**
 * Sends the one confirmation link. Without `email` it goes again to the stored address (resend, or a verified address
 * adding the marketing consent). With `marketing` the same link also confirms the marketing consent: nothing is
 * recorded before the click. An address alone is recovery only.
 */
export async function requestContactVerification(cardToken: string, rawEmail?: string, marketing = false): Promise<{ status: "queued" | "verified" }> {
  const typed = rawEmail === undefined ? undefined : emailSchema.parse(rawEmail.trim().normalize("NFC").toLowerCase());
  const mode = emailTransportMode();
  if (mode === "disabled") throw new DomainError("CONTACT_DISABLED", "Contact verification is unavailable");
  if (marketing && promotionalEmailMode() === "disabled") throw new DomainError("CONTACT_DISABLED", "Marketing email is unavailable");
  return db.transaction(async tx => {
    const member = await cardInTransaction(tx, cardToken);
    const [contact] = await tx.select().from(membershipContacts)
      .where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id))).for("update");
    const email = typed ?? contact?.email;
    if (!email) throw new DomainError("INVALID_INPUT", "Enter an email address");
    if (mode === "mailpit" && !syntheticEmail(email)) throw new DomainError("LOCAL_TEST_ONLY", "Only synthetic .test contacts are supported");
    const verified = contact?.email === email && contact.emailVerified;
    if (verified && (!marketing || await latestMarketingConsent(member.tenantId, member.id, tx))) return { status: "verified" as const };
    if (!verified) {
      const changed = Boolean(contact?.email && contact.email !== email);
      if (contact) await tx.update(membershipContacts).set({ email, emailVerified: false, recoveryTokenHash: null })
        .where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id)));
      else await tx.insert(membershipContacts).values({ tenantId: member.tenantId, membershipId: member.id, email, emailVerified: false });
      if (changed) await tx.insert(consentEvents).values({ tenantId: member.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: false, noticeVersion, source: "contact_changed" });
    }
    await tx.delete(contactVerificationChallenges)
      .where(and(eq(contactVerificationChallenges.tenantId, member.tenantId), eq(contactVerificationChallenges.membershipId, member.id)));
    const challengeId = randomUUID();
    const tokenHash = verificationTokenHash(verificationTokenForChallenge(challengeId));
    await tx.insert(contactVerificationChallenges).values({ id: challengeId, tenantId: member.tenantId, membershipId: member.id, email, tokenHash, marketing, expiresAt: new Date(Date.now() + 30 * 60_000) });
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

/** The click. A link that also carries the marketing consent records it now (double opt-in) and names the shop for the page. */
export async function consumeContactVerification(token: string): Promise<{ verified: true; marketing: false } | { verified: true; marketing: true; shopName: string; brandColor: string }> {
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
    if (!challenge.marketing) return { verified: true as const, marketing: false as const };
    if (!await latestMarketingConsent(member.tenantId, member.id, tx)) {
      await tx.insert(consentEvents).values({ tenantId: member.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: true, noticeVersion, source: "double_opt_in" });
    }
    const [shop] = await tx.select({ shopName: tenants.name, brandColor: locations.brandColor }).from(programs)
      .innerJoin(tenants, eq(tenants.id, programs.tenantId))
      .innerJoin(locations, and(eq(locations.tenantId, programs.tenantId), eq(locations.id, programs.locationId)))
      .where(and(eq(programs.tenantId, member.tenantId), eq(programs.id, member.programId)));
    return { verified: true as const, marketing: true as const, shopName: shop.shopName, brandColor: shop.brandColor };
  });
}

/** Withdrawal ("Abbestellen") and "Nein, danke" on the card. Granting goes only through the confirmation link. */
export async function withdrawEmailMarketing(cardToken: string): Promise<{ marketingEmail: false }> {
  return db.transaction(async tx => {
    const member = await cardInTransaction(tx, cardToken);
    const [latest] = await tx.select({ granted: consentEvents.granted }).from(consentEvents)
      .where(and(eq(consentEvents.tenantId, member.tenantId), eq(consentEvents.membershipId, member.id), eq(consentEvents.channel, "email"), eq(consentEvents.purpose, "marketing")))
      .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id)).limit(1);
    if (latest?.granted !== false) await tx.insert(consentEvents).values({ tenantId: member.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: false, noticeVersion, source: "card_preferences" });
    return { marketingEmail: false as const };
  });
}
