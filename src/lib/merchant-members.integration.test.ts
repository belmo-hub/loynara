import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { billingLocationPlans, consentEvents, locations, membershipContacts, memberships, programRuleVersions, programs, rewards, rewardVersions, staffRoles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { award, redeem, reverseEntry } from "./loyalty";
import { createMerchant, enroll } from "./product";
import { getMerchantMember, listMerchantMembers } from "./merchant-members";
import { configureReferrals, getCardReferralShare } from "./referrals";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Merchant member tests require looplocal_test");

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
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic merchant tester", `${id}@example.test`]);
  return id;
}

async function merchant(ownerId: string, name: string) {
  return createMerchant({ userId: ownerId, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `${name} Karte`, programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5 });
}

async function purchaseMerchant(ownerId: string) {
  return createMerchant({ userId: ownerId, businessName: "Synthetic Purchase Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punkte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Ein Punkt je bestätigtem Euro Einkauf.", rewardTitle: "Kaffee", rewardCost: 5 });
}

describe("merchant member read model", () => {
  it("counts a confirmed award once regardless of quantity or retry and shows a pseudonymous timeline", async () => {
    const ownerId = await user();
    const shop = await merchant(ownerId, "Synthetic A");
    const card = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    const key = randomUUID();
    const requestId = randomUUID();
    await award({ userId: ownerId, locationId: shop.locationId, membershipId: card.id, quantity: 5, idempotencyKey: key, requestId });
    await award({ userId: ownerId, locationId: shop.locationId, membershipId: card.id, quantity: 5, idempotencyKey: key, requestId });
    const [laterReward] = await db.insert(rewards).values({ tenantId: shop.tenantId, programId: shop.programId, sortOrder: 2 }).returning();
    const [earlierReward] = await db.insert(rewards).values({ tenantId: shop.tenantId, programId: shop.programId, sortOrder: 1 }).returning();
    await db.insert(rewardVersions).values([
      { tenantId: shop.tenantId, rewardId: laterReward.id, version: 1, title: "Dessert", cost: 2 },
      { tenantId: shop.tenantId, rewardId: earlierReward.id, version: 1, title: "Tee", cost: 2 },
    ]);
    const detailsBefore = await getMerchantMember(ownerId, card.id);
    expect(detailsBefore.member).toMatchObject({ id: card.id, balance: 5, qualifyingCheckouts: 1, activityCount: 1, redemptionCount: 0, purchaseCount: null, referralStatus: "none", qualifiedReferrals: 0, eligibility: "eligible" });
    expect(detailsBefore.member.firstQualifyingAt).toBeTruthy();
    expect(detailsBefore.member.lastQualifyingAt).toBeTruthy();
    expect(JSON.stringify(detailsBefore)).not.toContain(card.cardToken);
    expect(JSON.stringify(detailsBefore)).not.toContain(card.scanCode);
    const [reward] = detailsBefore.eligibleRewards;
    expect(reward?.title).toBe("Kaffee");
    expect(detailsBefore.eligibleRewards.map(item => item.title)).toEqual(["Kaffee", "Tee", "Dessert"]);

    await redeem({ userId: ownerId, locationId: shop.locationId, membershipId: card.id, rewardVersionId: reward.id, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const after = await getMerchantMember(ownerId, card.id);
    expect(after.member).toMatchObject({ balance: 0, qualifyingCheckouts: 1, activityCount: 2, redemptionCount: 1, eligibility: "not_yet" });
    expect(after.timeline.map(entry => entry.delta)).toEqual([-5, 5]);
    expect(after.timeline[0]).toMatchObject({ kind: "redeem", rewardTitle: "Kaffee" });
    expect((await listMerchantMembers(ownerId, {})).members[0]).toMatchObject({ id: card.id, balance: 0, qualifyingCheckouts: 1, activityCount: 2, redemptionCount: 1 });
  });

  it("excludes synthetic seed and reversed awards from qualifying checkouts while preserving signed history", async () => {
    const ownerId = await user();
    const shop = await merchant(ownerId, "Synthetic B");
    const card = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    await award({ userId: ownerId, locationId: shop.locationId, membershipId: card.id, quantity: 3, idempotencyKey: randomUUID(), requestId: randomUUID(), source: "synthetic_seed" });
    const staffAward = await award({ userId: ownerId, locationId: shop.locationId, membershipId: card.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await reverseEntry({ userId: ownerId, locationId: shop.locationId, entryId: staffAward.entryId, reason: "Synthetic correction of duplicate checkout", idempotencyKey: randomUUID(), requestId: randomUUID() });
    const detail = await getMerchantMember(ownerId, card.id);
    expect(detail.member).toMatchObject({ balance: 3, qualifyingCheckouts: 0, activityCount: 3, firstQualifyingAt: null, lastQualifyingAt: null });
    expect(detail.timeline.map(entry => entry.delta)).toEqual([-2, 2, 3]);
    expect(detail.timeline[0].kind).toBe("reversal");
  });

  it("shows persisted referral attribution and qualified referral counts without exposing identifiers", async () => {
    const ownerId = await user();
    const shop = await merchant(ownerId, "Synthetic Referral Detail");
    const referrer = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    await configureReferrals({ actorUserId: ownerId, programSlug: shop.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const share = await getCardReferralShare(referrer.cardToken);
    const referralCode = new URL(share.shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: shop.programSlug, acceptedTerms: true, referralCode });

    expect((await getMerchantMember(ownerId, referred.id)).member).toMatchObject({ referralStatus: "pending", qualifiedReferrals: 0 });
    await award({ userId: ownerId, locationId: shop.locationId, membershipId: referred.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect((await getMerchantMember(ownerId, referred.id)).member).toMatchObject({ referralStatus: "qualified", qualifiedReferrals: 0 });
    const referrerDetail = await getMerchantMember(ownerId, referrer.id);
    expect(referrerDetail.member).toMatchObject({ referralStatus: "none", qualifiedReferrals: 1 });
    expect((await listMerchantMembers(ownerId, {})).members.find(member => member.id === referrer.id)).toMatchObject({ qualifiedReferrals: 1 });
    expect(JSON.stringify(referrerDetail)).not.toContain(referralCode);
    expect(JSON.stringify(referrerDetail)).not.toContain(referrer.cardToken);
    expect(JSON.stringify(referrerDetail)).not.toContain(referred.cardToken);
  });

  it("enforces owner tenant scope and manager location scope, denies cashier/revoked staff and filters pseudonymous cards", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const managerA = await user();
    const cashierA = await user();
    const shopA = await merchant(ownerA, "Synthetic C");
    const shopB = await merchant(ownerB, "Synthetic D");
    const cardA = await enroll({ slug: shopA.programSlug, acceptedTerms: true });
    const cardB = await enroll({ slug: shopB.programSlug, acceptedTerms: true });
    const [secondLocation] = await db.insert(locations).values({ tenantId: shopA.tenantId, name: "Second location", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
    await db.insert(billingLocationPlans).values({ tenantId: shopA.tenantId, locationId: secondLocation.id, currency: "EUR", priceMinor: 4900 });
    const secondSlug = `second-${randomUUID()}`;
    await db.insert(programs).values({ tenantId: shopA.tenantId, locationId: secondLocation.id, slug: secondSlug, name: "Second card", type: "stamp", rulesText: "Synthetic rule" });
    const cardSecond = await enroll({ slug: secondSlug, acceptedTerms: true });
    await db.insert(staffRoles).values([
      { tenantId: shopA.tenantId, userId: managerA, role: "manager", locationId: shopA.locationId },
      { tenantId: shopA.tenantId, userId: cashierA, role: "cashier", locationId: shopA.locationId },
    ]);

    expect((await listMerchantMembers(ownerA, {})).members.map(row => row.id).sort()).toEqual([cardA.id, cardSecond.id].sort());
    expect((await listMerchantMembers(managerA, {})).members.map(row => row.id)).toEqual([cardA.id]);
    expect((await listMerchantMembers(ownerB, {})).members.map(row => row.id)).toEqual([cardB.id]);
    await expect(getMerchantMember(managerA, cardSecond.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getMerchantMember(ownerB, cardA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listMerchantMembers(cashierA, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, managerA));
    await expect(listMerchantMembers(managerA, {})).rejects.toMatchObject({ code: "FORBIDDEN" });

    await db.update(memberships).set({ closedAt: new Date() }).where(eq(memberships.id, cardA.id));
    expect((await listMerchantMembers(ownerA, { status: "closed" })).members.map(row => row.id)).toEqual([cardA.id]);
    expect((await listMerchantMembers(ownerA, { query: cardSecond.id.slice(0, 12) })).members.map(row => row.id)).toEqual([cardSecond.id]);
    expect(JSON.stringify(await listMerchantMembers(ownerA, {}))).not.toContain(cardA.cardToken);
    expect(JSON.stringify(await listMerchantMembers(ownerA, {}))).not.toContain(cardA.scanCode);
  });

  it("shows purchase counts only when amounts are captured and derives channel eligibility from latest verified consent", async () => {
    const ownerId = await user();
    const shop = await purchaseMerchant(ownerId);
    const card = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    const [rule] = await db.select({ id: programRuleVersions.id }).from(programRuleVersions).where(eq(programRuleVersions.programId, shop.programId));
    const purchase = await award({ userId: ownerId, locationId: shop.locationId, membershipId: card.id, purchaseAmountMinor: 500, ruleVersionId: rule.id, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await db.insert(membershipContacts).values({ tenantId: shop.tenantId, membershipId: card.id, email: "private@example.test", emailVerified: false });
    const first = new Date("2026-09-25T08:00:00Z");
    const second = new Date("2026-09-25T09:00:00Z");
    await db.insert(consentEvents).values({ tenantId: shop.tenantId, membershipId: card.id, channel: "email", purpose: "marketing", granted: true, noticeVersion: "test", source: "test", createdAt: first });
    let detail = await getMerchantMember(ownerId, card.id);
    expect(detail.member).toMatchObject({ purchaseCount: 1, qualifyingCheckouts: 1, emailMarketingEligible: false });
    await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
    detail = await getMerchantMember(ownerId, card.id);
    expect(detail.member.emailMarketingEligible).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("private@example.test");
    expect((await listMerchantMembers(ownerId, { activity: "recorded" })).members.map(item => item.id)).toEqual([card.id]);
    expect((await listMerchantMembers(ownerId, { activity: "none" })).members).toEqual([]);
    await db.insert(consentEvents).values({ tenantId: shop.tenantId, membershipId: card.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "test", source: "test", createdAt: second });
    detail = await getMerchantMember(ownerId, card.id);
    expect(detail.member.emailMarketingEligible).toBe(false);
    await reverseEntry({ userId: ownerId, locationId: shop.locationId, entryId: purchase.entryId, reason: "Synthetic correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect((await getMerchantMember(ownerId, card.id)).member).toMatchObject({ purchaseCount: 0, qualifyingCheckouts: 0 });
  });

  it("paginates cards and timeline entries without losing sub-millisecond database timestamps", async () => {
    const ownerId = await user();
    const shop = await merchant(ownerId, "Synthetic Cursor Café");
    const first = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    const second = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    await pool.query("UPDATE memberships SET created_at = $1::timestamptz WHERE id = $2", ["2026-09-25T10:00:00.123789Z", first.id]);
    await pool.query("UPDATE memberships SET created_at = $1::timestamptz WHERE id = $2", ["2026-09-25T10:00:00.123456Z", second.id]);
    const page1 = await listMerchantMembers(ownerId, { limit: 1 });
    const page2 = await listMerchantMembers(ownerId, { limit: 1, cursor: page1.nextCursor! });
    expect(page1.members.map(item => item.id)).toEqual([first.id]);
    expect(page2.members.map(item => item.id)).toEqual([second.id]);
    expect(page2.nextCursor).toBeNull();
    const firstAwardId = randomUUID();
    const secondAwardId = randomUUID();
    for (const [id, at] of [[firstAwardId, "2026-09-25T10:00:00.123789Z"], [secondAwardId, "2026-09-25T10:00:00.123456Z"]]) {
      await pool.query(`INSERT INTO ledger_entries (id, tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, created_at)
        VALUES ($1, $2, $3, $4, 1, 'award', 'staff_online', $5, $6, $7, $8::timestamptz)`,
      [id, shop.tenantId, shop.locationId, first.id, ownerId, randomUUID(), randomUUID(), at]);
    }
    await pool.query("UPDATE memberships SET balance = 2 WHERE id = $1", [first.id]);
    const timeline1 = await getMerchantMember(ownerId, first.id, { limit: 1 });
    const timeline2 = await getMerchantMember(ownerId, first.id, { limit: 1, cursor: timeline1.nextCursor! });
    expect(timeline1.timeline.map(item => item.id)).toEqual([firstAwardId]);
    expect(timeline2.timeline.map(item => item.id)).toEqual([secondAwardId]);
    expect(timeline2.nextCursor).toBeNull();
  });
});
