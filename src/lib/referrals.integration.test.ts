import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, membershipContacts, memberships, referrals, staffRoles } from "@/db/schema";
import { award, redeem, reverseEntry } from "./loyalty";
import { createMerchant, enroll, getMerchantRewards } from "./product";
import { configureReferrals, getCardReferralShare, getReferralSettings, listReferrals, reviewReferral } from "./referrals";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Referral tests require looplocal_test");

const originalBaseUrl = process.env.PUBLIC_BASE_URL;
beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => {
  if (originalBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalBaseUrl;
  await pool.end();
});

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic referral tester", `${id}@example.test`]);
  return id;
}

async function shop(ownerId: string, name = "Synthetic Referral Café") {
  return createMerchant({ userId: ownerId, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `${name} card`, programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
}

function awardOne(input: { ownerId: string; locationId: string; membershipId: string }) {
  return award({ userId: input.ownerId, locationId: input.locationId, membershipId: input.membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
}

describe("referral lifecycle with synthetic cards", () => {
  it("holds bonus until the first confirmed checkout, snapshots the rule, and processes once", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId);
    const referrer = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await expect(getCardReferralShare(referrer.cardToken)).rejects.toMatchObject({ code: "REFERRAL_DISABLED" });
    await configureReferrals({ actorUserId: ownerId, programSlug: merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const share = await getCardReferralShare(referrer.cardToken);
    expect(share.shareUrl).toMatch(/^http:\/\/localhost:3000\/join\/.+\?ref=ref_[A-Za-z0-9_-]+$/);
    const referralCode = new URL(share.shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: merchant.programSlug, acceptedTerms: true, referralCode });
    expect((await db.select().from(memberships).where(eq(memberships.id, referrer.id)))[0].balance).toBe(0);
    expect((await db.select().from(memberships).where(eq(memberships.id, referred.id)))[0].balance).toBe(0);
    await configureReferrals({ actorUserId: ownerId, programSlug: merchant.programSlug, enabled: true, referrerBonus: 5, referredBonus: 5 });
    const request = { userId: ownerId, locationId: merchant.locationId, membershipId: referred.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() };
    const first = await award(request);
    expect(first).toMatchObject({ balance: 2, duplicate: false });
    expect(await award(request)).toMatchObject({ balance: 2, duplicate: true, entryId: first.entryId });
    await awardOne({ ownerId, locationId: merchant.locationId, membershipId: referred.id });
    const [referrerAfter] = await db.select().from(memberships).where(eq(memberships.id, referrer.id));
    const [referredAfter] = await db.select().from(memberships).where(eq(memberships.id, referred.id));
    expect([referrerAfter.balance, referredAfter.balance]).toEqual([2, 3]);
    const bonusEntries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.source, "referral_bonus"));
    expect(bonusEntries.map(row => row.delta).sort()).toEqual([1, 2]);
    expect((await db.select().from(referrals))[0]).toMatchObject({ status: "qualified", referrerBonus: 2, referredBonus: 1, qualifyingEntryId: first.entryId });
  });

  it("places a known verified-email self-referral in owner review without crediting bonuses", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId);
    await configureReferrals({ actorUserId: ownerId, programSlug: merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const referrer = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const code = new URL((await getCardReferralShare(referrer.cardToken)).shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: merchant.programSlug, acceptedTerms: true, referralCode: code });
    await db.insert(membershipContacts).values([
      { tenantId: merchant.tenantId, membershipId: referrer.id, email: "same@example.test", emailVerified: true },
      { tenantId: merchant.tenantId, membershipId: referred.id, email: "same@example.test", emailVerified: true },
    ]);
    await awardOne({ ownerId, locationId: merchant.locationId, membershipId: referred.id });
    const [flagged] = await listReferrals({ actorUserId: ownerId, programSlug: merchant.programSlug });
    expect(flagged).toMatchObject({ status: "review", reviewReason: "same_verified_email" });
    expect(JSON.stringify(flagged)).not.toContain("same@example.test");
    expect((await db.select().from(memberships).where(eq(memberships.id, referrer.id)))[0].balance).toBe(0);
    await reviewReferral({ actorUserId: ownerId, referralId: flagged.id, action: "reject", reason: "Confirmed same verified owner" });
    expect((await db.select().from(referrals))[0].status).toBe("rejected");
  });

  it("reverses both ledger bonuses when the qualifying checkout is corrected", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId);
    await configureReferrals({ actorUserId: ownerId, programSlug: merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const referrer = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const code = new URL((await getCardReferralShare(referrer.cardToken)).shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: merchant.programSlug, acceptedTerms: true, referralCode: code });
    const qualified = await awardOne({ ownerId, locationId: merchant.locationId, membershipId: referred.id });
    await reverseEntry({ userId: ownerId, locationId: merchant.locationId, entryId: qualified.entryId, reason: "Synthetic checkout correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [referral] = await db.select().from(referrals);
    expect(referral.status).toBe("reversed");
    expect((await db.select().from(memberships).where(eq(memberships.id, referrer.id)))[0].balance).toBe(0);
    expect((await db.select().from(memberships).where(eq(memberships.id, referred.id)))[0].balance).toBe(0);
    expect((await db.select().from(ledgerEntries)).filter(row => row.source === "staff_correction" && row.kind === "reversal")).toHaveLength(3);
  });

  it("keeps an unspendable bonus in review and lets the owner retry its reversal after new credit", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId);
    await configureReferrals({ actorUserId: ownerId, programSlug: merchant.programSlug, enabled: true, referrerBonus: 5, referredBonus: 0 });
    const referrer = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const code = new URL((await getCardReferralShare(referrer.cardToken)).shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: merchant.programSlug, acceptedTerms: true, referralCode: code });
    const qualified = await awardOne({ ownerId, locationId: merchant.locationId, membershipId: referred.id });
    const [reward] = await getMerchantRewards({ actorUserId: ownerId, programSlug: merchant.programSlug });
    await redeem({ userId: ownerId, locationId: merchant.locationId, membershipId: referrer.id, rewardVersionId: reward.versionId, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await reverseEntry({ userId: ownerId, locationId: merchant.locationId, entryId: qualified.entryId, reason: "Synthetic checkout correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [needsReview] = await listReferrals({ actorUserId: ownerId, programSlug: merchant.programSlug });
    expect(needsReview).toMatchObject({ status: "review", reviewReason: "bonus_spent" });
    await award({ userId: ownerId, locationId: merchant.locationId, membershipId: referrer.id, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const retried = await reviewReferral({ actorUserId: ownerId, referralId: needsReview.id, action: "retry_reversal" });
    expect(retried.status).toBe("reversed");
    expect((await db.select().from(memberships).where(eq(memberships.id, referrer.id)))[0].balance).toBe(0);
  });

  it("requires owner configuration and rejects foreign referral codes without creating a card", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const cashier = await user();
    const a = await shop(ownerA, "Synthetic Referral A");
    const b = await shop(ownerB, "Synthetic Referral B");
    await db.insert(staffRoles).values({ tenantId: a.tenantId, userId: cashier, role: "cashier", locationId: a.locationId });
    await expect(configureReferrals({ actorUserId: cashier, programSlug: a.programSlug, enabled: true, referrerBonus: 1, referredBonus: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await configureReferrals({ actorUserId: ownerB, programSlug: b.programSlug, enabled: true, referrerBonus: 1, referredBonus: 0 });
    const referrer = await enroll({ slug: b.programSlug, acceptedTerms: true });
    const code = new URL((await getCardReferralShare(referrer.cardToken)).shareUrl).searchParams.get("ref")!;
    await expect(enroll({ slug: a.programSlug, acceptedTerms: true, referralCode: code })).rejects.toMatchObject({ code: "INVALID_REFERRAL" });
    expect((await getReferralSettings({ actorUserId: ownerA, programSlug: a.programSlug })).enabled).toBe(false);
    expect((await db.select().from(memberships).where(eq(memberships.tenantId, a.tenantId)))).toHaveLength(0);
  });
});
