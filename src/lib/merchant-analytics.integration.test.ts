import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { campaignAttempts, campaignRecipients, campaigns, ledgerEntries, locations, memberships, programs, outboxJobs, programRuleVersions, referrals, rewardVersions, rewards, staffRoles } from "@/db/schema";
import { award, redeem, reverseEntry } from "./loyalty";
import { createMerchant, enroll } from "./product";
import { getMerchantAnalytics } from "./merchant-analytics";
import { configureReferrals, getCardReferralShare } from "./referrals";
import { createAdditionalLocation } from "./locations";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Analytics tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic analytics tester", `${id}@example.test`]);
  return id;
}

async function merchant(ownerId: string, name: string) {
  return createMerchant({ userId: ownerId, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `${name} Karte`, programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5 });
}

describe("owner-only merchant analytics", () => {
  it("deduplicates checkouts, excludes seed/reversed awards, and reports redemptions and delivery attempts", async () => {
    const ownerId = await user();
    const shop = await merchant(ownerId, "Synthetic Analytics A");
    const first = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    const second = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    const key = randomUUID();
    const requestId = randomUUID();
    await award({ userId: ownerId, locationId: shop.locationId, membershipId: first.id, quantity: 5, idempotencyKey: key, requestId });
    await award({ userId: ownerId, locationId: shop.locationId, membershipId: first.id, quantity: 5, idempotencyKey: key, requestId });
    await award({ userId: ownerId, locationId: shop.locationId, membershipId: first.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const corrected = await award({ userId: ownerId, locationId: shop.locationId, membershipId: first.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await reverseEntry({ userId: ownerId, locationId: shop.locationId, entryId: corrected.entryId, reason: "Synthetic correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
    await award({ userId: ownerId, locationId: shop.locationId, membershipId: second.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await award({ userId: ownerId, locationId: shop.locationId, membershipId: second.id, quantity: 4, source: "synthetic_seed", idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [reward] = await db.select({ id: rewardVersions.id }).from(rewardVersions).innerJoin(rewards, eq(rewards.id, rewardVersions.rewardId)).where(eq(rewards.programId, shop.programId));
    await redeem({ userId: ownerId, locationId: shop.locationId, membershipId: first.id, rewardVersionId: reward.id, idempotencyKey: randomUUID(), requestId: randomUUID() });

    const [campaign] = await db.insert(campaigns).values({ tenantId: shop.tenantId, programId: shop.programId, createdByUserId: ownerId, title: "Synthetic note", subject: "Local test", body: "Synthetic test body", audienceDefinition: { kind: "new", withinDays: 30 } }).returning();
    const [recipientA, recipientB] = await db.insert(campaignRecipients).values([
      { tenantId: shop.tenantId, campaignId: campaign.id, membershipId: first.id, status: "complete" },
      { tenantId: shop.tenantId, campaignId: campaign.id, membershipId: second.id, status: "failed" },
    ]).returning();
    const [jobA, jobB] = await db.insert(outboxJobs).values([
      { tenantId: shop.tenantId, kind: "email.campaign", payload: {} },
      { tenantId: shop.tenantId, kind: "email.campaign", payload: {} },
    ]).returning();
    await db.insert(campaignAttempts).values([
      { tenantId: shop.tenantId, recipientId: recipientA.id, outboxJobId: jobA.id, attempt: 1, status: "complete" },
      { tenantId: shop.tenantId, recipientId: recipientB.id, outboxJobId: jobB.id, attempt: 1, status: "failed" },
    ]);
    const report = await getMerchantAnalytics(ownerId, { windowDays: 30, asOf: new Date(Date.now() + 1000) });
    expect(report).toMatchObject({
      currentActiveCards: 2, newCards: 2, qualifyingCheckouts: 3, participatingCards: 2, repeatCards: 1,
      issued: { stampUnits: 8, pointUnits: 0, awardActions: 3 },
      rewards: { redemptions: 1 },
      campaignAttempts: { total: 2, complete: 1, failed: 1, suppressed: 0 },
    });
    expect(report.rewards.topTitles).toContainEqual({ title: "Kaffee", count: 1 });
    expect(report.series.reduce((sum, bucket) => sum + bucket.newCards, 0)).toBe(2);
    expect(report.series.reduce((sum, bucket) => sum + bucket.checkouts, 0)).toBe(3);
    expect(JSON.stringify(report)).not.toContain(first.cardToken);
    expect(JSON.stringify(report)).not.toContain(first.scanCode);
  });

  it("applies the selected rolling window and tenant scope and denies non-owners or revoked owners", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const manager = await user();
    const cashier = await user();
    const a = await merchant(ownerA, "Synthetic Analytics B");
    await merchant(ownerB, "Synthetic Analytics C");
    const old = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const asOf = new Date(Date.now() + 1000);
    const oldAt = new Date(asOf.getTime() - 45 * 86_400_000);
    await db.update(memberships).set({ createdAt: oldAt, balance: 2 }).where(eq(memberships.id, old.id));
    const repeatedRequestId = randomUUID();
    await db.insert(ledgerEntries).values([
      { tenantId: a.tenantId, locationId: a.locationId, membershipId: old.id, actorUserId: ownerA, requestId: repeatedRequestId, idempotencyKey: randomUUID(), kind: "award", source: "staff_online", delta: 1, createdAt: oldAt },
      { tenantId: a.tenantId, locationId: a.locationId, membershipId: old.id, actorUserId: ownerA, requestId: repeatedRequestId, idempotencyKey: randomUUID(), kind: "award", source: "staff_online", delta: 1, createdAt: new Date(oldAt.getTime() + 9 * 86_400_000) },
    ]);
    await db.insert(staffRoles).values([
      { tenantId: a.tenantId, userId: manager, role: "manager", locationId: a.locationId },
      { tenantId: a.tenantId, userId: cashier, role: "cashier", locationId: a.locationId },
    ]);

    expect(await getMerchantAnalytics(ownerA, { windowDays: 30, asOf })).toMatchObject({ currentActiveCards: 1, newCards: 0, qualifyingCheckouts: 0 });
    const wide = await getMerchantAnalytics(ownerA, { windowDays: 90, asOf });
    expect(wide).toMatchObject({ currentActiveCards: 1, newCards: 1, qualifyingCheckouts: 1, participatingCards: 1, repeatCards: 0, issued: { stampUnits: 2, awardActions: 2 } });
    expect(wide.series.reduce((sum, bucket) => sum + bucket.checkouts, 0)).toBe(1);
    expect(await getMerchantAnalytics(ownerB, { windowDays: 90, asOf })).toMatchObject({ currentActiveCards: 0, newCards: 0, qualifyingCheckouts: 0 });
    await expect(getMerchantAnalytics(manager, { windowDays: 90, asOf })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getMerchantAnalytics(cashier, { windowDays: 90, asOf })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(staffRoles).set({ active: false }).where(and(eq(staffRoles.userId, ownerA), eq(staffRoles.tenantId, a.tenantId)));
    await expect(getMerchantAnalytics(ownerA, { windowDays: 90, asOf })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports ledger-backed staff activity including departed actors without foreign, reversed, seed or out-of-window awards", async () => {
    const owner = await user();
    const formerCashier = await user();
    const foreignOwner = await user();
    const a = await merchant(owner, "Synthetic Staff Report");
    const b = await merchant(foreignOwner, "Synthetic Foreign Report");
    const member = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const foreignCard = await enroll({ slug: b.programSlug, acceptedTerms: true });
    await db.insert(staffRoles).values({ tenantId: a.tenantId, userId: formerCashier, role: "cashier", locationId: a.locationId, active: false });
    const asOf = new Date(Date.now() + 1000);
    const at = new Date(asOf.getTime() - 86_400_000);
    const base = { tenantId: a.tenantId, locationId: a.locationId, membershipId: member.id, createdAt: at };
    const insert = (actorUserId: string, extra: Partial<typeof ledgerEntries.$inferInsert> = {}) => db.insert(ledgerEntries).values({ ...base, actorUserId, requestId: randomUUID(), idempotencyKey: randomUUID(), kind: "award", source: "staff_online", delta: 1, ...extra }).returning();
    const sharedRequest = randomUUID();
    await insert(owner, { requestId: sharedRequest });
    await insert(owner, { requestId: sharedRequest });
    await insert(formerCashier, { source: "staff_offline", delta: 3 });
    const [reversed] = await insert(formerCashier);
    await insert(owner, { kind: "reversal", source: "staff_correction", delta: -1, reversalOfId: reversed.id });
    await insert(formerCashier, { source: "synthetic_seed", delta: 10 });
    await insert(formerCashier, { createdAt: new Date(asOf.getTime() - 31 * 86_400_000) });
    await insert(foreignOwner, { tenantId: b.tenantId, locationId: b.locationId, membershipId: foreignCard.id });
    const report = await getMerchantAnalytics(owner, { windowDays: 30, asOf });
    expect(report.staffActivity).toEqual(expect.arrayContaining([
      { userId: owner, name: expect.any(String), awardActions: 2, stampUnits: 2, pointUnits: 0 },
      { userId: formerCashier, name: expect.any(String), awardActions: 1, stampUnits: 3, pointUnits: 0 },
    ]));
    expect(report.staffActivity).toHaveLength(2);
    expect(report.staffActivity.reduce((sum, row) => sum + row.awardActions, 0)).toBe(report.issued.awardActions);
    expect(report.staffActivity.map(row => row.userId)).not.toContain(foreignOwner);
    await expect(getMerchantAnalytics(formerCashier, { windowDays: 30, asOf })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([30, 90] as const)("reports persisted transaction locations and exact UTC boundaries for %i days", async windowDays => {
    const owner = await user();
    const reassignedCashier = await user();
    const foreignOwner = await user();
    const a = await merchant(owner, "Synthetic Location Report");
    const b = await merchant(foreignOwner, "Synthetic Foreign Location");
    const second = await createAdditionalLocation(owner, { name: "Points counter", city: "Kassel", country: "DE", timezone: "Europe/Berlin", programName: "Points card", programType: "points", earningMode: "manual", rulesText: "Manual points.", rewardTitle: "Test reward", rewardCost: 20 });
    const [empty] = await db.insert(locations).values({ tenantId: a.tenantId, name: "Empty counter", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
    const stampCard = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const pointCard = await enroll({ slug: second.programSlug, acceptedTerms: true });
    const foreignCard = await enroll({ slug: b.programSlug, acceptedTerms: true });
    await db.insert(staffRoles).values({ tenantId: a.tenantId, userId: reassignedCashier, role: "cashier", locationId: second.locationId, active: false });
    const asOf = new Date("2030-01-31T00:00:00.000Z");
    const from = new Date(asOf.getTime() - windowDays * 86_400_000);
    const base = { tenantId: a.tenantId, locationId: a.locationId, membershipId: stampCard.id, actorUserId: owner, createdAt: from };
    const insert = (extra: Partial<typeof ledgerEntries.$inferInsert> = {}) => db.insert(ledgerEntries).values({ ...base, requestId: randomUUID(), idempotencyKey: randomUUID(), kind: "award", source: "staff_online", delta: 1, ...extra }).returning();
    const shared = randomUUID();
    await insert({ requestId: shared });
    await insert({ requestId: shared });
    await insert({ actorUserId: reassignedCashier, source: "staff_offline", delta: 3 });
    const point = { locationId: second.locationId, membershipId: pointCard.id };
    await insert({ ...point, delta: 5 });
    await insert({ ...point, delta: 7, createdAt: new Date(asOf.getTime() - 1) });
    const [reversed] = await insert({ ...point, delta: 4 });
    await insert({ ...point, kind: "reversal", source: "staff_correction", delta: -4, reversalOfId: reversed.id, createdAt: new Date(asOf.getTime() - 1) });
    await insert({ source: "synthetic_seed", delta: 100 });
    await insert({ createdAt: new Date(from.getTime() - 1) });
    await insert({ createdAt: asOf });
    await insert({ tenantId: b.tenantId, locationId: b.locationId, membershipId: foreignCard.id, actorUserId: foreignOwner, delta: 9 });
    await db.update(locations).set({ name: "Renamed stamp counter" }).where(eq(locations.id, a.locationId));
    await db.update(programs).set({ status: "archived" }).where(eq(programs.id, a.programId));
    const report = await getMerchantAnalytics(owner, { windowDays, asOf });
    expect(report.locationActivity).toEqual(expect.arrayContaining([
      { locationId: a.locationId, name: "Renamed stamp counter", awardActions: 3, stampUnits: 5, pointUnits: 0 },
      { locationId: second.locationId, name: "Points counter", awardActions: 2, stampUnits: 0, pointUnits: 12 },
      { locationId: empty.id, name: "Empty counter", awardActions: 0, stampUnits: 0, pointUnits: 0 },
    ]));
    expect(report.locationActivity).toHaveLength(3);
    expect(report.issued).toEqual({ awardActions: 5, stampUnits: 5, pointUnits: 12 });
    for (const key of ["awardActions", "stampUnits", "pointUnits"] as const) expect(report.locationActivity.reduce((sum, row) => sum + row[key], 0)).toBe(report.issued[key]);
    expect(report.staffActivity.find(row => row.userId === reassignedCashier)).toMatchObject({ awardActions: 1, stampUnits: 3, pointUnits: 0 });
    expect(report.qualifyingCheckouts).toBe(4);
    expect((await getMerchantAnalytics(foreignOwner, { windowDays, asOf })).locationActivity.map(row => row.locationId)).toEqual([b.locationId]);
  });

  it("keeps points separate from stamps for recorded purchase awards", async () => {
    const ownerId = await user();
    const shop = await createMerchant({
      userId: ownerId, businessName: "Synthetic Points Shop", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Synthetic points card", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 2,
      rulesText: "Two points per euro in the synthetic purchase flow.", rewardTitle: "Synthetic reward", rewardCost: 10,
    });
    const card = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    const [rule] = await db.select({ id: programRuleVersions.id }).from(programRuleVersions).where(eq(programRuleVersions.programId, shop.programId));
    await award({ userId: ownerId, locationId: shop.locationId, membershipId: card.id, purchaseAmountMinor: 1250, ruleVersionId: rule.id, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const report = await getMerchantAnalytics(ownerId, { windowDays: 30, asOf: new Date(Date.now() + 1000) });
    expect(report).toMatchObject({ qualifyingCheckouts: 1, issued: { stampUnits: 0, pointUnits: 25, awardActions: 1 } });
    expect(report.staffActivity).toEqual([{ userId: ownerId, name: expect.any(String), awardActions: 1, stampUnits: 0, pointUnits: 25 }]);
  });

  it("counts referral attribution, qualification and reversal by their own event times without mixing tenants", async () => {
    const originalOrigin = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";
    try {
      const ownerA = await user();
      const ownerB = await user();
      const a = await merchant(ownerA, "Synthetic Referral Analytics A");
      await merchant(ownerB, "Synthetic Referral Analytics B");
      const referrer = await enroll({ slug: a.programSlug, acceptedTerms: true });
      await configureReferrals({ actorUserId: ownerA, programSlug: a.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
      const code = new URL((await getCardReferralShare(referrer.cardToken)).shareUrl).searchParams.get("ref")!;
      const referred = await enroll({ slug: a.programSlug, acceptedTerms: true, referralCode: code });
      const report = () => getMerchantAnalytics(ownerA, { windowDays: 30, asOf: new Date(Date.now() + 1000) });
      expect((await report()).referrals).toEqual({ attributed: 1, qualified: 0, reversed: 0 });
      const awardEntry = await award({ userId: ownerA, locationId: a.locationId, membershipId: referred.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
      expect((await report()).referrals).toEqual({ attributed: 1, qualified: 1, reversed: 0 });
      await reverseEntry({ userId: ownerA, locationId: a.locationId, entryId: awardEntry.entryId, reason: "Synthetic correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
      expect((await report()).referrals).toEqual({ attributed: 1, qualified: 1, reversed: 1 });
      expect((await getMerchantAnalytics(ownerB, { windowDays: 30, asOf: new Date(Date.now() + 1000) })).referrals).toEqual({ attributed: 0, qualified: 0, reversed: 0 });
      const past = new Date(Date.now() - 45 * 86_400_000);
      await db.update(referrals).set({ createdAt: past }).where(eq(referrals.tenantId, a.tenantId));
      expect((await report()).referrals).toEqual({ attributed: 0, qualified: 1, reversed: 1 });
      expect((await getMerchantAnalytics(ownerA, { windowDays: 90, asOf: new Date(Date.now() + 1000) })).referrals).toEqual({ attributed: 1, qualified: 1, reversed: 1 });
    } finally {
      if (originalOrigin === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = originalOrigin;
    }
  });
});
