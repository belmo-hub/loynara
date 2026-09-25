import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { contactVerificationChallenges, outboxJobs } from "@/db/schema";
import { createMerchant, enroll } from "./product";
import { requestContactVerification } from "./contact-verification";
import { verificationTokenHash } from "./contact-token";
import { deliverVerificationEmail } from "./contact-verification-delivery";
import { type LocalMessage } from "./email";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Verification delivery tests require looplocal_test");
const run = promisify(execFile);
beforeEach(async () => {
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  process.env.BETTER_AUTH_SECRET = "synthetic-test-secret-with-at-least-32-characters";
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => { await pool.end(); });

async function fixture() {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic Stamps", programType: "stamp", rulesText: "One stamp per confirmed purchase.", rewardTitle: "Coffee", rewardCost: 8 });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  await requestContactVerification(card.cardToken, "cardholder@example.test");
  const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.verify"));
  return { card, merchant, job };
}

describe("local verification delivery", () => {
  it("sends a fragment-only one-time link and scrubs the completed outbox payload", async () => {
    const f = await fixture();
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverVerificationEmail({ id: f.job.id, tenantId: f.job.tenantId, payload: f.job.payload }, send)).toMatchObject({ status: "complete" });
    const message = send.mock.calls[0][0];
    expect(message.to).toBe("cardholder@example.test");
    const link = message.body.match(/http:\/\/localhost:3000\/verify-email#token=(v_[A-Za-z0-9_-]{43})/);
    expect(link).not.toBeNull();
    const [challenge] = await db.select().from(contactVerificationChallenges);
    expect(challenge.tokenHash).toBe(verificationTokenHash(link![1]));
    const [stored] = await db.select().from(outboxJobs).where(eq(outboxJobs.id, f.job.id));
    expect(stored.payload).toEqual({ membershipId: f.card.id });
    expect(JSON.stringify(stored)).not.toContain(link![1]);
    expect(JSON.stringify(stored)).not.toContain("cardholder@example.test");
  });

  it("suppresses expired challenges before contacting Mailpit", async () => {
    const f = await fixture();
    await db.update(contactVerificationChallenges).set({ expiresAt: new Date(Date.now() - 1_000) });
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverVerificationEmail({ id: f.job.id, tenantId: f.job.tenantId, payload: f.job.payload }, send)).toMatchObject({ status: "suppressed" });
    expect(send).not.toHaveBeenCalled();
  });

  it("marks an expired verification job suppressed through the real worker", async () => {
    const f = await fixture();
    await db.update(contactVerificationChallenges).set({ expiresAt: new Date(Date.now() - 1_000) });
    await run("./node_modules/.bin/tsx", ["scripts/worker.ts", "--once"], { cwd: process.cwd(), env: process.env, timeout: 10_000 });
    const [stored] = await db.select().from(outboxJobs).where(eq(outboxJobs.id, f.job.id));
    expect(stored.status).toBe("suppressed");
    expect(stored.payload).toEqual({ membershipId: f.card.id });
  });
});
