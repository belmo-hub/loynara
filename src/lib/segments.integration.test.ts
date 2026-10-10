import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { billingLocationPlans, ledgerEntries, locations, membershipContacts, memberships, programs, rewardVersions, rewards, staffRoles } from "@/db/schema";
import { createMerchant, enroll } from "./product";
import { selectAudience, selectAudienceBySlug } from "./segments";
import { acceptStaffInvite, createStaffInvite, revokeStaff } from "./staff";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Segment tests require looplocal_test");

const asOf = new Date("2030-01-31T12:00:00.000Z");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic segment tester", id + "@example.test"]);
  return id;
}

async function shop(ownerId: string, name: string) {
  return createMerchant({ userId: ownerId, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: name + " card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
}

async function card(slug: string, createdAt: string, balance = 0) {
  const member = await enroll({ slug, acceptedTerms: true });
  await db.update(memberships).set({ createdAt: new Date(createdAt), balance }).where(eq(memberships.id, member.id));
  return member;
}

async function entry(input: { tenantId: string; locationId: string; membershipId: string; actorUserId: string; at: string; requestId?: string; kind?: "award" | "reversal"; source?: "staff_online" | "staff_correction" | "synthetic_seed"; reversalOfId?: string; delta?: number }) {
  const [row] = await db.insert(ledgerEntries).values({
    tenantId: input.tenantId, locationId: input.locationId, membershipId: input.membershipId,
    actorUserId: input.actorUserId, createdAt: new Date(input.at), requestId: input.requestId ?? randomUUID(),
    idempotencyKey: randomUUID(), kind: input.kind ?? "award", source: input.source ?? "staff_online",
    reversalOfId: input.reversalOfId, delta: input.delta ?? 1,
  }).returning({ id: ledgerEntries.id });
  return row.id;
}

describe("database-backed customer audiences", () => {
  it("counts distinct unreversed staff checkout requests in controlled time windows", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId, "Synthetic Time Café");
    const recent = await card(merchant.programSlug, "2030-01-29T10:00:00.000Z");
    const inactive = await card(merchant.programSlug, "2029-10-01T10:00:00.000Z");
    const noCheckout = await card(merchant.programSlug, "2030-01-30T10:00:00.000Z");
    const sharedRequest = randomUUID();
    const common = { tenantId: merchant.tenantId, locationId: merchant.locationId, actorUserId: ownerId };
    await entry({ ...common, membershipId: recent.id, at: "2030-01-29T11:00:00.000Z", requestId: sharedRequest });
    await entry({ ...common, membershipId: recent.id, at: "2030-01-29T11:00:01.000Z", requestId: sharedRequest });
    await entry({ ...common, membershipId: recent.id, at: "2030-01-20T11:00:00.000Z" });
    const reversed = await entry({ ...common, membershipId: recent.id, at: "2030-01-25T11:00:00.000Z" });
    await entry({ ...common, membershipId: recent.id, at: "2030-01-25T11:01:00.000Z", kind: "reversal", source: "staff_correction", reversalOfId: reversed, delta: -1 });
    await entry({ ...common, membershipId: recent.id, at: "2030-01-28T11:00:00.000Z", source: "synthetic_seed" });
    await entry({ ...common, membershipId: inactive.id, at: "2029-11-01T11:00:00.000Z" });

    const base = { actorUserId: ownerId, programId: merchant.programId, asOf };
    expect((await selectAudience({ ...base, definition: { kind: "new", withinDays: 7 } })).membershipIds.sort()).toEqual([recent.id, noCheckout.id].sort());
    expect((await selectAudience({ ...base, definition: { kind: "recently_active", withinDays: 30 } })).membershipIds).toEqual([recent.id]);
    expect((await selectAudience({ ...base, definition: { kind: "inactive", daysSinceLast: 30 } })).membershipIds).toEqual([inactive.id]);
    expect((await selectAudience({ ...base, definition: { kind: "frequent_visitors", withinDays: 30, minCheckouts: 2 } })).membershipIds).toEqual([recent.id]);
    expect((await selectAudience({ ...base, definition: { kind: "frequent_visitors", withinDays: 30, minCheckouts: 3 } })).total).toBe(0);
  });

  it("selects cards close to an active reward without exposing contact or card credentials", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId, "Synthetic Reward Café");
    const near = await card(merchant.programSlug, "2030-01-20T10:00:00.000Z", 10);
    await card(merchant.programSlug, "2030-01-20T10:00:00.000Z", 12);
    await card(merchant.programSlug, "2030-01-20T10:00:00.000Z", 0);
    await db.insert(membershipContacts).values({ tenantId: merchant.tenantId, membershipId: near.id, email: "private@example.test", emailVerified: true });
    const [other] = await db.insert(rewards).values({ tenantId: merchant.tenantId, programId: merchant.programId, sortOrder: 1 }).returning();
    await db.insert(rewardVersions).values({ tenantId: merchant.tenantId, rewardId: other.id, version: 1, title: "Cake", cost: 12 });

    const result = await selectAudience({ actorUserId: ownerId, programId: merchant.programId, asOf, definition: { kind: "close_to_reward", maxRemaining: 2 } });
    expect(result).toMatchObject({ total: 1, membershipIds: [near.id] });
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(JSON.stringify(result)).not.toContain(near.cardToken);
    expect(JSON.stringify(result)).not.toContain(near.scanCode);
    expect((await selectAudience({ actorUserId: ownerId, programId: merchant.programId, asOf, definition: { kind: "close_to_reward", maxRemaining: 2, rewardId: other.id } })).membershipIds).toEqual([near.id]);
  });

  it("enforces tenant and location scope, denies cashier, and pages stable membership IDs", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const manager = await user();
    const cashier = await user();
    const a = await shop(ownerA, "Synthetic Scope A");
    const b = await shop(ownerB, "Synthetic Scope B");
    const aOne = await card(a.programSlug, "2030-01-29T10:00:00.000Z");
    const aTwo = await card(a.programSlug, "2030-01-30T10:00:00.000Z");
    await card(b.programSlug, "2030-01-30T10:00:00.000Z");
    const [secondLocation] = await db.insert(locations).values({ tenantId: a.tenantId, name: "Other location", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
    await db.insert(billingLocationPlans).values({ tenantId: a.tenantId, locationId: secondLocation.id, currency: "EUR", priceMinor: 4900 });
    const [secondProgram] = await db.insert(programs).values({ tenantId: a.tenantId, locationId: secondLocation.id, slug: "second-" + randomUUID(), name: "Other card", type: "stamp", rulesText: "One stamp per purchase." }).returning();
    await card(secondProgram.slug, "2030-01-30T10:00:00.000Z");
    await db.insert(staffRoles).values([
      { tenantId: a.tenantId, userId: manager, role: "manager", locationId: a.locationId },
      { tenantId: a.tenantId, userId: cashier, role: "cashier", locationId: a.locationId },
    ]);

    const query = { programId: a.programId, asOf, definition: { kind: "new" as const, withinDays: 7 }, limit: 1 };
    const first = await selectAudience({ actorUserId: ownerA, ...query });
    expect(first.total).toBe(2);
    expect(first.membershipIds).toHaveLength(1);
    expect(first.nextCursor).toBe(first.membershipIds[0]);
    const second = await selectAudience({ actorUserId: ownerA, ...query, afterMembershipId: first.nextCursor! });
    expect([...first.membershipIds, ...second.membershipIds].sort()).toEqual([aOne.id, aTwo.id].sort());
    expect(second.nextCursor).toBeNull();
    expect((await selectAudience({ actorUserId: manager, ...query })).total).toBe(2);
    await expect(selectAudience({ actorUserId: manager, ...query, programId: secondProgram.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(selectAudience({ actorUserId: ownerB, ...query })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(selectAudience({ actorUserId: cashier, ...query })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await selectAudienceBySlug({ actorUserId: manager, programSlug: a.programSlug, asOf, definition: query.definition })).total).toBe(2);
    await expect(selectAudienceBySlug({ actorUserId: ownerB, programSlug: a.programSlug, asOf, definition: query.definition })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rechecks manager authorization for saved audience cursors after revocation and location reassignment", async () => {
    const ownerId = await user();
    const managerId = await user();
    const merchant = await shop(ownerId, "Synthetic Departure Café");
    const cards = await Promise.all([card(merchant.programSlug, "2030-01-29T10:00:00.000Z"), card(merchant.programSlug, "2030-01-30T10:00:00.000Z")]);
    const [otherLocation] = await db.insert(locations).values({ tenantId: merchant.tenantId, name: "Other location", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
    await db.insert(billingLocationPlans).values({ tenantId: merchant.tenantId, locationId: otherLocation.id, currency: "EUR", priceMinor: 4900 });
    const [otherProgram] = await db.insert(programs).values({ tenantId: merchant.tenantId, locationId: otherLocation.id, slug: "reassigned-" + randomUUID(), name: "Other card", type: "stamp", rulesText: "One stamp per purchase." }).returning();
    const otherCard = await card(otherProgram.slug, "2030-01-30T10:00:00.000Z");
    const invite = await createStaffInvite({ actorUserId: ownerId, locationId: merchant.locationId, email: managerId + "@example.test", role: "manager" });
    await acceptStaffInvite({ userId: managerId, token: invite.token });
    const query = { actorUserId: managerId, programId: merchant.programId, asOf, definition: { kind: "all" as const }, limit: 1 };
    const first = await selectAudience(query);
    expect(first.total).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    const continuation = { ...query, afterMembershipId: first.nextCursor! };
    await revokeStaff({ actorUserId: ownerId, userId: managerId });
    await expect(selectAudience(continuation)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(selectAudienceBySlug({ actorUserId: managerId, programSlug: merchant.programSlug, asOf, definition: query.definition, afterMembershipId: first.nextCursor! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const reassignment = await createStaffInvite({ actorUserId: ownerId, locationId: otherLocation.id, email: managerId + "@example.test", role: "manager" });
    await acceptStaffInvite({ userId: managerId, token: reassignment.token });
    await expect(selectAudience(continuation)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(selectAudienceBySlug({ actorUserId: managerId, programSlug: merchant.programSlug, asOf, definition: query.definition })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await selectAudience({ ...query, programId: otherProgram.id })).membershipIds).toEqual([otherCard.id]);
    expect((await selectAudience({ ...query, actorUserId: ownerId, limit: 10 })).membershipIds.sort()).toEqual(cards.map(c => c.id).sort());
  });

  it("rejects invalid audience thresholds before querying", async () => {
    const ownerId = await user();
    const merchant = await shop(ownerId, "Synthetic Validation Café");
    await expect(selectAudience({ actorUserId: ownerId, programId: merchant.programId, asOf, definition: { kind: "new", withinDays: 0 } })).rejects.toMatchObject({ issues: expect.any(Array) });
    await expect(selectAudience({ actorUserId: ownerId, programId: merchant.programId, asOf, definition: { kind: "frequent_visitors", withinDays: 30, minCheckouts: 0 } })).rejects.toMatchObject({ issues: expect.any(Array) });
    await expect(selectAudience({ actorUserId: ownerId, programId: merchant.programId, asOf, definition: { kind: "close_to_reward", maxRemaining: -1 } })).rejects.toMatchObject({ issues: expect.any(Array) });
  });
});
