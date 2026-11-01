import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { consentEvents, contactVerificationChallenges, membershipContacts, memberships, outboxJobs } from "@/db/schema";
import { createMerchant, enroll, getCard } from "./product";
import { closeCard } from "./card-lifecycle";
import { verificationTokenForChallenge } from "./contact-token";
import { contactStatus, consumeContactVerification, requestContactVerification, withdrawEmailMarketing } from "./contact-verification";
import { EMAIL_CONSENT_TEXT_VERSION, EMAIL_CONSENT_TEXTS, emailConsentText } from "./email-consent-text";
import { deliverVerificationEmail } from "./contact-verification-delivery";
import type { LocalMessage } from "./email";
import { award } from "./loyalty";
import { POST as contactRoute } from "@/app/api/card/[token]/contact/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Contact tests require looplocal_test");

const before = {
  secret: process.env.BETTER_AUTH_SECRET,
  smtp: process.env.SMTP_HOST,
  publicUrl: process.env.PUBLIC_BASE_URL,
  external: process.env.EXTERNAL_EMAIL_ENABLED,
  operator: process.env.OPERATOR_NAME,
  address: process.env.OPERATOR_ADDRESS,
};
beforeEach(async () => {
  process.env.BETTER_AUTH_SECRET = "synthetic-contact-test-secret-at-least-32-characters";
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  process.env.OPERATOR_NAME = "Synthetic Betreiber";
  process.env.OPERATOR_ADDRESS = "Teststraße 1, 34117 Kassel";
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => {
  for (const [key, value] of [["BETTER_AUTH_SECRET", before.secret], ["SMTP_HOST", before.smtp], ["PUBLIC_BASE_URL", before.publicUrl], ["EXTERNAL_EMAIL_ENABLED", before.external], ["OPERATOR_NAME", before.operator], ["OPERATOR_ADDRESS", before.address]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

async function card(businessName = "Synthetic Contact Café") {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic Card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  const stamp = () => award({ userId: ownerId, locationId: merchant.locationId, membershipId: member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
  return { merchant, member, stamp };
}

/** The confirmation mail exactly as the worker would hand it to the provider, and the token of its link. */
async function mail(membershipId: string) {
  const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.verify")).orderBy(desc(outboxJobs.createdAt)).limit(1);
  const send = vi.fn(async (message: LocalMessage) => { void message; });
  expect(await deliverVerificationEmail({ id: job.id, tenantId: job.tenantId, payload: job.payload }, send)).toMatchObject({ status: "complete" });
  await db.delete(outboxJobs).where(eq(outboxJobs.id, job.id));
  const [challenge] = await db.select().from(contactVerificationChallenges).where(eq(contactVerificationChallenges.membershipId, membershipId));
  return { message: send.mock.calls[0][0], token: verificationTokenForChallenge(challenge.id) };
}
const marketingEvents = async () => (await db.select().from(consentEvents)).map(event => ({ granted: event.granted, source: event.source, tenantId: event.tenantId }));

describe("local contact ownership and separate marketing preference", () => {
  it("queues only a challenge reference, verifies once, then takes the marketing consent only through a second confirmed link", async () => {
    const { member } = await card();
    expect(await contactStatus(member.cardToken)).toEqual({ available: true, marketingAvailable: true, marketingExternal: false, contactPresent: false, emailVerified: false, maskedEmail: null, marketingEmail: false, pending: null, offer: false, linkExpired: false, marketingSince: null, recoverUrl: expect.stringMatching(/\/recover$/) });
    await expect(requestContactVerification(member.cardToken, undefined, true, EMAIL_CONSENT_TEXT_VERSION)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await requestContactVerification(member.cardToken, "Recipient@Example.Test")).toEqual({ status: "queued" });
    const [challenge] = await db.select().from(contactVerificationChallenges);
    expect(challenge.email).toBe("recipient@example.test");
    expect(challenge.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.verify"));
    expect(job.payload).toEqual({ membershipId: member.id, challengeId: challenge.id });
    expect(JSON.stringify(job.payload)).not.toContain("recipient@example.test");
    expect(JSON.stringify(job.payload)).not.toContain(verificationTokenForChallenge(challenge.id));
    expect(await contactStatus(member.cardToken)).toEqual({ available: true, marketingAvailable: true, marketingExternal: false, contactPresent: true, emailVerified: false, maskedEmail: "r•••@example.test", marketingEmail: false, pending: "recovery", offer: false, linkExpired: false, marketingSince: null, recoverUrl: expect.stringMatching(/\/recover$/) });
    // After its 30 minutes the open link reads „Link abgelaufen“ on the card (K09c).
    await db.update(contactVerificationChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(contactVerificationChallenges.id, challenge.id));
    expect(await contactStatus(member.cardToken)).toMatchObject({ pending: "recovery", linkExpired: true });
    await db.update(contactVerificationChallenges).set({ expiresAt: new Date(Date.now() + 30 * 60_000) }).where(eq(contactVerificationChallenges.id, challenge.id));

    const token = verificationTokenForChallenge(challenge.id);
    expect(await consumeContactVerification(token)).toEqual({ verified: true, marketing: false });
    await expect(consumeContactVerification(token)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    expect(await contactStatus(member.cardToken)).toEqual({ available: true, marketingAvailable: true, marketingExternal: false, contactPresent: true, emailVerified: true, maskedEmail: "r•••@example.test", marketingEmail: false, pending: null, offer: false, linkExpired: false, marketingSince: null, recoverUrl: expect.stringMatching(/\/recover$/) });
    expect(await db.select().from(consentEvents)).toHaveLength(0);
    // A verified address adds the consent later: same mail, same click rule, the address stays as it is.
    expect(await requestContactVerification(member.cardToken, undefined, true, EMAIL_CONSENT_TEXT_VERSION)).toEqual({ status: "queued" });
    expect(await contactStatus(member.cardToken)).toMatchObject({ emailVerified: true, marketingEmail: false, pending: "marketing" });
    const later = await mail(member.id);
    expect(later.message.subject).toBe("Bitte bestätige: E-Mails von Synthetic Contact Café");
    expect(await db.select().from(consentEvents)).toHaveLength(0);
    expect(await consumeContactVerification(later.token)).toMatchObject({ verified: true, marketing: true });
    expect(await requestContactVerification(member.cardToken, undefined, true, EMAIL_CONSENT_TEXT_VERSION)).toEqual({ status: "verified" });
    expect(await withdrawEmailMarketing(member.cardToken)).toEqual({ marketingEmail: false });
    expect(await withdrawEmailMarketing(member.cardToken)).toEqual({ marketingEmail: false });
    expect((await marketingEvents()).map(event => [event.granted, event.source])).toEqual([[true, "double_opt_in"], [false, "card_preferences"]]);
  });

  it("asks for the consent of a verified real address only when a confirmation mail can go out", async () => {
    const { merchant, member } = await card();
    await db.insert(membershipContacts).values({ tenantId: merchant.tenantId, membershipId: member.id, email: "controlled@example.com", emailVerified: true });
    await expect(requestContactVerification(member.cardToken, undefined, true, EMAIL_CONSENT_TEXT_VERSION)).rejects.toMatchObject({ code: "LOCAL_TEST_ONLY" });
    const values: Record<string, string> = {
      PUBLIC_BASE_URL: "https://preview.getloynara.com", SMTP_HOST: "disabled",
      PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "true", MAILGUN_PROMOTIONAL_SEND_APPROVED: "true", MAILGUN_SEND_APPROVED: "true",
      MAILGUN_EU_DOMAIN: "mail.getloynara.com", MAILGUN_FROM_EMAIL: "karten@mail.getloynara.com",
      MAILGUN_EU_API_KEY: "synthetic-key", MAILGUN_EU_WEBHOOK_SIGNING_KEY: "synthetic-signing-key",
      PROMOTIONAL_UNSUBSCRIBE_ORIGIN: "https://unsubscribe.getloynara.com", PROMOTIONAL_UNSUBSCRIBE_SECRET: "a".repeat(64),
      PROMOTIONAL_MONTHLY_LOCATION_LIMIT: "2", PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: "24",
    };
    const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, values);
      expect(await contactStatus(member.cardToken)).toMatchObject({ available: false, marketingAvailable: true, marketingExternal: true, emailVerified: true, marketingEmail: false, offer: false });
      // No transactional mail, no confirmation link, so no consent; withdrawing still works.
      await expect(requestContactVerification(member.cardToken, undefined, true, EMAIL_CONSENT_TEXT_VERSION)).rejects.toMatchObject({ code: "CONTACT_DISABLED" });
      expect(await withdrawEmailMarketing(member.cardToken)).toEqual({ marketingEmail: false });
      expect((await db.select().from(consentEvents)).map(event => event.granted)).toEqual([false]);
    } finally {
      for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it("invalidates marketing eligibility when the cardholder changes address", async () => {
    const { member } = await card();
    await requestContactVerification(member.cardToken, "first@example.test", true, EMAIL_CONSENT_TEXT_VERSION);
    const [first] = await db.select().from(contactVerificationChallenges);
    await consumeContactVerification(verificationTokenForChallenge(first.id));
    await requestContactVerification(member.cardToken, "second@example.test");
    const [contact] = await db.select().from(membershipContacts);
    expect(contact).toMatchObject({ email: "second@example.test", emailVerified: false });
    expect(await contactStatus(member.cardToken)).toMatchObject({ emailVerified: false, marketingEmail: false, pending: "recovery" });
    // The new address without the tick is recovery only: confirming it does not bring the old consent back.
    await consumeContactVerification(verificationTokenForChallenge((await db.select().from(contactVerificationChallenges))[0].id));
    expect(await contactStatus(member.cardToken)).toMatchObject({ emailVerified: true, marketingEmail: false });
    const events = await db.select().from(consentEvents);
    expect(events.map(event => event.granted)).toEqual([true, false]);
  });

  it("rejects non-synthetic addresses, non-local delivery, expired challenges and closed cards", async () => {
    const { member } = await card();
    await expect(requestContactVerification(member.cardToken, "person@gmail.com")).rejects.toMatchObject({ code: "LOCAL_TEST_ONLY" });
    process.env.PUBLIC_BASE_URL = "https://example.test";
    await expect(requestContactVerification(member.cardToken, "person@example.test")).rejects.toMatchObject({ code: "CONTACT_DISABLED" });
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";
    await requestContactVerification(member.cardToken, "person@example.test");
    const [challenge] = await db.select().from(contactVerificationChallenges);
    await db.update(contactVerificationChallenges).set({ expiresAt: new Date("2000-01-01T00:00:00Z") }).where(eq(contactVerificationChallenges.id, challenge.id));
    await expect(consumeContactVerification(verificationTokenForChallenge(challenge.id))).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    await closeCard(member.cardToken);
    await expect(requestContactVerification(member.cardToken, "person@example.test")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ENG-007: e-mail offer on the card with double opt-in", () => {
  it("writes the version of the text the guest ticked into the consent event, and refuses an unknown one", async () => {
    const { member } = await card();
    await expect(requestContactVerification(member.cardToken, "guest@example.test", true)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(requestContactVerification(member.cardToken, "guest@example.test", true, "constructor")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // A page still showing an older text: the click records that text's version, not today's.
    EMAIL_CONSENT_TEXTS["email-consent-test-old"] = () => "Ältere Fassung. ";
    try {
      await requestContactVerification(member.cardToken, "guest@example.test", true, "email-consent-test-old");
      const { token } = await mail(member.id);
      await consumeContactVerification(token);
      expect(await db.select({ noticeVersion: consentEvents.noticeVersion, source: consentEvents.source }).from(consentEvents)).toEqual([{ noticeVersion: "email-consent-test-old", source: "double_opt_in" }]);
    } finally { delete EMAIL_CONSENT_TEXTS["email-consent-test-old"]; }
  });
  it("records the marketing consent only after the confirmation click, from a mail that names it and carries no card link", async () => {
    const { member } = await card();
    expect(await requestContactVerification(member.cardToken, "guest@example.test", true, EMAIL_CONSENT_TEXT_VERSION)).toEqual({ status: "queued" });
    expect(await contactStatus(member.cardToken)).toMatchObject({ contactPresent: true, emailVerified: false, marketingEmail: false, pending: "marketing" });
    const { message, token } = await mail(member.id);
    expect(message).toMatchObject({ to: "guest@example.test", subject: "Bitte bestätige: E-Mails von Synthetic Contact Café" });
    expect(message.body).toContain("damit Synthetic Contact Café dir Angebote, Neuigkeiten und Erinnerungen schicken darf");
    expect(message.body).toContain(`Ja, ich möchte E-Mails von Synthetic Contact Café\nhttp://localhost:3000/verify-email#token=${token}\n\nDer Link gilt 30 Minuten.`);
    expect(message.body).not.toContain(member.cardToken);
    expect(message.body).not.toContain("/card/");
    expect(message.body).toContain("\n--\nDiese E-Mail kommt von Synthetic Betreiber.\nDatenschutzhinweise: http://localhost:3000/datenschutz");
    // Delivered, not clicked: nothing recorded, nothing marketing goes out.
    expect(await db.select().from(consentEvents)).toHaveLength(0);
    expect(await consumeContactVerification(token)).toEqual({ verified: true, marketing: true, shopName: "Synthetic Contact Café", brandColor: "#264C45" });
    const [event] = await db.select().from(consentEvents);
    expect(event).toMatchObject({ granted: true, source: "double_opt_in", noticeVersion: EMAIL_CONSENT_TEXT_VERSION, channel: "email", purpose: "marketing" });
    // The version names the exact box text the card showed (Legal, 1 Nov).
    expect(EMAIL_CONSENT_TEXTS[event.noticeVersion]("Synthetic Contact Café", "Mitte")).toBe(emailConsentText("Synthetic Contact Café", "Mitte"));
    expect(await contactStatus(member.cardToken)).toMatchObject({ emailVerified: true, marketingEmail: true, pending: null, marketingSince: expect.any(String) });
    // The card link is a bearer link: the card's reads carry the address masked only, never in full.
    const reads = JSON.stringify([await contactStatus(member.cardToken), await getCard(member.cardToken)]);
    expect(reads).toContain("g•••@example.test");
    expect(reads).not.toContain("guest@example.test");
  });

  it("treats an address without the tick as recovery only (variant C) and records no consent on its click", async () => {
    const { member } = await card();
    await requestContactVerification(member.cardToken, "recovery@example.test");
    const { message, token } = await mail(member.id);
    expect(message.subject).toBe("E-Mail-Adresse für Loynara bestätigen");
    expect(message.body).not.toMatch(/Angebote|Neuigkeiten|Erinnerungen/);
    expect(message.body).not.toContain(member.cardToken);
    expect(message.body).not.toContain("/card/");
    expect(await consumeContactVerification(token)).toEqual({ verified: true, marketing: false });
    expect(await db.select().from(consentEvents)).toHaveLength(0);
    expect(await contactStatus(member.cardToken)).toMatchObject({ emailVerified: true, marketingEmail: false });
  });

  it("offers the step only after the first stamp, and \"Nein, danke\" keeps it away for good", async () => {
    const { member, stamp } = await card();
    expect((await contactStatus(member.cardToken)).offer).toBe(false);
    await stamp();
    expect((await contactStatus(member.cardToken)).offer).toBe(true);
    await withdrawEmailMarketing(member.cardToken);
    await stamp();
    expect((await contactStatus(member.cardToken)).offer).toBe(false);
    expect(await marketingEvents()).toEqual([expect.objectContaining({ granted: false, source: "card_preferences" })]);
    // The guest can still set it up by hand from the quiet row; the offer itself does not return.
    await requestContactVerification(member.cardToken, "later@example.test", true, EMAIL_CONSENT_TEXT_VERSION);
    expect((await contactStatus(member.cardToken)).offer).toBe(false);
  });

  it("counts every mail against its recipient, resends to the stored address included", async () => {
    const { member } = await card();
    await pool.query("DELETE FROM rate_limits"); // disposable test database: start every limit at zero
    const post = (body: unknown) => contactRoute(new Request(`http://localhost:3000/api/card/${member.cardToken}/contact`, {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ token: member.cardToken }) });
    expect((await post({ email: `flood-${randomUUID()}@example.test`, marketing: true, noticeVersion: EMAIL_CONSENT_TEXT_VERSION })).status).toBe(200);
    for (let resend = 0; resend < 3; resend++) expect((await post({ marketing: true, noticeVersion: EMAIL_CONSENT_TEXT_VERSION })).status).toBe(200);
    // Fifth mail to the same inbox within the hour: refused, nothing queued.
    const refused = await post({ marketing: true, noticeVersion: EMAIL_CONSENT_TEXT_VERSION });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "RATE_LIMIT" });
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.verify"))).toHaveLength(4);
  });

  it("spends no recipient budget on a closed card's resend", async () => {
    const { member } = await card();
    const email = `closed-${randomUUID()}@example.test`;
    const destination = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update("card_contact_destination").update("\0").update(email).digest("hex");
    const hits = async () => (await pool.query<{ hits: number }>("SELECT hits FROM rate_limits WHERE key_hash = $1", [destination])).rows.map(row => row.hits);
    const post = () => contactRoute(new Request(`http://localhost:3000/api/card/${member.cardToken}/contact`, {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ marketing: true, noticeVersion: EMAIL_CONSENT_TEXT_VERSION }),
    }), { params: Promise.resolve({ token: member.cardToken }) });
    await requestContactVerification(member.cardToken, email);
    await pool.query("DELETE FROM rate_limits"); // disposable test database: start every limit at zero
    expect((await post()).status).toBe(200);
    expect(await hits()).toEqual([1]); // an open card's resend is counted against its stored address
    // Closure removes the address; a closed card that still holds one (older data) must not spend its budget either.
    await db.update(memberships).set({ closedAt: new Date() }).where(eq(memberships.id, member.id));
    await pool.query("DELETE FROM rate_limits");
    const jobs = (await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.verify"))).length;
    const refused = await post();
    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(await hits()).toEqual([]);
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.verify"))).toHaveLength(jobs);
  });

  it("keeps each shop's consent, mail and link to its own card", async () => {
    const a = await card("Synthetic Shop A");
    const b = await card("Synthetic Shop B");
    await a.stamp(); await b.stamp();
    await requestContactVerification(a.member.cardToken, "same@example.test", true, EMAIL_CONSENT_TEXT_VERSION);
    const { message, token } = await mail(a.member.id);
    expect(message.subject).toBe("Bitte bestätige: E-Mails von Synthetic Shop A");
    expect(message.body).not.toContain("Synthetic Shop B");
    expect(await consumeContactVerification(token)).toMatchObject({ shopName: "Synthetic Shop A" });
    expect(await marketingEvents()).toEqual([{ granted: true, source: "double_opt_in", tenantId: a.merchant.tenantId }]);
    // The same address at shop B knows nothing of shop A: no contact, no consent, the offer still open.
    expect(await contactStatus(b.member.cardToken)).toMatchObject({ contactPresent: false, marketingEmail: false, pending: null, offer: true });
    await expect(consumeContactVerification(token)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
  });
});
