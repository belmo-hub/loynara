import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { auth } from "./auth";
import { POST as onboardRoute } from "@/app/api/merchant/onboard/route";
import { POST as enrollRoute } from "@/app/api/enroll/route";
import { GET as returningRoute } from "@/app/api/enroll/existing/route";
import { POST as awardRoute } from "@/app/api/cashier/award/route";
import { POST as redeemRoute } from "@/app/api/cashier/redeem/route";
import { createMerchant, enroll, getCard, getMerchantRewards, lookupCard } from "./product";
import { acceptStaffInvite, createStaffInvite, revokeStaff } from "./staff";
import { getMerchantBrand, updateMerchantBrand } from "./merchant-brand";
import { configureReferrals, getCardReferralShare, listReferrals } from "./referrals";
import { consumeContactVerification, requestContactVerification, setEmailMarketingPreference } from "./contact-verification";
import { recoveryTokenForChallenge, verificationTokenForChallenge } from "./contact-token";
import { completeCardRecovery, recoveryOptions, requestCardRecovery } from "./card-recovery";
import { createDraftCampaign, dispatchCampaign, previewCampaign, scheduleCampaign } from "./campaigns";
import { createUnsubscribeToken, unsubscribeMarketing } from "./unsubscribe";
import { getMerchantAnalytics } from "./merchant-analytics";
import { POST as googleIssue } from "@/app/api/wallet/google/route";
import { fakeGoogleApi, googleFixture, withEnv } from "./wallet/test-support";
import { googleDirectConfig } from "./wallet/google-direct";
import { GoogleWalletClient } from "./wallet/google";
import { refreshWalletForMembership } from "./wallet/refresh";

// This suite catches missing tenant predicates, lost accounting/consent side effects,
// auth bypass, duplicate credit and recovery that replaces rather than restores a member.
// External delivery and physical NFC acceptance are outside this local contract.
const url = process.env.DATABASE_URL;
if (!url || !url.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Owned local synthetic database required");
const origin = "http://localhost:3000";
const envKeys = ["PUBLIC_REGISTRATION_ENABLED", "STAFF_INVITE_SIGNUP_ENABLED", "SMTP_HOST", "EXTERNAL_EMAIL_ENABLED", "PROMOTIONAL_EXTERNAL_EMAIL_ENABLED", "MAILGUN_PROMOTIONAL_SEND_APPROVED"];
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
beforeAll(async () => {
  Object.assign(process.env, { PUBLIC_REGISTRATION_ENABLED: "true", STAFF_INVITE_SIGNUP_ENABLED: "true", SMTP_HOST: "localhost", EXTERNAL_EMAIL_ENABLED: "false", PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "false", MAILGUN_PROMOTIONAL_SEND_APPROVED: "false" });
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
});
afterAll(async () => { for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } await pool.end(); });
function request(path: string, body: unknown, cookie = "") {
  return new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}
async function identity(label: string) {
  const email = `${randomUUID()}@example.test`, password = "synthetic-cohort-local-password-only";
  const result = await auth.api.signUpEmail({ body: { name: label, email, password } });
  const response = await auth.handler(request("/api/auth/sign-in/email", { email, password }));
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  expect(cookie).not.toBe("");
  return { userId: result.user.id, email, cookie };
}
async function fixture(index: number) {
  const owner = await identity(`Cohort owner ${index}`);
  const body = { businessName: `Cohort Merchant ${index}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `Cohort programme ${index}`, programType: index < 5 ? "stamp" : "points", earningMode: "manual", rulesText: "Synthetic authorized checkout only", rewardTitle: "Cohort selected reward", rewardCost: 3 };
  const response = await onboardRoute(request("/api/merchant/onboard", body, owner.cookie));
  expect(response.status).toBe(201);
  const merchant = await response.json() as Awaited<ReturnType<typeof createMerchant>>;
  const cashier = await identity(`Cohort cashier ${index}`);
  const invitation = await createStaffInvite({ actorUserId: owner.userId, locationId: merchant.locationId, email: cashier.email, role: "cashier" });
  await acceptStaffInvite({ userId: cashier.userId, token: invitation.token });
  const joined = await enrollRoute(request("/api/enroll", { slug: merchant.programSlug, acceptedTerms: true }));
  expect(joined.status).toBe(201);
  const { cardToken } = await joined.json() as { cardToken: string };
  const cookie = joined.headers.getSetCookie().filter(value => !/Max-Age=0/i.test(value)).map(value => value.split(";")[0]).join("; ");
  const member = (await pool.query("SELECT id,scan_code FROM memberships WHERE card_token=$1", [cardToken])).rows[0] as { id: string; scan_code: string };
  return { owner, cashier, merchant, cardToken, cookie, member };
}

it("keeps ten simultaneous merchants isolated through real sessions, checkout replay, referrals, consent, reporting and recovery", async () => {
  const cohort: Awaited<ReturnType<typeof fixture>>[] = [];
  for (let i = 0; i < 10; i++) cohort.push(await fixture(i));
  expect(new Set(cohort.map(f => f.merchant.tenantId)).size).toBe(10);
  const google = googleFixture("demo"), api = fakeGoogleApi();
  try { await withEnv({ ...google.env, GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify(cohort.map(f => ({ tenantId: f.merchant.tenantId, locationId: f.merchant.locationId, programId: f.merchant.programId, classId: `3388000000023201754.program_${f.merchant.programId}`, issuanceEnabled: true, testAccountsApproved: true }))) }, async () => {
  vi.stubGlobal("fetch", api.fetcher); // Only synthetic Google OAuth/REST: no request leaves this process.
  for (const [index, f] of cohort.entries()) {
    const foreign = cohort[(index + 1) % 10];
    const brand = { actorUserId: f.owner.userId, programSlug: f.merchant.programSlug, businessName: `Cohort verified ${index}`, locationName: `Counter ${index}`, brandColor: "#32634d" };
    await updateMerchantBrand(brand);
    expect(await getMerchantBrand({ actorUserId: f.owner.userId, programSlug: f.merchant.programSlug })).toMatchObject({ businessName: `Cohort verified ${index}`, locationName: `Counter ${index}`, brandColor: "#32634d" });
    await expect(updateMerchantBrand({ ...brand, actorUserId: foreign.owner.userId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getMerchantRewards({ actorUserId: foreign.owner.userId, programSlug: f.merchant.programSlug })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const returning = await returningRoute(new Request(`${origin}/api/enroll/existing?slug=${f.merchant.programSlug}`, { headers: { cookie: f.cookie } }));
    expect(await returning.json()).toMatchObject({ existing: true });
    const duplicateJoin = await enrollRoute(request("/api/enroll", { slug: f.merchant.programSlug, acceptedTerms: true }, f.cookie));
    expect(duplicateJoin.status).toBe(409);
    const card = await lookupCard({ userId: f.cashier.userId, locationId: f.merchant.locationId, scanCode: f.member.scan_code });
    expect(card).toMatchObject({ membershipId: f.member.id, balance: 0 });
    await expect(lookupCard({ userId: foreign.cashier.userId, locationId: foreign.merchant.locationId, scanCode: f.member.scan_code })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await googleIssue(request("/api/wallet/google", { token: f.cardToken }))).status).toBe(200);
    const originalPass = (await pool.query("SELECT id,provider_object_id FROM wallet_passes WHERE membership_id=$1", [f.member.id])).rows;
    expect(originalPass).toHaveLength(1);
    const googleClient = new GoogleWalletClient(googleDirectConfig(process.env, f.merchant.tenantId, f.merchant.locationId, f.merchant.programId), api.fetcher);
    const booking = { membershipId: f.member.id, quantity: 3, idempotencyKey: randomUUID(), requestId: randomUUID() };
    expect((await awardRoute(request("/api/cashier/award", booking, foreign.owner.cookie))).status).toBe(404);
    expect((await awardRoute(request("/api/cashier/award", booking))).status).toBe(401);
    const responses = await Promise.all([awardRoute(request("/api/cashier/award", booking, f.cashier.cookie)), awardRoute(request("/api/cashier/award", booking, f.cashier.cookie))]);
    for (const response of responses) expect(response.status).toBe(200);
    const awards = await Promise.all(responses.map(response => response.json()));
    expect(awards.map(value => value.duplicate).sort()).toEqual([false, true]);
    expect(new Set(awards.map(value => value.entryId)).size).toBe(1);
    expect((await getCard(f.cardToken)).balance).toBe(3);
    expect(await refreshWalletForMembership(f.member.id, { google: googleClient, expectedTenantId: foreign.merchant.tenantId })).toEqual({ status: "complete" });
    expect(api.objects.get(originalPass[0].provider_object_id)?.loyaltyPoints).toMatchObject({ balance: index < 5 ? { string: "0 / 3" } : { int: 0 } });
    expect(await refreshWalletForMembership(f.member.id, { google: googleClient, expectedTenantId: f.merchant.tenantId })).toEqual({ status: "complete" });
    expect(api.objects.get(originalPass[0].provider_object_id)?.loyaltyPoints).toMatchObject({ balance: index < 5 ? { string: "3 / 3" } : { int: 3 } });
    await configureReferrals({ actorUserId: f.owner.userId, programSlug: f.merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const share = await getCardReferralShare(f.cardToken);
    const referred = await enroll({ slug: f.merchant.programSlug, acceptedTerms: true, referralCode: new URL(share.shareUrl).searchParams.get("ref")! });
    const referralBooking = { membershipId: referred.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() };
    for (let replay = 0; replay < 2; replay++) expect((await awardRoute(request("/api/cashier/award", referralBooking, f.cashier.cookie))).status).toBe(200);
    expect((await getCard(f.cardToken)).balance).toBe(5);
    expect((await getCard(referred.cardToken)).balance).toBe(2);
    expect(await listReferrals({ actorUserId: f.owner.userId, programSlug: f.merchant.programSlug })).toMatchObject([{ status: "qualified" }]);
    const [reward] = await getMerchantRewards({ actorUserId: f.owner.userId, programSlug: f.merchant.programSlug });
    const redemption = { membershipId: f.member.id, rewardVersionId: reward.versionId, idempotencyKey: randomUUID(), requestId: randomUUID() };
    expect((await redeemRoute(request("/api/cashier/redeem", redemption, foreign.owner.cookie))).status).toBe(404);
    for (let replay = 0; replay < 2; replay++) expect((await redeemRoute(request("/api/cashier/redeem", redemption, f.cashier.cookie))).status).toBe(200);
    expect((await getCard(f.cardToken)).balance).toBe(2);
    const email = `cohort-${index}@example.test`;
    await requestContactVerification(f.cardToken, email);
    const challenge = (await pool.query("SELECT id FROM contact_verification_challenges WHERE membership_id=$1", [f.member.id])).rows[0];
    await consumeContactVerification(verificationTokenForChallenge(challenge.id));
    await setEmailMarketingPreference(f.cardToken, true);
    const audienceDefinition = { kind: "new" as const, withinDays: 7 };
    expect(await previewCampaign({ actorUserId: f.owner.userId, programSlug: f.merchant.programSlug, audienceDefinition })).toMatchObject({ total: 2, eligibleCount: 1 });
    await expect(previewCampaign({ actorUserId: foreign.owner.userId, programSlug: f.merchant.programSlug, audienceDefinition })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const draft = await createDraftCampaign({ actorUserId: f.owner.userId, programSlug: f.merchant.programSlug, title: `Cohort ${index}`, subject: "Synthetic only", body: "No external customer sends", audienceDefinition });
    const when = new Date(Date.now() + 1000);
    await scheduleCampaign({ actorUserId: f.owner.userId, campaignId: draft.id, scheduledAt: when });
    await unsubscribeMarketing(createUnsubscribeToken({ tenantId: f.merchant.tenantId, membershipId: f.member.id, email }));
    const job = (await pool.query("SELECT id,tenant_id,payload FROM outbox_jobs WHERE kind='campaign.dispatch' AND payload->>'campaignId'=$1", [draft.id])).rows[0];
    expect(await dispatchCampaign({ id: job.id, tenantId: job.tenant_id, payload: job.payload }, new Date(when.getTime() + 1000))).toMatchObject({ queuedCount: 0 });
    expect((await pool.query("SELECT count(*)::int AS n FROM campaign_recipients WHERE campaign_id=$1", [draft.id])).rows[0].n).toBe(0);
    const report = await getMerchantAnalytics(f.owner.userId, { windowDays: 30, asOf: new Date(Date.now() + 1000) });
    expect(report).toMatchObject({ currentActiveCards: 2, qualifyingCheckouts: 2, issued: { awardActions: 2, stampUnits: index < 5 ? 4 : 0, pointUnits: index < 5 ? 0 : 4 }, rewards: { redemptions: 1 } });
    await expect(getMerchantAnalytics(f.cashier.userId, { windowDays: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await requestCardRecovery(email);
    const recovery = (await pool.query("SELECT id FROM card_recovery_challenges WHERE email=$1 ORDER BY created_at DESC LIMIT 1", [email])).rows[0];
    const token = recoveryTokenForChallenge(recovery.id);
    expect((await recoveryOptions(token)).cards).toMatchObject([{ membershipId: f.member.id }]);
    await expect(completeCardRecovery(token, foreign.member.id)).rejects.toMatchObject({ code: "INVALID_RECOVERY" });
    const restored = await completeCardRecovery(token, f.member.id);
    expect(restored.membershipId).toBe(f.member.id);
    expect((await googleIssue(request("/api/wallet/google", { token: restored.cardToken }))).status).toBe(200);
    expect(await refreshWalletForMembership(f.member.id, { google: googleClient, expectedTenantId: f.merchant.tenantId })).toEqual({ status: "complete" });
    expect(api.objects.get(originalPass[0].provider_object_id)?.loyaltyPoints).toMatchObject({ balance: index < 5 ? { string: "2 / 3" } : { int: 2 } });
    expect((await pool.query("SELECT id,provider_object_id FROM wallet_passes WHERE membership_id=$1", [f.member.id])).rows).toEqual(originalPass);
    expect(await getCard(restored.cardToken)).toMatchObject({ balance: 2, scanCode: f.member.scan_code });
    await expect(getCard(f.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await revokeStaff({ actorUserId: f.owner.userId, userId: f.cashier.userId });
    expect((await awardRoute(request("/api/cashier/award", { ...booking, idempotencyKey: randomUUID() }, f.cashier.cookie))).status).toBe(403);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1", [f.merchant.tenantId])).rows[0].n).toBe(5);
  }
  expect(api.objects.size).toBe(10);
  expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes")).rows[0].n).toBe(10);
  }); } finally { vi.unstubAllGlobals(); google.cleanup(); }
  expect((await pool.query("SELECT count(*)::int AS n FROM tenants")).rows[0].n).toBe(10);
  expect((await pool.query("SELECT count(*)::int AS n FROM memberships")).rows[0].n).toBe(20);
}, 90000);
