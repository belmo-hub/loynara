import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { consentEvents, ledgerEntries, locations, membershipContacts, programRuleVersions, rewardVersions, staffRoles, subscriptions } from "@/db/schema";
import { archiveReward, createMerchant, createReward, editReward, enroll, getCard, getMerchantContext, getMerchantRewards, getPublicProgram, lookupCard, reorderRewards, updateProgram } from "./product";
import { award } from "./loyalty";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function createUser() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic owner", `${id}@example.test`]);
  return id;
}

describe("merchant and customer journey", () => {
  it("persists a merchant, its first location, program, and owner assignment", async () => {
    const userId = await createUser();
    const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
    expect(merchant).toMatchObject({ city: "Kassel", programType: "stamp" });
    const roles = await db.select().from(staffRoles).where(eq(staffRoles.userId, userId));
    expect(roles).toMatchObject([{ tenantId: merchant.tenantId, role: "owner", active: true, locationId: null, userId, createdAt: expect.any(Date) }]);
    const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, merchant.tenantId));
    expect(subscription).toMatchObject({ status: "manual_pending", currency: "EUR", priceMinor: 4900 });
  });

  it("stores the configured draft EUR price shown on the homepage", async () => {
    const previous = process.env.NEXT_PUBLIC_DRAFT_EUR_PRICE_MINOR;
    process.env.NEXT_PUBLIC_DRAFT_EUR_PRICE_MINOR = "5900";
    try {
      const userId = await createUser();
      const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
      const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, merchant.tenantId));
      expect(subscription.priceMinor).toBe(5900);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_DRAFT_EUR_PRICE_MINOR;
      else process.env.NEXT_PUBLIC_DRAFT_EUR_PRICE_MINOR = previous;
    }
  });

  it("allows only one concurrent merchant onboarding for an account", async () => {
    const userId = await createUser();
    const input = { userId, businessName: "Synthetic Café", city: "Kassel", country: "DE" as const, timezone: "Europe/Berlin", locale: "de" as const, currency: "EUR" as const, programName: "Kaffeekarte", programType: "stamp" as const, rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 };
    const outcomes = await Promise.allSettled([createMerchant(input), createMerchant(input)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toMatchObject([{ reason: { code: "ALREADY_ONBOARDED" } }]);
    expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, userId))).toHaveLength(1);
  });

  it("enrolls without an email and exposes a contact-free browser card", async () => {
    const userId = await createUser();
    const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
    const membership = await enroll({ slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false });
    const card = await getCard(membership.cardToken);
    expect(card).toMatchObject({ scanCode: membership.scanCode, balance: 0, merchantName: "Synthetic Café", programType: "stamp" });
    expect(JSON.stringify(card)).not.toContain("email");
    expect(membership.scanCode).not.toContain(membership.cardToken);
    expect(await db.select().from(membershipContacts).where(eq(membershipContacts.membershipId, membership.id))).toHaveLength(0);
    expect(await db.select().from(consentEvents).where(eq(consentEvents.membershipId, membership.id))).toHaveLength(0);
  });

  it("records separately chosen marketing consent without showing email at checkout", async () => {
    const userId = await createUser();
    const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
    const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: "kunde@example.test", marketingOptIn: true });
    const [contact] = await db.select().from(membershipContacts).where(eq(membershipContacts.membershipId, member.id));
    expect(contact.email).toBe("kunde@example.test");
    expect(await db.select().from(consentEvents).where(eq(consentEvents.membershipId, member.id))).toMatchObject([{ channel: "email", purpose: "marketing", granted: true }]);
    const checkout = await lookupCard({ userId, locationId: merchant.locationId, scanCode: member.scanCode });
    expect(checkout).toMatchObject({ membershipId: member.id, balance: 0 });
    expect(JSON.stringify(checkout)).not.toContain("kunde@example.test");
  });

  it("stores validated branding and hides owner reports from a cashier", async () => {
    const ownerId = await createUser();
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8, brandColor: "#32634d", contactEmail: "owner@example.test" });
    const [location] = await db.select().from(locations).where(eq(locations.id, merchant.locationId));
    expect(location).toMatchObject({ name: "Kassel Mitte", brandColor: "#32634d", contactEmail: "owner@example.test" });
    const cashierId = await createUser();
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, userId: cashierId, role: "cashier", locationId: merchant.locationId });
    const cashier = await getMerchantContext(cashierId);
    expect(cashier).toMatchObject({ role: "cashier", locationId: merchant.locationId });
    expect(cashier?.stats).toBeUndefined();
    expect(cashier?.activity).toBeUndefined();
    const owner = await getMerchantContext(ownerId);
    expect(owner?.stats).toMatchObject({ members: 0, awards: 0, redemptions: 0 });
  });

  it("versions reward changes and locks program units after the first transaction", async () => {
    const ownerId = await createUser();
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
    const updated = await updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, name: "Kaffeekarte", rulesText: "Ein Stempel pro Kaffee, maximal einmal je Kauf.", programType: "points" });
    expect(updated.programType).toBe("points");
    const [reward] = await getMerchantRewards({ actorUserId: ownerId, programSlug: merchant.programSlug });
    await editReward({ actorUserId: ownerId, programSlug: merchant.programSlug, rewardId: reward.rewardId, title: "Cappuccino gratis", cost: 9, termsText: "" });
    const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await award({ userId: ownerId, locationId: merchant.locationId, membershipId: member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await expect(updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, name: "Kaffeekarte", rulesText: "Ein Stempel pro Kaffee, maximal einmal je Kauf.", programType: "stamp" })).rejects.toMatchObject({ code: "TYPE_LOCKED" });
    expect(await db.select().from(rewardVersions)).toHaveLength(2);
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("stores purchase earning mode and versions rate changes without rewriting the old rule", async () => {
    const ownerId = await createUser();
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3, rulesText: "Drei Punkte je vollem Euro Kaufbetrag.", rewardTitle: "Kaffee gratis", rewardCost: 30 });
    const first = await getPublicProgram(merchant.programSlug);
    expect(first).toMatchObject({ earningMode: "purchase", pointsPerCurrencyUnit: 3, currency: "EUR", rewards: [{ title: "Kaffee gratis", cost: 30 }] });
    const changed = await updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, name: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 4, rulesText: "Vier Punkte je vollem Euro Kaufbetrag." });
    expect(changed.ruleVersion).toBe(2);
    const versions = await db.select().from(programRuleVersions);
    expect(versions.map(row => [row.version, row.pointsPerCurrencyUnit, row.rulesText])).toEqual([
      [1, 3, "Drei Punkte je vollem Euro Kaufbetrag."],
      [2, 4, "Vier Punkte je vollem Euro Kaufbetrag."],
    ]);
  });

  it("lets only the owner create, version, order, and archive rewards while retaining one active option", async () => {
    const ownerId = await createUser();
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kauf.", rewardTitle: "Kaffee", rewardCost: 8 });
    const cashierId = await createUser();
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, userId: cashierId, role: "cashier", locationId: merchant.locationId });
    await expect(createReward({ actorUserId: cashierId, programSlug: merchant.programSlug, title: "Kuchen", cost: 12, termsText: "Ein Stück" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const created = await createReward({ actorUserId: ownerId, programSlug: merchant.programSlug, title: "Kuchen", cost: 12, termsText: "Ein Stück" });
    const initial = await getMerchantRewards({ actorUserId: ownerId, programSlug: merchant.programSlug });
    expect(initial).toHaveLength(2);
    await editReward({ actorUserId: ownerId, programSlug: merchant.programSlug, rewardId: created.rewardId, title: "Torte", cost: 15, termsText: "Ein Stück Torte" });
    expect((await db.select().from(rewardVersions)).filter(row => row.rewardId === created.rewardId).map(row => row.version)).toEqual([1, 2]);
    await reorderRewards({ actorUserId: ownerId, programSlug: merchant.programSlug, rewardIds: [created.rewardId, initial[0].rewardId] });
    expect((await getPublicProgram(merchant.programSlug)).rewards.map(row => row.title)).toEqual(["Torte", "Kaffee"]);
    await updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, name: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Besuch." });
    expect(await db.select().from(rewardVersions)).toHaveLength(3);
    await archiveReward({ actorUserId: ownerId, programSlug: merchant.programSlug, rewardId: created.rewardId });
    expect((await getPublicProgram(merchant.programSlug)).rewards.map(row => row.title)).toEqual(["Kaffee"]);
    await expect(archiveReward({ actorUserId: ownerId, programSlug: merchant.programSlug, rewardId: initial[0].rewardId })).rejects.toMatchObject({ code: "LAST_ACTIVE_REWARD" });
    expect((await getMerchantRewards({ actorUserId: ownerId, programSlug: merchant.programSlug })).map(row => row.active)).toEqual([false, true]);
  });
});
