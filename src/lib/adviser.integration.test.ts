import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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


it("keeps one adviser response consistent across a committed award between analytics and retention", async () => {
  const owner = await user(), merchant = await shop(owner, "Synthetic Advice Snapshot");
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  const asOf = new Date(Date.now() + 60_000);
  let observed!: () => void, resume!: () => void;
  const reached = new Promise<void>(resolve => { observed = resolve; });
  const proceed = new Promise<void>(resolve => { resume = resolve; });
  let held = false;
  const original = Client.prototype.query;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const config = args[0], text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
    if (!held && text?.includes('AS "rewardReady"')) {
      held = true; observed();
      // Delay actual submission only. Do not replace PostgreSQL rows or block the real writer.
      if (typeof args.at(-1) === "function") { void proceed.then(() => Reflect.apply(original, this, args)); return; }
      return proceed.then(() => Reflect.apply(original, this, args));
    }
    return Reflect.apply(original, this, args);
  }) as typeof original);
  let pending: ReturnType<typeof getMerchantAdvice> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    pending = getMerchantAdvice(owner, { windowDays: 30, asOf });
    await Promise.race([reached, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Actual retention query not reached")), 2000); })]);
    await expect(award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() })).resolves.toMatchObject({ balance: 5 });
    resume(); const report = await pending;
    expect(report.metrics.qualifyingCheckouts).toBe(0);
    expect(report.recommendations.map(row => row.id)).toContain("checkout_flow");
    expect(report.recommendations.map(row => row.id)).not.toContain("reward_waiting");
    const fresh = await getMerchantAdvice(owner, { windowDays: 30, asOf });
    expect(fresh.metrics.qualifyingCheckouts).toBe(1);
    expect(fresh.recommendations.map(row => row.id)).toContain("reward_waiting");
    expect(fresh.recommendations.map(row => row.id)).not.toContain("checkout_flow");
  } finally {
    if (timeout) clearTimeout(timeout); resume();
    try { await pending; } finally { spy.mockRestore(); }
  }
});


it("rolls back a failed retention read and leaves a reusable reporting connection", async () => {
  const owner = await user(); await shop(owner, "Synthetic Failed Advice");
  const original = Client.prototype.query; let failed = false;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const config = args[0], text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
    if (!failed && text?.includes('AS "rewardReady"')) { failed = true; return Reflect.apply(original, this, ["SELECT 1 / 0"]); }
    return Reflect.apply(original, this, args);
  }) as typeof original);
  try { await expect(getMerchantAdvice(owner, { windowDays: 30 })).rejects.toMatchObject({ code: "22012" }); }
  finally { spy.mockRestore(); }
  const fresh = await getMerchantAdvice(owner, { windowDays: 30 });
  expect(fresh.metrics.currentActiveCards).toBe(0); expect(fresh.recommendations.map(row => row.id)).toContain("enrolment_start");
});
