import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, outboxJobs, programRuleVersions, programs, purchaseAwards } from "@/db/schema";
import { award } from "./loyalty";
import { nfcFixture } from "./nfc-test-db";
import { updateProgram } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });
async function waitForLock(fragment: string, count = 1) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE $1", [`%${fragment}%`]);
    if (result.rows[0].count >= count) return true;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return false;
}
async function fixture() {
  const f = await nfcFixture();
  await db.update(programs).set({ type: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3 }).where(eq(programs.id, f.program.id));
  const [rule] = await db.insert(programRuleVersions).values({ tenantId: f.tenant.id, programId: f.program.id, version: 2, name: f.program.name, type: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3, rulesText: "Synthetic three points per euro" }).returning();
  const request = { userId: f.userId, locationId: f.location.id, membershipId: f.member.id, purchaseAmountMinor: 499, ruleVersionId: rule.id, idempotencyKey: randomUUID(), requestId: randomUUID() };
  const change = () => updateProgram({ actorUserId: f.userId, programSlug: f.program.slug, name: f.program.name, rulesText: "Synthetic four points per euro", pointsPerCurrencyUnit: 4 });
  return { f, rule, request, change };
}
async function assertSnapshot(f: Awaited<ReturnType<typeof fixture>>) {
  const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.f.member.id));
  expect(entries).toMatchObject([{ delta: 14, kind: "award" }]);
  const audits = await db.select().from(purchaseAwards).where(eq(purchaseAwards.ledgerEntryId, entries[0].id));
  expect(audits).toMatchObject([{ ruleVersionId: f.rule.id, appliedRate: 3, pointsAwarded: 14, amountMinor: 499, rounding: "floor" }]);
  expect((await db.select().from(memberships).where(eq(memberships.id, f.f.member.id)))[0].balance).toBe(14);
  const queued = await db.select().from(outboxJobs);
  await expect(award(f.request)).resolves.toMatchObject({ entryId: entries[0].id, balance: 14, duplicate: true, creditedQuantity: 14 });
  await expect(award({ ...f.request, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "STALE_RULE" });
  expect(await db.select().from(purchaseAwards)).toHaveLength(1);
  expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.f.member.id))).toEqual(entries);
  expect((await db.select().from(memberships).where(eq(memberships.id, f.f.member.id)))[0].balance).toBe(14);
  expect(await db.select().from(outboxJobs)).toEqual(queued);
}
// Characterization only: these assertions establish internal snapshot consistency,
// not founder acceptance of transaction-start versus commit-time effective rules.
describe("purchase rule concurrency evidence", () => {
  it("retains a coherent validated snapshot if the owner changes rules before ledger insertion", async () => {
    const f = await fixture(); const gate = await pool.connect();
    let booking: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN"); await gate.query("LOCK TABLE ledger_entries IN SHARE MODE");
      booking = award(f.request).then(value => ({ value }), error => ({ error }));
      expect(await waitForLock('insert into "ledger_entries"')).toBe(true);
      await expect(f.change()).resolves.toMatchObject({ ruleVersion: 3 });
      await gate.query("COMMIT");
      expect(await booking).toMatchObject({ value: { balance: 14, duplicate: false } });
      await assertSnapshot(f);
    } finally { await gate.query("ROLLBACK"); await booking; gate.release(); }
  });
  it("retains the committed snapshot while an owner rule change is still uncommitted", async () => {
    const f = await fixture(); const gate = await pool.connect();
    let change: Promise<unknown> | undefined; let booking: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN"); await gate.query("LOCK TABLE outbox_jobs IN SHARE MODE");
      change = f.change().then(value => ({ value }), error => ({ error }));
      expect(await waitForLock("INSERT INTO outbox_jobs")).toBe(true);
      booking = award(f.request).then(value => ({ value }), error => ({ error }));
      expect(await waitForLock("INSERT INTO outbox_jobs", 2)).toBe(true);
      await gate.query("COMMIT");
      expect(await change).toHaveProperty("value"); expect(await booking).toMatchObject({ value: { balance: 14, duplicate: false } });
      await assertSnapshot(f);
    } finally { await gate.query("ROLLBACK"); await Promise.all([change, booking]); gate.release(); }
  });
  it("rejects a mixed read when the rule changes after the programme read but before version validation", async () => {
    const f = await fixture(); const gate = await pool.connect();
    let booking: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN"); await gate.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [f.f.userId]);
      booking = award(f.request).then(value => ({ value }), error => ({ error }));
      expect(await waitForLock('from "user"')).toBe(true);
      await f.change(); await gate.query("COMMIT");
      expect(await booking).toMatchObject({ error: { code: "STALE_RULE" } });
      expect(await db.select().from(purchaseAwards)).toHaveLength(0);
      expect(await db.select().from(ledgerEntries)).toHaveLength(0);
      expect((await db.select().from(memberships).where(eq(memberships.id, f.f.member.id)))[0].balance).toBe(0);
    } finally { await gate.query("ROLLBACK"); await booking; gate.release(); }
  });
});
