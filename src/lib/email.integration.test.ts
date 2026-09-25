import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { desc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { consentEvents, membershipContacts, outboxJobs, staffRoles } from "@/db/schema";
import { createMerchant, enroll } from "./product";
import { deliverMarketingEmail, getMarketingPreference, queueMarketingEmail, withdrawMarketingConsent } from "./email";

const run = promisify(execFile);

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Email integration tests require looplocal_test");

beforeEach(async () => {
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => { await pool.end(); });

async function fixture() {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: "recipient@example.test", marketingOptIn: true });
  return { ownerId, merchant, member };
}

describe("local marketing email safety", () => {
  it("requires a verified synthetic email and consent before queueing", async () => {
    const f = await fixture();
    await expect(queueMarketingEmail({ userId: f.ownerId, membershipId: f.member.id, subject: "Test", body: "Lokale Nachricht" })).rejects.toMatchObject({ code: "EMAIL_UNVERIFIED" });
    await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, f.member.id));
    const job = await queueMarketingEmail({ userId: f.ownerId, membershipId: f.member.id, subject: "Test", body: "Lokale Nachricht" });
    expect(job.status).toBe("pending");
    const [stored] = await db.select().from(outboxJobs).where(eq(outboxJobs.id, job.id));
    expect(stored.kind).toBe("email.marketing");
    expect(JSON.stringify(stored.payload)).not.toContain("recipient@example.test");
  });

  it("suppresses queued marketing after cardholder withdrawal before delivery", async () => {
    const f = await fixture();
    await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, f.member.id));
    const job = await queueMarketingEmail({ userId: f.ownerId, membershipId: f.member.id, subject: "Test", body: "Lokale Nachricht" });
    await withdrawMarketingConsent(f.member.cardToken);
    const events = await db.select().from(consentEvents).where(eq(consentEvents.membershipId, f.member.id)).orderBy(desc(consentEvents.createdAt));
    expect(events[0]?.granted).toBe(false);
    const [stored] = await db.select().from(outboxJobs).where(eq(outboxJobs.id, job.id));
    const result = await deliverMarketingEmail({ id: job.id, tenantId: f.merchant.tenantId, payload: stored.payload }, async () => { throw new Error("Sender must not be called after withdrawal"); });
    expect(result.status).toBe("suppressed");
  });

  it("marks a withdrawn email job suppressed in the real worker without contacting Mailpit", async () => {
    const f = await fixture();
    await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, f.member.id));
    const job = await queueMarketingEmail({ userId: f.ownerId, membershipId: f.member.id, subject: "Worker test", body: "Lokale Nachricht" });
    await withdrawMarketingConsent(f.member.cardToken);
    await run("./node_modules/.bin/tsx", ["scripts/worker.ts", "--once"], { cwd: process.cwd(), env: process.env, timeout: 10_000 });
    const [stored] = await db.select().from(outboxJobs).where(eq(outboxJobs.id, job.id));
    expect(stored.status).toBe("suppressed");
    expect(stored.lastError).toBe("Marketing consent withdrawn");
  });

  it("refuses a different tenant's owner", async () => {
    const f = await fixture();
    const otherUserId = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [otherUserId, "Other owner", `${otherUserId}@example.test`]);
    await createMerchant({ userId: otherUserId, businessName: "Other Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Other Card", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Gratiskaffee", rewardCost: 8 });
    await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, f.member.id));
    await expect(queueMarketingEmail({ userId: otherUserId, membershipId: f.member.id, subject: "Test", body: "Lokale Nachricht" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("suppresses a queued message if the owner is revoked before delivery", async () => {
    const f = await fixture();
    await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, f.member.id));
    const job = await queueMarketingEmail({ userId: f.ownerId, membershipId: f.member.id, subject: "Test", body: "Lokale Nachricht" });
    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, f.ownerId));
    const [stored] = await db.select().from(outboxJobs).where(eq(outboxJobs.id, job.id));
    const result = await deliverMarketingEmail({ id: job.id, tenantId: f.merchant.tenantId, payload: stored.payload }, async () => { throw new Error("Revoked owner must not send"); });
    expect(result.status).toBe("suppressed");
  });

  it("lets the bearer card token view and withdraw marketing, but rejects the scan code", async () => {
    const f = await fixture();
    expect(await getMarketingPreference(f.member.cardToken)).toEqual({ marketingEmail: true });
    await expect(getMarketingPreference(f.member.scanCode)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await withdrawMarketingConsent(f.member.cardToken);
    expect(await getMarketingPreference(f.member.cardToken)).toEqual({ marketingEmail: false });
  });
});
