import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { membershipContacts, contactVerificationChallenges, ledgerEntries, memberships, outboxJobs, tapRequests, referrals, billingLocationPlans } from "@/db/schema";
import { nfcFixture } from "./nfc-test-db";
import { configureReferrals, getCardReferralShare } from "./referrals";
import { enroll } from "./product";
import { prepareOfflineAward, syncOfflineAward } from "./offline-earning";
import { award } from "./loyalty";
import { requestContactVerification, consumeContactVerification, removeRecoveryEmail, contactStatus } from "./contact-verification";
import { verificationTokenForChallenge } from "./contact-token";
import { requestCardRecovery, recoveryOptions, completeCardRecovery } from "./card-recovery";
import { recoveryTokenForChallenge } from "./contact-token";
import { DerivedTapKeyProvider, deriveVerificationKeys, parseMaster } from "./nfc-keys";
import { provisionSecureTag, activateSecureTag, processSecureTap, previewSecureTap, confirmTapRequest } from "./secure-tap";
import { sdmFor } from "./nfc-test-support";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Disposable local test database required");
beforeEach(async () => {
  vi.stubEnv("VERIFIED_RECOVERY_BEFORE_FIRST_AWARD", "true");
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-recovery-first-award-secret-at-least-32");
  vi.stubEnv("PUBLIC_BASE_URL", "http://localhost:3000");
  vi.stubEnv("SMTP_HOST", "localhost");
  vi.stubEnv("EXTERNAL_EMAIL_ENABLED", "false");
  vi.stubEnv("TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED", "false");
  await pool.query('TRUNCATE TABLE card_recovery_challenges, email_suppressions, email_provider_events, rate_limits, tenants, "user", demo_requests CASCADE');
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => pool.end());
type Fixture = Awaited<ReturnType<typeof nfcFixture>>;
const input = (f: Fixture, key = randomUUID()) => ({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 1, idempotencyKey: key, requestId: randomUUID() });
async function verify(f: Fixture, email = "customer@example.test") {
  await requestContactVerification(f.member.cardToken, email);
  const [challenge] = await db.select().from(contactVerificationChallenges).where(eq(contactVerificationChallenges.membershipId, f.member.id));
  await consumeContactVerification(verificationTokenForChallenge(challenge.id));
}
async function chip(f: Fixture) {
  const master = parseMaster("7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a");
  const uid = `04${randomBytes(6).toString("hex")}`, keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid, keyRef, configVersion: 1 });
  await activateSecureTag({ actorUserId: f.userId, tagId: tag.id });
  const keys = deriveVerificationKeys(master, keyRef, uid);
  return (counter: number) => ({ tagRef: tag.publicRef, fields: sdmFor({ uid, counter, keys }), keyProvider: new DerivedTapKeyProvider(master), cardToken: f.member.cardToken });
}

describe("verified recovery before a first award", () => {
  it("blocks both cashier/QR and offline first awards without ledger, balance or Wallet outbox side effects", async () => {
    const f = await nfcFixture();
    for (const source of ["staff_online", "staff_offline"] as const) {
      await expect(award({ ...input(f), source })).rejects.toMatchObject({ code: "RECOVERY_EMAIL_REQUIRED" });
    }
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    expect(await db.select().from(outboxJobs)).toHaveLength(0);
    expect((await db.select().from(memberships))[0].balance).toBe(0);
  });
  it("records an offline first-award rejection rather than bypassing verification during synchronization", async () => {
    const f = await nfcFixture(), deviceId = randomUUID();
    const lease = await prepareOfflineAward({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, deviceId });
    const event = { userId: f.userId, leaseId: lease.leaseId, deviceId, eventId: randomUUID(), eventAt: new Date(), award: { quantity: 1 } };
    expect(await syncOfflineAward(event)).toMatchObject({ status: "rejected", reason: "RECOVERY_EMAIL_REQUIRED" });
    await verify(f);
    expect(await syncOfflineAward(event)).toMatchObject({ status: "rejected", reason: "RECOVERY_EMAIL_REQUIRED", duplicate: true });
    expect(await syncOfflineAward({ ...event, eventId: randomUUID() })).toMatchObject({ status: "accepted", balance: 1 });
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });
  it("holds an unverified referrer's first bonus in existing owner review without blocking a verified customer's checkout", async () => {
    const f = await nfcFixture();
    await db.insert(billingLocationPlans).values({ tenantId: f.tenant.id, locationId: f.location.id, currency: "EUR", priceMinor: 1900 });
    await configureReferrals({ actorUserId: f.userId, programSlug: f.program.slug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const referralCode = new URL((await getCardReferralShare(f.member.cardToken)).shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: f.program.slug, acceptedTerms: true, referralCode });
    await verify({ ...f, member: { ...f.member, ...referred } }, "referred@example.test");
    const request = { ...input(f), membershipId: referred.id };
    expect(await award(request)).toMatchObject({ balance: 1 });
    expect(await award(request)).toMatchObject({ balance: 1, duplicate: true });
    expect((await db.select().from(referrals))[0]).toMatchObject({ status: "review", reviewReason: "recovery_email_required", referrerBonusEntryId: null, referredBonusEntryId: null });
    expect((await db.select().from(ledgerEntries)).map(e => e.membershipId)).toEqual([referred.id]);
    await expect(award(input(f))).rejects.toMatchObject({ code: "RECOVERY_EMAIL_REQUIRED" });
    await verify(f, "referrer@example.test");
    expect(await award(input(f))).toMatchObject({ balance: 1 });
  });
  it("does not treat an unverified address or another merchant's verified contact as ownership", async () => {
    const f = await nfcFixture(), other = await nfcFixture();
    await verify(other);
    await requestContactVerification(f.member.cardToken, "customer@example.test");
    await expect(award(input(f))).rejects.toMatchObject({ code: "RECOVERY_EMAIL_REQUIRED" });
    expect(await contactStatus(f.member.cardToken)).toMatchObject({ recoveryRequired: true, emailVerified: false });
  });
  it("requires verification before creating a pending NFC request and still requires explicit staff approval afterwards", async () => {
    const f = await nfcFixture(), tap = await chip(f);
    expect(await previewSecureTap(tap(1))).toMatchObject({ hasMembership: true, recoveryEmailRequired: true });
    await expect(processSecureTap(tap(1))).rejects.toMatchObject({ code: "RECOVERY_EMAIL_REQUIRED" });
    expect(await db.select().from(tapRequests)).toHaveLength(0);
    await verify(f);
    const pending = await processSecureTap(tap(1));
    expect(pending.state).toBe("pending_staff");
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    await removeRecoveryEmail(f.member.cardToken);
    await expect(confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId! })).rejects.toMatchObject({ code: "RECOVERY_EMAIL_REQUIRED" });
    expect((await db.select().from(tapRequests))[0].status).toBe("pending_staff");
    await verify(f);
    const results = await Promise.all([
      confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId! }),
      confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId! }),
    ]);
    expect(results.map(r => r.state).sort()).toEqual(["already_processed", "confirmed"]);
    expect((await db.select().from(ledgerEntries)).map(e => e.delta)).toEqual([1]);
  });
  it("verification unlocks exactly one first award and preserves idempotency and existing awarded-card history", async () => {
    const f = await nfcFixture(); await verify(f);
    const value = input(f);
    const results = await Promise.all([award(value), award(value)]);
    expect(results.map(r => r.duplicate).sort()).toEqual([false, true]);
    await removeRecoveryEmail(f.member.cardToken);
    expect((await award(value)).duplicate).toBe(true);
    expect((await award(input(f))).balance).toBe(2);
    expect((await db.select().from(ledgerEntries)).map(e => e.delta)).toEqual([1, 1]);
  });
  it("disabled policy preserves accepted behavior; enabling it does not rewrite prior awards", async () => {
    const f = await nfcFixture(); vi.stubEnv("VERIFIED_RECOVERY_BEFORE_FIRST_AWARD", "false");
    expect((await award(input(f))).balance).toBe(1);
    vi.stubEnv("VERIFIED_RECOVERY_BEFORE_FIRST_AWARD", "true");
    expect((await award(input(f))).balance).toBe(2);
  });
  it("a verified inbox recovers only the selected original membership with its K-number and ledger intact", async () => {
    const f = await nfcFixture(); await verify(f); await award(input(f));
    const other = await nfcFixture(); await verify(other);
    await requestCardRecovery("customer@example.test");
    const { rows: [challenge] } = await pool.query("SELECT id FROM card_recovery_challenges WHERE email='customer@example.test'");
    const token = recoveryTokenForChallenge(challenge.id);
    expect((await recoveryOptions(token)).cards.map(c => c.membershipId).sort()).toEqual([f.member.id, other.member.id].sort());
    const recovered = await completeCardRecovery(token, f.member.id);
    expect(recovered.membershipId).toBe(f.member.id); expect(recovered.cardToken).not.toBe(f.member.cardToken);
    const [member] = await db.select().from(memberships).where(eq(memberships.id, f.member.id));
    expect(member).toMatchObject({ cardLocator: f.member.cardLocator, balance: 1, scanCode: f.member.scanCode });
    expect((await db.select().from(ledgerEntries)).map(e => e.membershipId)).toEqual([f.member.id]);
    expect((await db.select().from(membershipContacts)).filter(c=>c.emailVerified)).toHaveLength(2);
  });
});
