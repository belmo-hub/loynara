import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { cardRecoveryChallenges, cardSecurityEvents, consentEvents, contactVerificationChallenges, ledgerEntries, memberships, outboxJobs } from "@/db/schema";
import { createMerchant, enroll, getCard } from "./product";
import { award } from "./loyalty";
import { closeCard } from "./card-lifecycle";
import { reissueCardByStaff } from "./card-reissue";
import { consumeContactVerification, removeRecoveryEmail, requestContactVerification } from "./contact-verification";
import { recoveryTokenForChallenge, verificationTokenForChallenge } from "./contact-token";
import { completeCardRecovery, recoveryGenericMessage, recoveryOptions, requestCardRecovery } from "./card-recovery";
import { deliverRecoveryEmail, deliverRecoveryNotice } from "./card-recovery-delivery";
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
  it("queues one credential-safe security notice after committed rotation and keeps recovery successful if delivery fails", async () => {
    const f = await fixture();
    const token = await recovery();
    const consentBefore = await db.select().from(consentEvents);
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.recovery_notice"))).toHaveLength(0);
    const restored = await completeCardRecovery(token, f.card.id);
    const notices = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.recovery_notice"));
    expect(notices).toHaveLength(1);
    await expect(completeCardRecovery(token, f.card.id)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.recovery_notice"))).toHaveLength(1);
    const message = vi.fn(async (notice: { to: string; subject: string; body: string; jobId: string }) => { expect(notice.jobId).toBe(notices[0].id); });
    expect(await deliverRecoveryNotice({ id: notices[0].id, tenantId: notices[0].tenantId, payload: notices[0].payload }, message)).toEqual({ status: "complete" });
    const sent = message.mock.calls[0][0];
    expect(sent.to).toBe("holder@example.test");
    expect(sent.subject).toBe("Deine Loynara-Karte wurde wiederhergestellt");
    expect(sent.body).toMatch(/\d{2}\.\d{2}\.\d{4}.*\d{2}:\d{2} UTC wiederhergestellt/);
    expect(sent.body).toMatch(/bisherige private Kartenlink.*nicht mehr gültig/);
    expect(sent.body).toMatch(/Falls du das nicht selbst veranlasst hast/);
    expect(`${sent.subject}\n${sent.body}`).not.toContain(f.card.cardToken);
    expect(`${sent.subject}\n${sent.body}`).not.toContain(restored.cardToken);
    expect(`${sent.subject}\n${sent.body}`).not.toContain(token);
    expect(`${sent.subject}\n${sent.body}`).not.toMatch(/https?:\/\/|Kontostand|Angebot|Rabatt/i);
    expect(await db.select().from(consentEvents)).toEqual(consentBefore);
    await expect(deliverRecoveryNotice({ id: notices[0].id, tenantId: notices[0].tenantId, payload: notices[0].payload }, async () => { throw new Error("synthetic provider failure"); })).rejects.toThrow("synthetic provider failure");
    expect((await getCard(restored.cardToken)).scanCode).toBe(f.card.scanCode);
  });

  it("does not queue a security notice for a failed recovery", async () => {
    const f = await fixture();
    const token = await recovery();
    await expect(completeCardRecovery(`${token}tampered`, f.card.id)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.recovery_notice"))).toHaveLength(0);
  });
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


it.each(["recovery", "reissue"] as const)("keeps committed closure authoritative over a waiting %s transaction", async kind => {
  const f = await fixture(); const foreign = await fixture("foreign-holder@example.test");
  await award({ userId: f.userId, locationId: f.merchant.locationId, membershipId: f.card.id, quantity: 2, requestId: randomUUID(), idempotencyKey: randomUUID() });
  const token = await recovery();
  const ledgerBefore = (await pool.query("SELECT * FROM ledger_entries WHERE membership_id=$1 ORDER BY id", [f.card.id])).rows;
  const foreignBefore = (await pool.query("SELECT * FROM memberships WHERE id=$1", [foreign.card.id])).rows;
  const gate = await pool.connect();
  let closure: ReturnType<typeof closeCard> | undefined;
  let attempt: Promise<unknown> | undefined;
  const waitForLock = async (fragment: string) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE $1", [`%${fragment}%`]);
      if (result.rowCount) return;
      await new Promise(done => setTimeout(done, 10));
    }
    throw new Error(`Expected actual PostgreSQL lock wait: ${fragment}`);
  };
  const reissue = () => reissueCardByStaff({ actorUserId: f.userId, locationId: f.merchant.locationId, membershipId: f.card.id, reason: "Synthetic verified lost phone", verificationMethod: "card_link", entitlementConfirmed: true, idempotencyKey: randomUUID() });
  try {
    await gate.query("BEGIN"); await gate.query("LOCK TABLE outbox_jobs IN SHARE MODE");
    closure = closeCard(f.card.cardToken); void closure.catch(() => undefined);
    // Closure owns the membership lock; its ordinary outbox cleanup waits at this database barrier.
    await waitForLock('update "outbox_jobs"');
    attempt = kind === "recovery" ? completeCardRecovery(token, f.card.id) : reissue();
    void attempt.catch(() => undefined);
    await waitForLock("memberships");
    await gate.query("COMMIT");
    expect(await closure).toMatchObject({ closed: true });
    await expect(attempt).rejects.toMatchObject({ code: kind === "recovery" ? "INVALID_RECOVERY" : "NOT_FOUND" });
    await expect(getCard(f.card.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const stored = (await pool.query("SELECT closed_at,balance,card_token,scan_code FROM memberships WHERE id=$1", [f.card.id])).rows[0];
    expect(stored.closed_at).toBeInstanceOf(Date); expect(stored.balance).toBe(2);
    expect(stored.card_token).toMatch(/^retired_card_/); expect(stored.scan_code).toMatch(/^retired_sc_/);
    expect((await pool.query("SELECT * FROM ledger_entries WHERE membership_id=$1 ORDER BY id", [f.card.id])).rows).toEqual(ledgerBefore);
    expect((await pool.query("SELECT * FROM memberships WHERE id=$1", [foreign.card.id])).rows).toEqual(foreignBefore);
    expect(await db.select().from(cardSecurityEvents).where(eq(cardSecurityEvents.membershipId, f.card.id))).toEqual([]);
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.recovery_notice"))).toEqual([]);
    await expect(kind === "recovery" ? completeCardRecovery(token, f.card.id) : reissue()).rejects.toMatchObject({ code: kind === "recovery" ? "INVALID_RECOVERY" : "NOT_FOUND" });
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.card.id))).toHaveLength(ledgerBefore.length);
  } finally {
    await gate.query("ROLLBACK"); gate.release(); await Promise.allSettled([closure, attempt]);
  }
}, 15000);
