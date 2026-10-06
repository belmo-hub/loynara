import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, locations, memberships, outboxJobs, programRuleVersions, programs, purchaseAwards, redemptions, rewardVersions, rewards, staffRoles, tenants, walletPasses } from "@/db/schema";
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
  const [rule] = await db.insert(programRuleVersions).values({ tenantId: tenant.id, programId: program.id, version: 1, name: program.name, type: program.type, rulesText: program.rulesText, earningMode: program.earningMode, pointsPerCurrencyUnit: program.pointsPerCurrencyUnit }).returning();
  const [reward] = await db.insert(rewards).values({ tenantId: tenant.id, programId: program.id }).returning();
  const [rewardVersion] = await db.insert(rewardVersions).values({ tenantId: tenant.id, rewardId: reward.id, version: 1, title: "Kaffee", cost: 5 }).returning();
  const [member] = await db.insert(memberships).values({ tenantId: tenant.id, programId: program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID()}` }).returning();
  return { userId, tenant, location, program, rule, rewardVersion, member };
}

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => { await pool.end(); });

describe("loyalty ledger", () => {
  it("awards once when a cashier retries the same request", async () => {
    const f = await fixture();
    // The card has a saved Wallet pass, so an award queues exactly one provider refresh (none without a pass).
    await db.insert(walletPasses).values({ tenantId: f.tenant.id, membershipId: f.member.id, provider: "google", providerObjectId: `123456.loynara_${randomUUID()}`, status: "created" });
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

  it("awards floor-rounded purchase points once and retains amount and rule audit", async () => {
    const f = await fixture("owner");
    await db.update(programs).set({ type: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3 }).where(eq(programs.id, f.program.id));
    const [rule] = await db.insert(programRuleVersions).values({ tenantId: f.tenant.id, programId: f.program.id, version: 2, name: f.program.name, type: "points", rulesText: "Drei Punkte pro Euro Kaufbetrag.", earningMode: "purchase", pointsPerCurrencyUnit: 3 }).returning();
    const request = { userId: f.userId, locationId: f.location.id, membershipId: f.member.id, purchaseAmountMinor: 499, ruleVersionId: rule.id, idempotencyKey: randomUUID(), requestId: randomUUID() };
    const first = await award(request);
    expect(first).toMatchObject({ balance: 14, creditedQuantity: 14, duplicate: false });
    expect(await award(request)).toMatchObject({ balance: 14, creditedQuantity: 14, duplicate: true, entryId: first.entryId });
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id));
    expect(entries).toMatchObject([{ id: first.entryId, kind: "award", source: "staff_online", delta: 14 }]);
    expect(await db.select().from(purchaseAwards).where(eq(purchaseAwards.ledgerEntryId, first.entryId))).toMatchObject([{ amountMinor: 499, currency: "EUR", appliedRate: 3, pointsAwarded: 14, ruleVersionId: rule.id, rounding: "floor" }]);
    await expect(award({ ...request, purchaseAmountMinor: 498 })).rejects.toMatchObject({ code: "KEY_REUSED" });
    await expect(reverseEntry({ userId: f.userId, locationId: f.location.id, entryId: first.entryId, reason: "Synthetic purchase amount corrected by owner", idempotencyKey: randomUUID(), requestId: randomUUID() })).resolves.toMatchObject({ balance: 0 });
    expect(await db.select().from(purchaseAwards)).toHaveLength(1);
  });

  it("rejects stale purchase rules, zero-point purchases, and cashier cap overflow", async () => {
    const f = await fixture("cashier");
    await db.update(programs).set({ type: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3 }).where(eq(programs.id, f.program.id));
    const [rule] = await db.insert(programRuleVersions).values({ tenantId: f.tenant.id, programId: f.program.id, version: 2, name: f.program.name, type: "points", rulesText: "Drei Punkte pro Euro Kaufbetrag.", earningMode: "purchase", pointsPerCurrencyUnit: 3 }).returning();
    const base = { userId: f.userId, locationId: f.location.id, membershipId: f.member.id, ruleVersionId: rule.id, idempotencyKey: randomUUID(), requestId: randomUUID() };
    await expect(award({ ...base, purchaseAmountMinor: 25 })).rejects.toMatchObject({ code: "NO_POINTS" });
    await expect(award({ ...base, purchaseAmountMinor: 50_001 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await expect(award({ ...base, purchaseAmountMinor: 16_700 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await expect(award({ ...base, quantity: 3 })).rejects.toMatchObject({ code: "INVALID_EARNING_MODE" });
    await db.update(programs).set({ pointsPerCurrencyUnit: 4 }).where(eq(programs.id, f.program.id));
    await db.insert(programRuleVersions).values({ tenantId: f.tenant.id, programId: f.program.id, version: 3, name: f.program.name, type: "points", rulesText: "Vier Punkte pro Euro Kaufbetrag.", earningMode: "purchase", pointsPerCurrencyUnit: 4 });
    await expect(award({ ...base, purchaseAmountMinor: 200 })).rejects.toMatchObject({ code: "STALE_RULE" });
  });
});
