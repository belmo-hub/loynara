import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { contactVerificationChallenges, outboxJobs } from "@/db/schema";
import { createMerchant, enroll } from "./product";
import { updateMerchantBrand } from "./merchant-brand";
import { SHOP_NAME_REFUSAL } from "./sender-details";
import { contactStatus, requestContactVerification } from "./contact-verification";
import { verificationTokenHash } from "./contact-token";
import { SHOP_CONTACT_MAIL_DAY_LIMIT, deliverVerificationEmail } from "./contact-verification-delivery";
import { enforceRateLimit } from "./rate-limit";
import { type LocalMessage } from "./email";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Verification delivery tests require looplocal_test");
const run = promisify(execFile);
beforeEach(async () => {
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  process.env.BETTER_AUTH_SECRET = "synthetic-test-secret-with-at-least-32-characters";
  process.env.OPERATOR_NAME = "Synthetic Betreiber";
  process.env.OPERATOR_ADDRESS = "Teststraße 1, 34117 Kassel";
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => { await pool.end(); });

async function fixture({ confirmed = true, businessName = "Synthetic Café" } = {}) {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, $4)', [ownerId, "Synthetic owner", `${ownerId}@example.test`, confirmed]);
  const merchant = await createMerchant({ userId: ownerId, businessName, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic Stamps", programType: "stamp", rulesText: "One stamp per confirmed purchase.", rewardTitle: "Coffee", rewardCost: 8 });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  await requestContactVerification(card.cardToken, "cardholder@example.test");
  const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.verify"));
  return { card, merchant, job, ownerId };
}

describe("local verification delivery", () => {
  it("sends nothing, and the card offers no e-mail, until the operator's name is configured", async () => {
    const f = await fixture();
    delete process.env.OPERATOR_NAME;
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverVerificationEmail({ id: f.job.id, tenantId: f.job.tenantId, payload: f.job.payload }, send)).toEqual({ status: "blocked", reason: "Operator name not configured" });
    expect(send).not.toHaveBeenCalled();
    expect(await contactStatus(f.card.cardToken)).toMatchObject({ available: false });
    await expect(requestContactVerification(f.card.cardToken, "cardholder@example.test")).rejects.toMatchObject({ code: "CONTACT_DISABLED" });
  });
  it("sends a fragment-only one-time link and scrubs the completed outbox payload", async () => {
    const f = await fixture();
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverVerificationEmail({ id: f.job.id, tenantId: f.job.tenantId, payload: f.job.payload }, send)).toMatchObject({ status: "complete" });
    const message = send.mock.calls[0][0];
    expect(message.to).toBe("cardholder@example.test");
    // ENG-285: a self-registered shop names itself anything, so Loynara is the sender; the shop appears only in the body.
    expect(message.fromName).toBe("Loynara");
    expect(message).not.toHaveProperty("replyTo");
    expect(JSON.stringify({ ...message, body: "" })).not.toContain("Synthetic Café");
    const link = message.body.match(/http:\/\/localhost:3000\/verify-email#token=(v_[A-Za-z0-9_-]{43})/);
    expect(link).not.toBeNull();
    // Legal (1 Nov): the sender and the Datenschutz link under every confirmation mail, the name from configuration.
    expect(message.body.endsWith("\n\n--\nDiese E-Mail verschickt Synthetic Betreiber im Auftrag von „Synthetic Café“.\nDatenschutzhinweise: http://localhost:3000/datenschutz")).toBe(true);
    const [challenge] = await db.select().from(contactVerificationChallenges);
    expect(challenge.tokenHash).toBe(verificationTokenHash(link![1]));
    const [stored] = await db.select().from(outboxJobs).where(eq(outboxJobs.id, f.job.id));
    expect(stored.payload).toEqual({ membershipId: f.card.id });
    expect(JSON.stringify(stored)).not.toContain(link![1]);
    expect(JSON.stringify(stored)).not.toContain("cardholder@example.test");
  });

  it("caps each shop at 50 of these mails a day", () => {
    expect(SHOP_CONTACT_MAIL_DAY_LIMIT).toEqual({ scope: "contact_mail_shop_day", max: 50, windowSeconds: 86_400 });
  });
  it("sends nothing once the shop reached its daily cap, and marks the job suppressed", async () => {
    const f = await fixture();
    for (let hit = 0; hit < SHOP_CONTACT_MAIL_DAY_LIMIT.max; hit += 1) await enforceRateLimit({ ...SHOP_CONTACT_MAIL_DAY_LIMIT, identity: f.job.tenantId });
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverVerificationEmail({ id: f.job.id, tenantId: f.job.tenantId, payload: f.job.payload }, send)).toEqual({ status: "suppressed", reason: "Shop's daily contact mail cap reached" });
    expect(send).not.toHaveBeenCalled();
    const [stored] = await db.select().from(outboxJobs).where(eq(outboxJobs.id, f.job.id));
    expect(stored.payload).toEqual({ membershipId: f.card.id });
  });
  it("counts each shop's mails apart", async () => {
    const f = await fixture();
    for (let hit = 0; hit < SHOP_CONTACT_MAIL_DAY_LIMIT.max; hit += 1) await enforceRateLimit({ ...SHOP_CONTACT_MAIL_DAY_LIMIT, identity: randomUUID() });
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverVerificationEmail({ id: f.job.id, tenantId: f.job.tenantId, payload: f.job.payload }, send)).toMatchObject({ status: "complete" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a shop whose owner has not confirmed an address, and leaves its cap untouched", async () => {
    const f = await fixture({ confirmed: false });
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverVerificationEmail({ id: f.job.id, tenantId: f.job.tenantId, payload: f.job.payload }, send)).toEqual({ status: "suppressed", reason: "Owner email not confirmed" });
    expect(send).not.toHaveBeenCalled();
    await enforceRateLimit({ ...SHOP_CONTACT_MAIL_DAY_LIMIT, max: 1, identity: f.job.tenantId });
  });
  it("sends for an unconfirmed owner who accepted the operator's owner invitation at the same address, not another", async () => {
    const f = await fixture({ confirmed: false });
    const own = `${f.ownerId}@example.test`;
    const invite = (email: string, role = "owner", accepted = true) => pool.query(`INSERT INTO staff_invites (tenant_id, location_id, invited_email, role, token_hash, invited_by_user_id, expires_at, accepted_at)
      VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days', CASE WHEN $7 THEN now() END)`, [f.merchant.tenantId, f.merchant.locationId, email, role, randomUUID().replace(/-/g, ""), f.ownerId, accepted]);
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    const deliver = () => deliverVerificationEmail({ id: f.job.id, tenantId: f.job.tenantId, payload: f.job.payload }, send);
    // Another address, an invitation never accepted, a manager invitation: none counts.
    await invite("someone-else@example.test");
    await invite(own, "owner", false);
    await invite(own, "manager");
    expect(await deliver()).toMatchObject({ status: "suppressed", reason: "Owner email not confirmed" });
    await invite(own);
    // An owner whose access was revoked counts for nothing, invitation or not.
    await pool.query("UPDATE staff_roles SET active = false WHERE user_id = $1", [f.ownerId]);
    expect(await deliver()).toMatchObject({ status: "suppressed", reason: "Owner email not confirmed" });
    await pool.query("UPDATE staff_roles SET active = true WHERE user_id = $1", [f.ownerId]);
    expect(await deliverVerificationEmail({ id: f.job.id, tenantId: f.job.tenantId, payload: f.job.payload }, send)).toMatchObject({ status: "complete" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("refuses a link or phone number in a shop name at setup and rename", async () => {
    await expect(fixture({ businessName: "Bitte hier einloggen: https://evil.example/login" })).rejects.toMatchObject({ code: "INVALID_SHOP_NAME", message: SHOP_NAME_REFUSAL });
    const f = await fixture();
    await expect(updateMerchantBrand({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, businessName: "Ruf an 0900 123456", locationName: "Kassel", brandColor: "#264C45" }))
      .rejects.toMatchObject({ code: "INVALID_SHOP_NAME" });
    expect((await pool.query("SELECT name FROM tenants WHERE id = $1", [f.merchant.tenantId])).rows[0].name).toBe("Synthetic Café");
  });
  it("names a stored shop name with a link or number only as „dein Geschäft“", async () => {
    const f = await fixture({ businessName: "Mario" });
    await pool.query("UPDATE tenants SET name = $2 WHERE id = $1", [f.merchant.tenantId, "Mario www.evil.example 0900 123456"]);
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverVerificationEmail({ id: f.job.id, tenantId: f.job.tenantId, payload: f.job.payload }, send)).toMatchObject({ status: "complete" });
    const message = send.mock.calls[0][0];
    expect(JSON.stringify(message)).not.toMatch(/evil|0900/);
    expect(message.body).toContain("im Auftrag von deinem Geschäft.");
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
