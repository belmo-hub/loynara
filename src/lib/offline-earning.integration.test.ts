import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, locations, memberships, programRuleVersions, programs, staffRoles, tenants } from "@/db/schema";
import { prepareOfflineAward, syncOfflineAward } from "./offline-earning";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Offline earning tests require looplocal_test");

async function fixture() {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Synthetic cashier", `${userId}@example.test`]);
  const [tenant] = await db.insert(tenants).values({ name: "Synthetic bakery", slug: `offline-${userId}` }).returning();
  const [location] = await db.insert(locations).values({ tenantId: tenant.id, name: "Counter", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
  await db.insert(staffRoles).values({ tenantId: tenant.id, userId, role: "cashier", locationId: location.id });
  const [program] = await db.insert(programs).values({ tenantId: tenant.id, locationId: location.id, slug: `offline-${randomUUID()}`, name: "Stamp card", type: "stamp", rulesText: "One stamp per visit" }).returning();
  const [member] = await db.insert(memberships).values({ tenantId: tenant.id, programId: program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID()}` }).returning();
  return { userId, tenant, location, member };
}

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

describe("offline earning reconciliation", () => {
  it("uses the database clock for a current online lease and later sync", async () => {
    const f = await fixture();
    const deviceId = randomUUID();
    const lease = await prepareOfflineAward({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, deviceId });
    expect(await syncOfflineAward({ userId: f.userId, leaseId: lease.leaseId, deviceId, eventId: randomUUID(), eventAt: new Date(), award: { quantity: 1 } })).toMatchObject({ status: "accepted", balance: 1 });
  });

  it("keeps an offline award unspendable until sync, then accepts one ledger entry across retries", async () => {
    const f = await fixture();
    const now = new Date("2026-09-25T10:00:00Z");
    const deviceId = randomUUID();
    const lease = await prepareOfflineAward({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, deviceId, now });
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(0);
    const event = { userId: f.userId, leaseId: lease.leaseId, deviceId, eventId: randomUUID(), eventAt: new Date("2026-09-25T10:01:00Z"), award: { quantity: 1 }, now: new Date("2026-09-25T10:02:00Z") };
    const first = await syncOfflineAward(event);
    expect(first).toMatchObject({ status: "accepted", duplicate: false, balance: 1 });
    expect(await syncOfflineAward(event)).toMatchObject({ status: "accepted", duplicate: true, balance: 1, entryId: first.entryId });
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id))).toMatchObject([{ kind: "award", source: "staff_offline", delta: 1 }]);
    await expect(syncOfflineAward({ ...event, award: { quantity: 2 } })).rejects.toMatchObject({ code: "KEY_REUSED" });
  });

  it("rejects an event after staff revocation or lease expiry without crediting a balance", async () => {
    const f = await fixture();
    const now = new Date("2026-09-25T10:00:00Z");
    const deviceId = randomUUID();
    const lease = await prepareOfflineAward({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, deviceId, now });
    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, f.userId));
    const revoked = await syncOfflineAward({ userId: f.userId, leaseId: lease.leaseId, deviceId, eventId: randomUUID(), eventAt: new Date("2026-09-25T10:01:00Z"), award: { quantity: 1 }, now: new Date("2026-09-25T10:02:00Z") });
    expect(revoked).toMatchObject({ status: "rejected", reason: "STAFF_REVOKED" });
    await db.update(staffRoles).set({ active: true }).where(eq(staffRoles.userId, f.userId));
    const expired = await syncOfflineAward({ userId: f.userId, leaseId: lease.leaseId, deviceId, eventId: randomUUID(), eventAt: new Date("2026-09-25T10:01:00Z"), award: { quantity: 1 }, now: new Date("2026-09-25T10:31:00Z") });
    expect(expired).toMatchObject({ status: "rejected", reason: "LEASE_EXPIRED" });
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(0);
  });

  it("rejects a different device and an event timestamp outside its lease", async () => {
    const f = await fixture();
    const now = new Date("2026-09-25T10:00:00Z");
    const deviceId = randomUUID();
    const lease = await prepareOfflineAward({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, deviceId, now });
    const base = { userId: f.userId, leaseId: lease.leaseId, eventAt: new Date("2026-09-25T10:01:00Z"), award: { quantity: 1 }, now: new Date("2026-09-25T10:02:00Z") };
    expect(await syncOfflineAward({ ...base, deviceId: randomUUID(), eventId: randomUUID() })).toMatchObject({ status: "rejected", reason: "WRONG_DEVICE" });
    expect(await syncOfflineAward({ ...base, deviceId, eventId: randomUUID(), eventAt: new Date("2026-09-25T09:59:00Z") })).toMatchObject({ status: "rejected", reason: "EVENT_OUTSIDE_LEASE" });
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(0);
  });

  it("rejects a queued purchase when its rule version changed before reconciliation", async () => {
    const f = await fixture();
    await db.update(programs).set({ type: "points", earningMode: "purchase", pointsPerCurrencyUnit: 2 }).where(eq(programs.id, f.member.programId));
    const [initial] = await db.insert(programRuleVersions).values({ tenantId: f.tenant.id, programId: f.member.programId, version: 1, name: "Points", type: "points", rulesText: "Two points per unit", earningMode: "purchase", pointsPerCurrencyUnit: 2 }).returning();
    const now = new Date("2026-09-25T10:00:00Z");
    const deviceId = randomUUID();
    const lease = await prepareOfflineAward({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, deviceId, now });
    await db.update(programs).set({ pointsPerCurrencyUnit: 3 }).where(eq(programs.id, f.member.programId));
    await db.insert(programRuleVersions).values({ tenantId: f.tenant.id, programId: f.member.programId, version: 2, name: "Points", type: "points", rulesText: "Three points per unit", earningMode: "purchase", pointsPerCurrencyUnit: 3 });
    const result = await syncOfflineAward({ userId: f.userId, leaseId: lease.leaseId, deviceId, eventId: randomUUID(), eventAt: new Date("2026-09-25T10:01:00Z"), award: { purchaseAmountMinor: 250, ruleVersionId: initial.id }, now: new Date("2026-09-25T10:02:00Z") });
    expect(result).toMatchObject({ status: "rejected", reason: "STALE_RULE" });
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(0);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id))).toEqual([]);
  });

  it("enforces the per-lease event cap under simultaneous synchronization", async () => {
    const f = await fixture();
    const now = new Date("2026-09-25T10:00:00Z");
    const deviceId = randomUUID();
    const lease = await prepareOfflineAward({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, deviceId, now });
    const results = await Promise.all(Array.from({ length: 21 }, (_, index) => syncOfflineAward({
      userId: f.userId, leaseId: lease.leaseId, deviceId, eventId: randomUUID(),
      eventAt: new Date(now.getTime() + 60_000 + index), award: { quantity: 1 }, now: new Date(now.getTime() + 120_000),
    })));
    expect(results.filter(result => result.status === "accepted")).toHaveLength(20);
    expect(results.filter(result => result.reason === "LEASE_LIMIT")).toHaveLength(1);
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(20);
  });

  it("does not credit the same event ID across separate tenants", async () => {
    const first = await fixture();
    const second = await fixture();
    const now = new Date("2026-09-25T10:00:00Z");
    const eventId = randomUUID();
    const deviceA = randomUUID();
    const deviceB = randomUUID();
    const leaseA = await prepareOfflineAward({ userId: first.userId, locationId: first.location.id, membershipId: first.member.id, deviceId: deviceA, now });
    const leaseB = await prepareOfflineAward({ userId: second.userId, locationId: second.location.id, membershipId: second.member.id, deviceId: deviceB, now });
    const results = await Promise.allSettled([
      syncOfflineAward({ userId: first.userId, leaseId: leaseA.leaseId, deviceId: deviceA, eventId, eventAt: new Date("2026-09-25T10:01:00Z"), award: { quantity: 1 }, now: new Date("2026-09-25T10:02:00Z") }),
      syncOfflineAward({ userId: second.userId, leaseId: leaseB.leaseId, deviceId: deviceB, eventId, eventAt: new Date("2026-09-25T10:01:00Z"), award: { quantity: 1 }, now: new Date("2026-09-25T10:02:00Z") }),
    ]);
    expect(results.filter(result => result.status === "fulfilled" && result.value.status === "accepted")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected" && (result.reason as { code?: string }).code === "KEY_REUSED")).toHaveLength(1);
    const balances = await db.select({ balance: memberships.balance }).from(memberships);
    expect(balances.reduce((sum, row) => sum + row.balance, 0)).toBe(1);
  });
});
