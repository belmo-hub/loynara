import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, staffRoles, programs, locations } from "@/db/schema";
import { listMerchantMembers } from "./merchant-members";
import { createMerchant, enroll } from "./product";
import { getRetentionSummary } from "./retention";
import { createAdditionalLocation } from "./locations";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Retention tests require looplocal_test");

const DAY = 86_400_000;
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic retention tester", id + "@example.test"]);
  return id;
}
async function shop(ownerId: string, name: string) {
  return createMerchant({ userId: ownerId, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: name + " card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
}
type Shop = Awaited<ReturnType<typeof shop>>;
async function card(merchant: Shop, createdAt: Date, balance = 0) {
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  await db.update(memberships).set({ createdAt, balance }).where(eq(memberships.id, member.id));
  return member;
}
async function checkout(merchant: Shop, actorUserId: string, membershipId: string, at: Date, source: "staff_online" | "synthetic_seed" = "staff_online") {
  const [row] = await db.insert(ledgerEntries).values({ tenantId: merchant.tenantId, locationId: merchant.locationId, membershipId, actorUserId, createdAt: at,
    requestId: randomUUID(), idempotencyKey: randomUUID(), kind: "award", source, delta: 1 }).returning({ id: ledgerEntries.id });
  return row.id;
}

describe("retention summary", () => {
  it("classifies open cards by recorded checkouts only and never by seed or reversed awards", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId, "Synthetic Retention Café");
    const asOf = new Date("2030-03-01T12:00:00.000Z");
    const ago = (days: number) => new Date(asOf.getTime() - days * DAY);
    const recent = await card(merchant, ago(60), 4); // near reward: 1 of 5 missing
    await checkout(merchant, ownerId, recent.id, ago(3));
    const drifting = await card(merchant, ago(90), 1);
    await checkout(merchant, ownerId, drifting.id, ago(45));
    const driftingSinceDays = await card(merchant, ago(90), 5); // reward ready
    await checkout(merchant, ownerId, driftingSinceDays.id, ago(33));
    const seedOnly = await card(merchant, ago(20), 3);
    await checkout(merchant, ownerId, seedOnly.id, ago(10), "synthetic_seed");
    const reversedOnly = await card(merchant, ago(2));
    const reversed = await checkout(merchant, ownerId, reversedOnly.id, ago(1));
    await db.insert(ledgerEntries).values({ tenantId: merchant.tenantId, locationId: merchant.locationId, membershipId: reversedOnly.id, actorUserId: ownerId, createdAt: ago(1),
      requestId: randomUUID(), idempotencyKey: randomUUID(), kind: "reversal", source: "staff_correction", reversalOfId: reversed, delta: -1 });
    const closed = await card(merchant, ago(90));
    await checkout(merchant, ownerId, closed.id, ago(50));
    await db.update(memberships).set({ closedAt: ago(5) }).where(eq(memberships.id, closed.id));
    await card(merchant, ago(-1)); // created after asOf

    const summary = await getRetentionSummary(ownerId, { asOf, inactiveDays: 30 });
    expect(summary).toMatchObject({ openCards: 5, recent: 1, drifting: 2, never: 2, neverAfterWeek: 1, nearReward: 2, rewardReady: 1, nearRewardMaxRemaining: 2, inactiveDays: 30, locationId: null });
    // Seven days earlier: the 33-day card was still recent, the closed card was open and drifting, the 45-day one drifting.
    expect(summary.driftingWeekAgo).toBe(2);
    for (const [inactiveDays, recent, drifting] of [[14, 1, 2], [30, 1, 2], [60, 3, 0], [90, 3, 0]] as const) {
      expect(await getRetentionSummary(ownerId, { asOf, inactiveDays })).toMatchObject({ recent, drifting });
    }
  });

  it("enforces role, tenant and location scope", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId, "Synthetic Scope Café");
    const otherOwner = await user();
    const other = await shop(otherOwner, "Synthetic Other Café");
    await card(other, new Date(Date.now() - 3 * DAY));
    const managerId = await user();
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, locationId: merchant.locationId, userId: managerId, role: "manager" });
    const cashierId = await user();
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, locationId: merchant.locationId, userId: cashierId, role: "cashier" });

    await expect(getRetentionSummary(cashierId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getRetentionSummary(await user())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getRetentionSummary(ownerId, { locationId: other.locationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getRetentionSummary(managerId, { locationId: other.locationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getRetentionSummary(ownerId, { locationId: "not-a-uuid" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getRetentionSummary(ownerId, { inactiveDays: 31 as 30 })).rejects.toMatchObject({ code: "INVALID_FILTER" });
    expect(await getRetentionSummary(ownerId)).toMatchObject({ openCards: 0, drifting: 0, never: 0 });
    expect(await getRetentionSummary(managerId)).toMatchObject({ locationId: merchant.locationId, openCards: 0 });
    expect(await getRetentionSummary(otherOwner)).toMatchObject({ openCards: 1, never: 1 });
  });
});

describe("customer list retention filters", () => {
  it("lists exactly the cards of a state, follows eligibility changes and stays tenant-scoped", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId, "Synthetic Filter Café");
    const otherOwner = await user();
    const other = await shop(otherOwner, "Synthetic Foreign Café");
    const now = Date.now();
    const ago = (days: number) => new Date(now - days * DAY);
    const regular = await card(merchant, ago(40), 4);
    await checkout(merchant, ownerId, regular.id, ago(2));
    const drifting = await card(merchant, ago(80), 5);
    await checkout(merchant, ownerId, drifting.id, ago(40));
    const never = await card(merchant, ago(10));
    const foreign = await card(other, ago(80));
    await checkout(other, otherOwner, foreign.id, ago(40));

    const ids = async (activity: Parameters<typeof listMerchantMembers>[1]["activity"], inactiveDays?: 14 | 30 | 60 | 90) =>
      (await listMerchantMembers(ownerId, { activity, ...(inactiveDays ? { inactiveDays } : {}) })).members.map(member => member.id).sort();
    expect(await ids("drifting")).toEqual([drifting.id]);
    expect(await ids("recent")).toEqual([regular.id]);
    expect(await ids("never")).toEqual([never.id]);
    expect(await ids("near_reward")).toEqual([regular.id]);
    expect(await ids("reward_ready")).toEqual([drifting.id]);
    expect(await ids("drifting", 60)).toEqual([]);
    expect(await ids("recent", 60)).toEqual([drifting.id, regular.id].sort());

    // A new checkout moves the drifting card back to recent; closing a card removes it from every state.
    await checkout(merchant, ownerId, drifting.id, ago(0));
    expect(await ids("drifting")).toEqual([]);
    expect(await ids("recent")).toEqual([drifting.id, regular.id].sort());
    await db.update(memberships).set({ closedAt: new Date() }).where(eq(memberships.id, regular.id));
    expect(await ids("recent")).toEqual([drifting.id]);

    await expect(listMerchantMembers(ownerId, { activity: "bogus" as "all" })).rejects.toMatchObject({ code: "INVALID_FILTER" });
    await expect(listMerchantMembers(ownerId, { activity: "drifting", inactiveDays: 7 as 14 })).rejects.toMatchObject({ code: "INVALID_FILTER" });
    const cashierId = await user();
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, locationId: merchant.locationId, userId: cashierId, role: "cashier" });
    await expect(listMerchantMembers(cashierId, { activity: "drifting" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("retention destination reconciliation", () => {
  it("matches older unvisited insight cards and excludes inactive programs", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId, "Synthetic Age Café");
    const old = await card(merchant, new Date(Date.now() - 10 * DAY));
    await card(merchant, new Date(Date.now() - 2 * DAY));
    const list = await listMerchantMembers(ownerId, { activity: "never", minAgeDays: 7 });
    expect(list.members.map(member => member.id)).toEqual([old.id]);
    expect((await getRetentionSummary(ownerId)).neverAfterWeek).toBe(list.members.length);
    await db.update(programs).set({ status: "archived" }).where(eq(programs.id, old.programId));
    expect((await listMerchantMembers(ownerId, { activity: "never" })).members).toEqual([]);
    expect((await getRetentionSummary(ownerId)).never).toBe(0);
  });

  it("filters by location ID even when location names collide and prevents manager scope escape", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId, "Synthetic Location Café");
    const own = await card(merchant, new Date(Date.now() - 10 * DAY));
    const second = await createAdditionalLocation(ownerId, { name: "Other location", city: "Kassel", country: "DE", timezone: "Europe/Berlin", programName: "Other card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
    await card({ ...merchant, ...second }, new Date(Date.now() - 10 * DAY));
    await db.update(locations).set({ name: "Same name" }).where(eq(locations.id, second.locationId));
    await db.update(locations).set({ name: "Same name" }).where(eq(locations.id, merchant.locationId));
    const list = await listMerchantMembers(ownerId, { activity: "never", locationId: merchant.locationId });
    expect(list.members.map(member => member.id)).toEqual([own.id]);
    const managerId = await user();
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, locationId: merchant.locationId, userId: managerId, role: "manager" });
    await expect(listMerchantMembers(managerId, { activity: "never", locationId: second.locationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listMerchantMembers(ownerId, { activity: "never", locationId: "not-a-uuid" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listMerchantMembers(managerId, { activity: "never", locationId: null })).members.map(member => member.id)).toEqual([own.id]);
    const foreignOwner = await user();
    const foreign = await shop(foreignOwner, "Synthetic Foreign Scope Café");
    await expect(listMerchantMembers(ownerId, { activity: "never", locationId: foreign.locationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listMerchantMembers(ownerId, { activity: "never", minAgeDays: 8 as 7 })).rejects.toMatchObject({ code: "INVALID_FILTER" });
  });
});
