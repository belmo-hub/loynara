import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { locations, memberships, outboxJobs, programs, redemptions, rewardVersions, rewards, staffRoles, tenants } from "@/db/schema";
import { award, redeem, reverseEntry } from "./loyalty";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) {
  throw new Error("Integration tests require the dedicated looplocal_test database");
}

async function fixture(role: "owner" | "manager" | "cashier" = "cashier") {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Synthetic staff", `${userId}@example.test`]);
  const [tenant] = await db.insert(tenants).values({ name: "Synthetic Bakery", slug: `bakery-${userId}`, currency: "EUR", locale: "de" }).returning();
  const [location] = await db.insert(locations).values({ tenantId: tenant.id, name: "Synthetic Kassel", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
  await db.insert(staffRoles).values({ tenantId: tenant.id, userId, role, locationId: role === "owner" ? null : location.id });
  const [program] = await db.insert(programs).values({ tenantId: tenant.id, locationId: location.id, slug: `program-${userId}`, name: "Stempelkarte", type: "stamp", rulesText: "Ein Stempel pro Besuch." }).returning();
  const [reward] = await db.insert(rewards).values({ tenantId: tenant.id, programId: program.id }).returning();
  const [rewardVersion] = await db.insert(rewardVersions).values({ tenantId: tenant.id, rewardId: reward.id, version: 1, title: "Kaffee", cost: 5 }).returning();
  const [member] = await db.insert(memberships).values({ tenantId: tenant.id, programId: program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID()}` }).returning();
  return { userId, tenant, location, program, rewardVersion, member };
}

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => { await pool.end(); });

describe("loyalty ledger", () => {
  it("awards once when a cashier retries the same request", async () => {
    const f = await fixture();
    const request = { userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() };
    const first = await award(request);
    const second = await award(request);
    expect(first).toMatchObject({ balance: 2, duplicate: false });
    expect(second).toMatchObject({ balance: 2, duplicate: true, entryId: first.entryId });
    const [member] = await db.select().from(memberships).where(eq(memberships.id, f.member.id));
    const jobs = await db.select().from(outboxJobs).where(eq(outboxJobs.tenantId, f.tenant.id));
    expect(member.balance).toBe(2);
    expect(jobs).toHaveLength(1);
  });

  it("allows only one of two simultaneous redemptions against the same balance", async () => {
    const f = await fixture();
    await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const base = { userId: f.userId, locationId: f.location.id, membershipId: f.member.id, rewardVersionId: f.rewardVersion.id };
    const results = await Promise.allSettled([
      redeem({ ...base, idempotencyKey: randomUUID(), requestId: randomUUID() }),
      redeem({ ...base, idempotencyKey: randomUUID(), requestId: randomUUID() }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [member] = await db.select().from(memberships).where(eq(memberships.id, f.member.id));
    expect(member.balance).toBe(0);
    expect(await db.select().from(redemptions).where(eq(redemptions.tenantId, f.tenant.id))).toHaveLength(1);
  });

  it("rejects a cashier from another tenant and a revoked cashier", async () => {
    const own = await fixture();
    const other = await fixture();
    await expect(award({ userId: own.userId, locationId: other.location.id, membershipId: other.member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, own.userId));
    await expect(award({ userId: own.userId, locationId: own.location.id, membershipId: own.member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("enforces the cashier award limit", async () => {
    const f = await fixture();
    await expect(award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 11, idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("records a reasoned correction as a linked reversal and prevents a second reversal", async () => {
    const f = await fixture("manager");
    const first = await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 3, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const input = { userId: f.userId, locationId: f.location.id, entryId: first.entryId, reason: "Kassenvorgang versehentlich doppelt erfasst", idempotencyKey: randomUUID(), requestId: randomUUID() };
    const correction = await reverseEntry(input);
    expect(correction).toMatchObject({ balance: 0, duplicate: false });
    await expect(reverseEntry({ ...input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "ALREADY_REVERSED" });
    const [member] = await db.select().from(memberships).where(eq(memberships.id, f.member.id));
    expect(member.balance).toBe(0);
    expect(await reverseEntry(input)).toMatchObject({ balance: 0, duplicate: true, entryId: correction.entryId });
  });

  it("does not let cashiers make corrections", async () => {
    const f = await fixture("cashier");
    const first = await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await expect(reverseEntry({ userId: f.userId, locationId: f.location.id, entryId: first.entryId, reason: "Synthetic correction", idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
