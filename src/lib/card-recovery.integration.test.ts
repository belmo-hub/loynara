import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { cardRecoveryChallenges, cardSecurityEvents, contactVerificationChallenges, memberships, outboxJobs } from "@/db/schema";
import { createMerchant, enroll, getCard } from "./product";
import { award } from "./loyalty";
import { closeCard } from "./card-lifecycle";
import { consumeContactVerification, removeRecoveryEmail, requestContactVerification } from "./contact-verification";
import { recoveryTokenForChallenge, verificationTokenForChallenge } from "./contact-token";
import { completeCardRecovery, recoveryGenericMessage, recoveryOptions, requestCardRecovery } from "./card-recovery";
import { deliverRecoveryEmail } from "./card-recovery-delivery";
import { POST as requestRoute } from "@/app/api/recover/route";
import { POST as confirmRoute } from "@/app/api/recover/confirm/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Recovery tests require looplocal_test");
beforeEach(async () => {
  process.env.BETTER_AUTH_SECRET = "synthetic-recovery-test-secret-long-enough-for-testing";
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  await pool.query('TRUNCATE TABLE card_recovery_challenges, email_suppressions, email_provider_events, tenants, "user", demo_requests, rate_limits CASCADE');
});
afterAll(async () => { await pool.end(); });

async function fixture(email = "holder@example.test") {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$2,$3,false)', [userId, "Synthetic owner", `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName: `Synthetic Merchant ${userId.slice(0, 6)}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic Stamps", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 8 });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  await requestContactVerification(card.cardToken, email);
  const [challenge] = await db.select().from(contactVerificationChallenges).where(eq(contactVerificationChallenges.membershipId, card.id));
  await consumeContactVerification(verificationTokenForChallenge(challenge.id));
  return { userId, merchant, card };
}

async function recovery(email = "holder@example.test") {
  await requestCardRecovery(email);
  const [challenge] = await db.select().from(cardRecoveryChallenges).orderBy(desc(cardRecoveryChallenges.createdAt), desc(cardRecoveryChallenges.id));
  return recoveryTokenForChallenge(challenge.id);
}

describe("lost browser-card recovery", () => {
  it("keeps the same membership, ledger balance and scan identity while rotating the only browser bearer", async () => {
    const f = await fixture();
    await award({ userId: f.userId, locationId: f.merchant.locationId, membershipId: f.card.id, quantity: 2, requestId: randomUUID(), idempotencyKey: randomUUID() });
    expect((await getCard(f.card.cardToken)).balance).toBe(2);
    const token = await recovery();
    expect((await recoveryOptions(token)).cards).toMatchObject([{ membershipId: f.card.id }]);
    const sent = vi.fn(async () => {});
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.recover"));
    expect(await deliverRecoveryEmail({ id: job.id, tenantId: job.tenantId, payload: job.payload }, sent)).toMatchObject({ status: "complete" });
    expect(sent.mock.calls.length).toBe(1);
    const restored = await completeCardRecovery(token, f.card.id);
    expect(restored.membershipId).toBe(f.card.id);
    await expect(getCard(f.card.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getCard(restored.cardToken)).balance).toBe(2);
    const [stored] = await db.select().from(memberships).where(eq(memberships.id, f.card.id));
    expect(stored.scanCode).toBe(f.card.scanCode);
    expect(stored.cardToken).toBe(restored.cardToken);
    expect(await db.select().from(cardSecurityEvents)).toMatchObject([{ action: "card_credential_rotated" }]);
    await expect(completeCardRecovery(token, f.card.id)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
  });

  it("answers valid unknown and known addresses identically; an email alone cannot rotate", async () => {
    const f = await fixture();
    expect(await requestCardRecovery("unknown@example.test")).toEqual({ message: recoveryGenericMessage });
    expect(await requestCardRecovery("HOLDER@EXAMPLE.TEST ")).toEqual({ message: recoveryGenericMessage });
    expect((await getCard(f.card.cardToken)).scanCode).toBe(f.card.scanCode);
    const token = recoveryTokenForChallenge((await db.select().from(cardRecoveryChallenges))[0].id);
    expect((await recoveryOptions(token)).cards).toHaveLength(1);
    expect((await getCard(f.card.cardToken)).scanCode).toBe(f.card.scanCode);
  });

  it("allows one verified inbox to select between separate merchant cards without crossing tenants", async () => {
    const first = await fixture();
    const second = await fixture();
    const token = await recovery();
    expect((await recoveryOptions(token)).cards.map(card => card.membershipId).sort()).toEqual([first.card.id, second.card.id].sort());
    const restored = await completeCardRecovery(token, second.card.id);
    expect(restored.membershipId).toBe(second.card.id);
    expect((await getCard(first.card.cardToken)).scanCode).toBe(first.card.scanCode);
    await expect(getCard(second.card.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects wrong tenant, closed cards, removed contact, expired and tampered tokens", async () => {
    const f = await fixture();
    const other = await fixture("other@example.test");
    const token = await recovery();
    await expect(completeCardRecovery(token, other.card.id)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
    await expect(recoveryOptions(`${token}x`)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
    await db.update(cardRecoveryChallenges).set({ expiresAt: new Date(0) });
    await expect(completeCardRecovery(token, f.card.id)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
    const token2 = await recovery();
    await removeRecoveryEmail(f.card.cardToken);
    await expect(completeCardRecovery(token2, f.card.id)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
    expect((await getCard(f.card.cardToken)).scanCode).toBe(f.card.scanCode);
    await requestCardRecovery("other@example.test");
    const [otherChallenge] = await db.select().from(cardRecoveryChallenges).where(eq(cardRecoveryChallenges.email, "other@example.test"));
    const otherToken = recoveryTokenForChallenge(otherChallenge.id);
    await closeCard(other.card.cardToken);
    await expect(recoveryOptions(otherToken)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
    await expect(completeCardRecovery(otherToken, other.card.id)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
    await expect(requestCardRecovery("other@example.test")).resolves.toEqual({ message: recoveryGenericMessage });
  });

  it("invalidates an earlier recovery email link when a fresh one is requested", async () => {
    const f = await fixture();
    const first = await recovery();
    const second = await recovery();
    await expect(recoveryOptions(first)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
    expect((await recoveryOptions(second)).cards).toMatchObject([{ membershipId: f.card.id }]);
  });

  it("serializes simultaneous recovery and invalidates another outstanding challenge", async () => {
    const f = await fixture();
    const token = await recovery();
    const results = await Promise.allSettled([completeCardRecovery(token, f.card.id), completeCardRecovery(token, f.card.id)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const [stored] = await db.select().from(memberships).where(eq(memberships.id, f.card.id));
    expect(stored.cardToken).not.toBe(f.card.cardToken);
    expect((await getCard(stored.cardToken)).scanCode).toBe(f.card.scanCode);
  });

  it("uses POST only for scanner-safe list and explicit rotation; applies destination limits", async () => {
    const f = await fixture();
    const origin = "http://localhost:3000";
    const req = (path: string, body: unknown) => new Request(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await requestRoute(req("/api/recover", { email: "HOLDER@EXAMPLE.TEST " }))).status).toBe(200);
    const token = recoveryTokenForChallenge((await db.select().from(cardRecoveryChallenges))[0].id);
    const list = await confirmRoute(req("/api/recover/confirm", { action: "list", token }));
    expect((await list.json()).cards).toMatchObject([{ membershipId: f.card.id }]);
    expect((await getCard(f.card.cardToken)).scanCode).toBe(f.card.scanCode);
    const rotated = await confirmRoute(req("/api/recover/confirm", { action: "rotate", token, membershipId: f.card.id }));
    expect(rotated.status).toBe(200);
    expect(rotated.headers.get("set-cookie")).toBeNull();
    expect((await rotated.json()).cardToken).not.toBe(f.card.cardToken);
    expect((await confirmRoute(req("/api/recover/confirm", { action: "rotate", token, membershipId: f.card.id }))).status).toBe(400);
    expect((await requestRoute(req("/api/recover", { email: "holder@example.test" }))).status).toBe(200);
    expect((await requestRoute(req("/api/recover", { email: "holder@example.test" }))).status).toBe(200);
    expect((await requestRoute(req("/api/recover", { email: "holder@example.test" }))).status).toBe(429);
  });

  it.skipIf(process.env.MAILPIT_SMOKE !== "true")("captures the recovery message in loopback Mailpit through the real sender", async () => {
    await fixture();
    await recovery();
    const [queued] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.recover"));
    expect(await deliverRecoveryEmail({ id: queued.id, tenantId: queued.tenantId, payload: queued.payload })).toEqual({ status: "complete" });
    const inbox = await fetch("http://127.0.0.1:8026/api/v1/messages?limit=1");
    expect(inbox.status).toBe(200);
    const body = await inbox.json() as { total: number };
    expect(body.total).toBeGreaterThan(0);
  });
});
