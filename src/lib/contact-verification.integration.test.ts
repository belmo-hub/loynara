import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { consentEvents, contactVerificationChallenges, membershipContacts, outboxJobs } from "@/db/schema";
import { createMerchant, enroll } from "./product";
import { closeCard } from "./card-lifecycle";
import { verificationTokenForChallenge } from "./contact-token";
import { contactStatus, consumeContactVerification, requestContactVerification, setEmailMarketingPreference } from "./contact-verification";

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

async function card() {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Contact Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic Card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  return { merchant, member };
}

describe("local contact ownership and separate marketing preference", () => {
  it("queues only a challenge reference, verifies once, then permits explicit email-marketing consent", async () => {
    const { member } = await card();
    expect(await contactStatus(member.cardToken)).toEqual({ available: true, marketingAvailable: true, marketingExternal: false, contactPresent: false, emailVerified: false, marketingEmail: false });
    await expect(setEmailMarketingPreference(member.cardToken, true)).rejects.toMatchObject({ code: "EMAIL_UNVERIFIED" });
    expect(await requestContactVerification(member.cardToken, "Recipient@Example.Test")).toEqual({ status: "queued" });
    const [challenge] = await db.select().from(contactVerificationChallenges);
    expect(challenge.email).toBe("recipient@example.test");
    expect(challenge.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.verify"));
    expect(job.payload).toEqual({ membershipId: member.id, challengeId: challenge.id });
    expect(JSON.stringify(job.payload)).not.toContain("recipient@example.test");
    expect(JSON.stringify(job.payload)).not.toContain(verificationTokenForChallenge(challenge.id));
    expect(await contactStatus(member.cardToken)).toEqual({ available: true, marketingAvailable: true, marketingExternal: false, contactPresent: true, emailVerified: false, marketingEmail: false });

    const token = verificationTokenForChallenge(challenge.id);
    expect(await consumeContactVerification(token)).toEqual({ verified: true });
    await expect(consumeContactVerification(token)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    expect(await contactStatus(member.cardToken)).toEqual({ available: true, marketingAvailable: true, marketingExternal: false, contactPresent: true, emailVerified: true, marketingEmail: false });
    expect(await db.select().from(consentEvents)).toHaveLength(0);
    expect(await setEmailMarketingPreference(member.cardToken, true)).toEqual({ marketingEmail: true });
    expect(await setEmailMarketingPreference(member.cardToken, false)).toEqual({ marketingEmail: false });
    expect((await db.select().from(consentEvents)).map(event => event.granted)).toEqual([true, false]);
  });

  it("allows separate consent for a verified real address only when the promotional provider is approved", async () => {
    const { merchant, member } = await card();
    await db.insert(membershipContacts).values({ tenantId: merchant.tenantId, membershipId: member.id, email: "controlled@example.com", emailVerified: true });
    await expect(setEmailMarketingPreference(member.cardToken, true)).rejects.toMatchObject({ code: "EMAIL_UNVERIFIED" });
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
      expect(await contactStatus(member.cardToken)).toMatchObject({ available: false, marketingAvailable: true, marketingExternal: true, emailVerified: true, marketingEmail: false });
      expect(await setEmailMarketingPreference(member.cardToken, true)).toEqual({ marketingEmail: true });
      expect(await setEmailMarketingPreference(member.cardToken, false)).toEqual({ marketingEmail: false });
      expect((await db.select().from(consentEvents)).map(event => event.granted)).toEqual([true, false]);
    } finally {
      for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it("invalidates marketing eligibility when the cardholder changes address", async () => {
    const { member } = await card();
    await requestContactVerification(member.cardToken, "first@example.test");
    const [first] = await db.select().from(contactVerificationChallenges);
    await consumeContactVerification(verificationTokenForChallenge(first.id));
    await setEmailMarketingPreference(member.cardToken, true);
    await requestContactVerification(member.cardToken, "second@example.test");
    const [contact] = await db.select().from(membershipContacts);
    expect(contact).toMatchObject({ email: "second@example.test", emailVerified: false });
    expect(await contactStatus(member.cardToken)).toMatchObject({ emailVerified: false, marketingEmail: false });
    await expect(setEmailMarketingPreference(member.cardToken, true)).rejects.toMatchObject({ code: "EMAIL_UNVERIFIED" });
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
