import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { staffRoles } from "@/db/schema";
import { award } from "./loyalty";
import { createMerchant, enroll } from "./product";
import { getMerchantAdvice } from "./adviser";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Adviser tests require looplocal_test");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic adviser tester", `${id}@example.test`]);
  return id;
}

async function shop(ownerId: string, name: string) {
  return createMerchant({ userId: ownerId, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `${name} Karte`, programType: "stamp", rulesText: "Ein Stempel je bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5 });
}

describe("tenant-scoped merchant adviser", () => {
  it("changes recommendations after this merchant records a checkout and excludes the other tenant", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const a = await shop(ownerA, "Synthetic Advice A");
    const b = await shop(ownerB, "Synthetic Advice B");
    const cardA = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const cardB = await enroll({ slug: b.programSlug, acceptedTerms: true });
    const asOf = new Date(Date.now() + 1000);
    const before = await getMerchantAdvice(ownerA, { windowDays: 30, asOf });
    expect(before).toMatchObject({ mode: "rule_based", metrics: { currentActiveCards: 1, qualifyingCheckouts: 0 } });
    expect(before.recommendations.map(item => item.id)).toContain("checkout_flow");
    await award({ userId: ownerA, locationId: a.locationId, membershipId: cardA.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const after = await getMerchantAdvice(ownerA, { windowDays: 30, asOf: new Date(Date.now() + 1000) });
    expect(after.metrics).toMatchObject({ currentActiveCards: 1, qualifyingCheckouts: 1 });
    expect(after.recommendations.map(item => item.id)).not.toContain("checkout_flow");
    const other = await getMerchantAdvice(ownerB, { windowDays: 30, asOf: new Date(Date.now() + 1000) });
    expect(other.metrics).toMatchObject({ currentActiveCards: 1, qualifyingCheckouts: 0 });
    expect(JSON.stringify(after)).not.toContain(cardA.cardToken);
    expect(JSON.stringify(after)).not.toContain(cardB.cardToken);
  });

  it("denies cashier and revoked owner access", async () => {
    const owner = await user();
    const cashier = await user();
    const merchant = await shop(owner, "Synthetic Advice Access");
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, userId: cashier, role: "cashier", locationId: merchant.locationId });
    await expect(getMerchantAdvice(cashier, { windowDays: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(staffRoles).set({ active: false }).where(and(eq(staffRoles.tenantId, merchant.tenantId), eq(staffRoles.userId, owner)));
    await expect(getMerchantAdvice(owner, { windowDays: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
