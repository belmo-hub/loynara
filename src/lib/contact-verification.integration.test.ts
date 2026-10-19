import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { consentEvents, contactVerificationChallenges, membershipContacts, outboxJobs } from "@/db/schema";
import { createMerchant, enroll } from "./product";
import { closeCard } from "./card-lifecycle";
import { verificationTokenForChallenge } from "./contact-token";
import { contactStatus, consumeContactVerification, requestContactVerification, withdrawEmailMarketing } from "./contact-verification";
import { deliverVerificationEmail } from "./contact-verification-delivery";
import type { LocalMessage } from "./email";
import { award } from "./loyalty";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Contact tests require looplocal_test");

const before = {
  secret: process.env.BETTER_AUTH_SECRET,
  smtp: process.env.SMTP_HOST,
  publicUrl: process.env.PUBLIC_BASE_URL,
  external: process.env.EXTERNAL_EMAIL_ENABLED,
};
beforeEach(async () => {
  process.env.BETTER_AUTH_SECRET = "synthetic-contact-test-secret-at-least-32-characters";
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => {
  for (const [key, value] of [["BETTER_AUTH_SECRET", before.secret], ["SMTP_HOST", before.smtp], ["PUBLIC_BASE_URL", before.publicUrl], ["EXTERNAL_EMAIL_ENABLED", before.external]] as const) {
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
    expect(await contactStatus(member.cardToken)).toEqual({ available: true, marketingAvailable: true, marketingExternal: false, contactPresent: false, emailVerified: false, marketingEmail: false, pending: null, offer: false });
    await expect(requestContactVerification(member.cardToken, undefined, true)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await requestContactVerification(member.cardToken, "Recipient@Example.Test")).toEqual({ status: "queued" });
    const [challenge] = await db.select().from(contactVerificationChallenges);
    expect(challenge.email).toBe("recipient@example.test");
    expect(challenge.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.verify"));
    expect(job.payload).toEqual({ membershipId: member.id, challengeId: challenge.id });
    expect(JSON.stringify(job.payload)).not.toContain("recipient@example.test");
    expect(JSON.stringify(job.payload)).not.toContain(verificationTokenForChallenge(challenge.id));
    expect(await contactStatus(member.cardToken)).toEqual({ available: true, marketingAvailable: true, marketingExternal: false, contactPresent: true, emailVerified: false, marketingEmail: false, pending: "recovery", offer: false });

    const token = verificationTokenForChallenge(challenge.id);
    expect(await consumeContactVerification(token)).toEqual({ verified: true, marketing: false });
    await expect(consumeContactVerification(token)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    expect(await contactStatus(member.cardToken)).toEqual({ available: true, marketingAvailable: true, marketingExternal: false, contactPresent: true, emailVerified: true, marketingEmail: false, pending: null, offer: false });
    expect(await db.select().from(consentEvents)).toHaveLength(0);
    // A verified address adds the consent later: same mail, same click rule, the address stays as it is.
    expect(await requestContactVerification(member.cardToken, undefined, true)).toEqual({ status: "queued" });
    expect(await contactStatus(member.cardToken)).toMatchObject({ emailVerified: true, marketingEmail: false, pending: "marketing" });
    const later = await mail(member.id);
    expect(later.message.subject).toBe("Bitte bestätige: E-Mails von Synthetic Contact Café");
    expect(await db.select().from(consentEvents)).toHaveLength(0);
    expect(await consumeContactVerification(later.token)).toMatchObject({ verified: true, marketing: true });
    expect(await requestContactVerification(member.cardToken, undefined, true)).toEqual({ status: "verified" });
    expect(await withdrawEmailMarketing(member.cardToken)).toEqual({ marketingEmail: false });
    expect(await withdrawEmailMarketing(member.cardToken)).toEqual({ marketingEmail: false });
    expect((await marketingEvents()).map(event => [event.granted, event.source])).toEqual([[true, "double_opt_in"], [false, "card_preferences"]]);
  });

  it("asks for the consent of a verified real address only when a confirmation mail can go out", async () => {
    const { merchant, member } = await card();
    await db.insert(membershipContacts).values({ tenantId: merchant.tenantId, membershipId: member.id, email: "controlled@example.com", emailVerified: true });
    await expect(requestContactVerification(member.cardToken, undefined, true)).rejects.toMatchObject({ code: "LOCAL_TEST_ONLY" });
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
      await expect(requestContactVerification(member.cardToken, undefined, true)).rejects.toMatchObject({ code: "CONTACT_DISABLED" });
      expect(await withdrawEmailMarketing(member.cardToken)).toEqual({ marketingEmail: false });
      expect((await db.select().from(consentEvents)).map(event => event.granted)).toEqual([false]);
    } finally {
      for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it("invalidates marketing eligibility when the cardholder changes address", async () => {
    const { member } = await card();
    await requestContactVerification(member.cardToken, "first@example.test", true);
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
  it("records the marketing consent only after the confirmation click, from a mail that names it and carries no card link", async () => {
    const { member } = await card();
    expect(await requestContactVerification(member.cardToken, "guest@example.test", true)).toEqual({ status: "queued" });
    expect(await contactStatus(member.cardToken)).toMatchObject({ contactPresent: true, emailVerified: false, marketingEmail: false, pending: "marketing" });
    const { message, token } = await mail(member.id);
    expect(message).toMatchObject({ to: "guest@example.test", fromName: "Synthetic Contact Café via Loynara", subject: "Bitte bestätige: E-Mails von Synthetic Contact Café" });
    expect(message.body).toContain("damit Synthetic Contact Café dir Angebote, Neuigkeiten und Erinnerungen schicken darf");
    expect(message.body).toContain(`Ja, ich möchte E-Mails von Synthetic Contact Café\nhttp://localhost:3000/verify-email#token=${token}`);
    expect(message.body).not.toContain(member.cardToken);
    expect(message.body).not.toContain("/card/");
    // Delivered, not clicked: nothing recorded, nothing marketing goes out.
    expect(await db.select().from(consentEvents)).toHaveLength(0);
    expect(await consumeContactVerification(token)).toEqual({ verified: true, marketing: true, shopName: "Synthetic Contact Café", brandColor: "#264C45" });
    const [event] = await db.select().from(consentEvents);
    expect(event).toMatchObject({ granted: true, source: "double_opt_in", noticeVersion: "2026-10-19", channel: "email", purpose: "marketing" });
    expect(await contactStatus(member.cardToken)).toMatchObject({ emailVerified: true, marketingEmail: true, pending: null });
  });

  it("treats an address without the tick as recovery only (variant C) and records no consent on its click", async () => {
    const { member } = await card();
    await requestContactVerification(member.cardToken, "recovery@example.test");
    const { message, token } = await mail(member.id);
    expect(message.subject).toBe("E-Mail-Adresse für Loynara bestätigen");
    expect(message.fromName).toBeUndefined();
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
    await requestContactVerification(member.cardToken, "later@example.test", true);
    expect((await contactStatus(member.cardToken)).offer).toBe(false);
  });

  it("keeps each shop's consent, mail and link to its own card", async () => {
    const a = await card("Synthetic Shop A");
    const b = await card("Synthetic Shop B");
    await a.stamp(); await b.stamp();
    await requestContactVerification(a.member.cardToken, "same@example.test", true);
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
