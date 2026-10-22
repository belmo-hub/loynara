import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, programRuleVersions, programs, purchaseAwards, staffRoles } from "@/db/schema";
import { award, reverseEntry } from "./loyalty";
import { createMerchant, enroll, getMerchantContext, updateProgramExtras } from "./product";
import { getMerchantSpend } from "./merchant-analytics";
import { createAdditionalLocation } from "./locations";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Spend tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic spend tester", `${id}@example.test`]);
  return id;
}

const shopInput = (userId: string, name: string) => ({ userId, businessName: name, city: "Kassel", country: "DE" as const, timezone: "Europe/Berlin", locale: "de" as const, currency: "EUR" as const, rewardTitle: "Kaffee" });
const stampShop = (userId: string, name: string) => createMerchant({ ...shopInput(userId, name), programName: `${name} Karte`, programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardCost: 5 });
const pointsShop = (userId: string, name: string) => createMerchant({ ...shopInput(userId, name), programName: `${name} Punkte`, programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Ein Punkt pro Euro.", rewardCost: 100 });
const ruleOf = async (programId: string) => (await db.select({ id: programRuleVersions.id }).from(programRuleVersions).where(eq(programRuleVersions.programId, programId)))[0].id;
const later = () => new Date(Date.now() + 1000);

describe("owner spend figures (ENG-070)", () => {
  it("sums confirmed purchase amounts, drops corrected entries, keeps the rest of a partly corrected request and never counts bonuses", async () => {
    const owner = await user();
    const shop = await pointsShop(owner, "Synthetic Spend Points");
    await db.update(programs).set({ welcomeBonus: 20 }).where(eq(programs.id, shop.programId));
    const rule = await ruleOf(shop.programId);
    const first = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    const second = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    const buy = (membershipId: string, purchaseAmountMinor: number, source?: "staff_offline") =>
      award({ userId: owner, locationId: shop.locationId, membershipId, purchaseAmountMinor, ruleVersionId: rule, idempotencyKey: randomUUID(), requestId: randomUUID(), source, deviceAt: source ? new Date() : undefined });
    await buy(first.id, 1250); // books the welcome bonus too: bonus points are not spend
    const wrong = await buy(first.id, 2000);
    await reverseEntry({ userId: owner, locationId: shop.locationId, entryId: wrong.entryId, reason: "Synthetic wrong amount", idempotencyKey: randomUUID(), requestId: randomUUID() });
    await buy(first.id, 200); // the rebooked, corrected amount
    await buy(second.id, 800, "staff_offline");
    // One request with two purchase entries, one of them corrected: the request still counts, with the remaining amount.
    const requestId = randomUUID();
    const [kept, undone] = await db.insert(ledgerEntries).values([30, 15].map(delta => ({ tenantId: shop.tenantId, locationId: shop.locationId, membershipId: second.id, actorUserId: owner, requestId, idempotencyKey: randomUUID(), kind: "award", source: "staff_online", delta }))).returning();
    await db.insert(purchaseAwards).values([kept, undone].map(entry => ({ ledgerEntryId: entry.id, tenantId: shop.tenantId, ruleVersionId: rule, amountMinor: entry.delta * 100, currency: "EUR", appliedRate: 1, pointsAwarded: entry.delta })));
    await db.insert(ledgerEntries).values({ tenantId: shop.tenantId, locationId: shop.locationId, membershipId: second.id, actorUserId: owner, requestId: randomUUID(), idempotencyKey: randomUUID(), kind: "reversal", source: "staff_correction", delta: -undone.delta, reversalOfId: undone.id, reason: "Synthetic partial correction" });
    // Bonus and seed sources never count, even with an amount attached.
    for (const source of ["happy_hour", "winback_bonus", "birthday_bonus", "challenge_bonus", "welcome_bonus", "synthetic_seed", "referral_bonus"] as const) {
      const [bonus] = await db.insert(ledgerEntries).values({ tenantId: shop.tenantId, locationId: shop.locationId, membershipId: second.id, actorUserId: owner, requestId: randomUUID(), idempotencyKey: randomUUID(), kind: "award", source, delta: 7 }).returning();
      await db.insert(purchaseAwards).values({ ledgerEntryId: bonus.id, tenantId: shop.tenantId, ruleVersionId: rule, amountMinor: 99_999, currency: "EUR", appliedRate: 1, pointsAwarded: 7 });
    }

    const spend = await getMerchantSpend(owner, { asOf: later() });
    const real = 1250 + 200 + 800 + 3000;
    expect(spend.currency).toBe("EUR");
    for (const figures of [spend.overall.recent, spend.overall.total, spend.locations[0].recent]) {
      expect(figures).toMatchObject({ visits: 4, realMinor: real, estimatedMinor: 0, spentMinor: real, unpricedVisits: 0, averagePerVisitMinor: 1313 }); // 5250 / 4 = 1312.5, half up
    }
    expect(spend.overall.recent).toMatchObject({ newCardMinor: real, returningCardMinor: 0 });
    expect(spend.overall.total).toMatchObject({ newCardMinor: null, returningCardMinor: null });

    // Deliberate-break guard: without the correction subtraction the same rows would sum to this, so the figure above is
    // sensitive to it (dropping the NOT EXISTS reversal filter in getMerchantSpend turns this test red).
    const naive = (await pool.query<{ sum: string }>(`SELECT sum(pa.amount_minor)::text AS sum FROM purchase_awards pa JOIN ledger_entries e ON e.id = pa.ledger_entry_id WHERE e.tenant_id = $1 AND e.source IN ('staff_online','staff_offline')`, [shop.tenantId])).rows[0].sum;
    expect(Number(naive)).toBe(real + 2000 + 1500);
  });

  it("estimates stamp visits with the owner's average, labels nothing without one, and the owner edits it in the extras", async () => {
    const owner = await user();
    const shop = await stampShop(owner, "Synthetic Spend Stamps");
    await db.update(programs).set({ welcomeBonus: 1 }).where(eq(programs.id, shop.programId));
    const card = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    const visit = () => award({ userId: owner, locationId: shop.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await visit();
    await visit();
    const undone = await visit();
    await reverseEntry({ userId: owner, locationId: shop.locationId, entryId: undone.entryId, reason: "Synthetic stamp mistake", idempotencyKey: randomUUID(), requestId: randomUUID() });

    expect((await getMerchantSpend(owner, { asOf: later() })).overall.recent).toMatchObject({ visits: 2, spentMinor: 0, realMinor: 0, estimatedMinor: 0, unpricedVisits: 2, averagePerVisitMinor: null, newCardMinor: 0 });

    const saved = await updateProgramExtras({ actorUserId: owner, programId: shop.programId, averageVisitSpendMinor: 1250 });
    expect(saved.averageVisitSpendMinor).toBe(1250);
    expect((await getMerchantSpend(owner, { asOf: later() })).overall.total).toMatchObject({ visits: 2, spentMinor: 2500, realMinor: 0, estimatedMinor: 2500, unpricedVisits: 0, averagePerVisitMinor: 1250 });

    await expect(updateProgramExtras({ actorUserId: owner, programId: shop.programId, averageVisitSpendMinor: 100_001 })).rejects.toThrow();
    await expect(updateProgramExtras({ actorUserId: owner, programId: shop.programId, averageVisitSpendMinor: 0 })).rejects.toThrow();
    await expect(pool.query("UPDATE programs SET average_visit_spend_minor = 100001 WHERE id = $1", [shop.programId])).rejects.toThrow(/program_average_visit_spend_valid/);
    await updateProgramExtras({ actorUserId: owner, programId: shop.programId, welcomeBonus: 1 }); // other saves keep the average
    expect((await db.select({ v: programs.averageVisitSpendMinor }).from(programs).where(eq(programs.id, shop.programId)))[0].v).toBe(1250);
    await updateProgramExtras({ actorUserId: owner, programId: shop.programId, averageVisitSpendMinor: null });
    expect((await getMerchantSpend(owner, { asOf: later() })).overall.total).toMatchObject({ visits: 2, spentMinor: 0, unpricedVisits: 2 });
  });

  it("lets a manual-points shop (no purchase amounts) enter an average and estimates its visits like stamps", async () => {
    const owner = await user();
    const shop = await createMerchant({ ...shopInput(owner, "Synthetic Spend Manual"), programName: "Punkte von Hand", programType: "points", earningMode: "manual", rulesText: "Punkte nach Ansage.", rewardCost: 100 });
    expect(await getMerchantContext(owner)).toMatchObject({ programType: "points", earningMode: "manual", averageVisitSpendMinor: null });
    const card = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    await award({ userId: owner, locationId: shop.locationId, membershipId: card.id, quantity: 10, idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect((await getMerchantSpend(owner, { asOf: later() })).overall.total).toMatchObject({ visits: 1, spentMinor: 0, unpricedVisits: 1 });
    await updateProgramExtras({ actorUserId: owner, programId: shop.programId, averageVisitSpendMinor: 2390 });
    expect(await getMerchantContext(owner)).toMatchObject({ earningMode: "manual", averageVisitSpendMinor: 2390 });
    expect((await getMerchantSpend(owner, { asOf: later() })).overall.total).toMatchObject({ visits: 1, realMinor: 0, estimatedMinor: 2390, spentMinor: 2390, unpricedVisits: 0, averagePerVisitMinor: 2390 });
  });

  it("uses today and the 29 local days before, across the 25 October DST change", async () => {
    const owner = await user();
    const shop = await stampShop(owner, "Synthetic Spend DST");
    await db.update(programs).set({ averageVisitSpendMinor: 100 }).where(eq(programs.id, shop.programId));
    const card = await enroll({ slug: shop.programSlug, acceptedTerms: true });
    await db.update(memberships).set({ createdAt: new Date("2026-09-01T10:00:00Z") }).where(eq(memberships.id, card.id));
    const at = (iso: string) => db.insert(ledgerEntries).values({ tenantId: shop.tenantId, locationId: shop.locationId, membershipId: card.id, actorUserId: owner, requestId: randomUUID(), idempotencyKey: randomUUID(), kind: "award", source: "staff_online", delta: 1, createdAt: new Date(iso) });
    // 24 Oct is still summer time (UTC+2): local midnight of 25 Oct is 24 Oct 22:00 UTC.
    await at("2026-10-24T21:59:59.999Z");
    await at("2026-10-24T22:00:00.000Z");
    // 21 Oct 22:00 UTC is local midnight of 22 Oct (summer time).
    await at("2026-10-21T21:59:59.999Z");
    await at("2026-10-21T22:00:00.000Z");

    // 23 Nov 12:00 local (winter time, UTC+1) → window from 25 Oct 00:00 local.
    const late = await getMerchantSpend(owner, { asOf: new Date("2026-11-23T11:00:00Z") });
    expect(late.locations[0].recentFrom).toBe("2026-10-24T22:00:00.000Z");
    expect(late.overall.recent).toMatchObject({ visits: 1, spentMinor: 100, newCardMinor: 0, returningCardMinor: 100 });
    expect(late.overall.total.visits).toBe(4);
    // 20 Nov 12:00 local → from 22 Oct 00:00 local, which a fixed 30 × 24 h window (21 Oct 11:00 UTC) would miss.
    const early = await getMerchantSpend(owner, { asOf: new Date("2026-11-20T11:00:00Z") });
    expect(early.locations[0].recentFrom).toBe("2026-10-21T22:00:00.000Z");
    expect(early.overall.recent.visits).toBe(3);
    // The report time is exclusive: a visit at that instant is not yet in.
    expect((await getMerchantSpend(owner, { asOf: new Date("2026-10-24T22:00:00.000Z") })).overall.total.visits).toBe(3);
  });

  it("is owner-only, tenant-scoped, split per location and empty for a shop without visits", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const manager = await user();
    const cashier = await user();
    const a = await pointsShop(ownerA, "Synthetic Spend A");
    const b = await pointsShop(ownerB, "Synthetic Spend B");
    const ownerC = await user();
    const c = await pointsShop(ownerC, "Synthetic Spend C");
    const second = await createAdditionalLocation(ownerA, { name: "Zweiter Laden", city: "Kassel", country: "DE", timezone: "Europe/Berlin", programName: "Zweite Karte", programType: "stamp", rulesText: "Ein Stempel pro Besuch.", rewardTitle: "Kaffee", rewardCost: 5 });
    await db.update(programs).set({ averageVisitSpendMinor: 900 }).where(eq(programs.id, second.programId));
    const cardA = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const cardA2 = await enroll({ slug: second.programSlug, acceptedTerms: true });
    const cardC = await enroll({ slug: c.programSlug, acceptedTerms: true });
    await award({ userId: ownerA, locationId: a.locationId, membershipId: cardA.id, purchaseAmountMinor: 1000, ruleVersionId: await ruleOf(a.programId), idempotencyKey: randomUUID(), requestId: randomUUID() });
    await award({ userId: ownerA, locationId: second.locationId, membershipId: cardA2.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await award({ userId: ownerC, locationId: c.locationId, membershipId: cardC.id, purchaseAmountMinor: 777_700, ruleVersionId: await ruleOf(c.programId), idempotencyKey: randomUUID(), requestId: randomUUID() });

    const spendA = await getMerchantSpend(ownerA, { asOf: later() });
    expect(spendA.overall.total).toMatchObject({ visits: 2, realMinor: 1000, estimatedMinor: 900, spentMinor: 1900, averagePerVisitMinor: 950 });
    expect(spendA.locations.map(row => [row.locationId, row.total.spentMinor]).sort()).toEqual([[a.locationId, 1000], [second.locationId, 900]].sort());
    expect(JSON.stringify(spendA)).not.toContain(c.locationId);
    expect(JSON.stringify(spendA)).not.toContain("777700");

    const empty = await getMerchantSpend(ownerB, { asOf: later() });
    expect(empty.overall.total).toEqual({ visits: 0, spentMinor: 0, realMinor: 0, estimatedMinor: 0, unpricedVisits: 0, averagePerVisitMinor: null, newCardMinor: null, returningCardMinor: null });
    expect(empty.overall.recent).toMatchObject({ visits: 0, spentMinor: 0, newCardMinor: 0, returningCardMinor: 0 });
    expect(empty.locations.map(row => row.locationId)).toEqual([b.locationId]);

    await db.insert(staffRoles).values([
      { tenantId: a.tenantId, userId: manager, role: "manager", locationId: a.locationId },
      { tenantId: a.tenantId, userId: cashier, role: "cashier", locationId: a.locationId },
    ]);
    await expect(getMerchantSpend(manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getMerchantSpend(cashier)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getMerchantSpend(await user())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(staffRoles).set({ active: false }).where(and(eq(staffRoles.userId, ownerA), eq(staffRoles.tenantId, a.tenantId)));
    await expect(getMerchantSpend(ownerA)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
