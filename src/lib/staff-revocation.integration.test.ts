import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, rewardVersions, staffRoles } from "@/db/schema";
import { award, redeem, reverseEntry } from "./loyalty";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { createMerchant } from "./product";
import { revokeStaff } from "./staff";

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

describe("checkout and completed staff revocation ordering", () => {
  it.each(["award", "redeem", "reverse"] as const)("orders in-flight %s before revocation returns and rejects later stale identities", async kind => {
    const f = await nfcFixture();
    const manager = await addStaff(f.tenant.id, f.location.id, "manager");
    const original = await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 10, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [reward] = await db.select().from(rewardVersions);
    const checkout = () => {
      const common = { userId: manager, locationId: f.location.id, idempotencyKey: randomUUID(), requestId: randomUUID() };
      if (kind === "award") return award({ ...common, membershipId: f.member.id, quantity: 1 });
      if (kind === "redeem") return redeem({ ...common, membershipId: f.member.id, rewardVersionId: reward.id });
      return reverseEntry({ ...common, entryId: original.entryId, reason: "Synthetic manager correction" });
    };
    const gate = await pool.connect();
    const order: string[] = [];
    let operation: Promise<unknown> | undefined;
    let revocation: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query("LOCK TABLE ledger_entries IN SHARE MODE");
      operation = checkout().then(value => { order.push("checkout"); return value; }, error => ({ error }));
      expect(await waitForLock("insert into \"ledger_entries\""), "Checkout is paused after authorization, before booking").toBe(true);
      revocation = revokeStaff({ actorUserId: f.userId, userId: manager }).then(value => { order.push("revocation"); return value; }, error => ({ error }));
      expect(await waitForLock("staff_roles"), "Revocation must wait for authorized in-flight checkout").toBe(true);
      expect(order).toEqual([]);
      await gate.query("COMMIT");
      const results = await Promise.all([operation, revocation]);
      expect(results.every(result => !result || !("error" in (result as object)))).toBe(true);
      expect(order).toEqual(["checkout", "revocation"]);
      await expect(checkout()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await db.select().from(staffRoles).where(eq(staffRoles.userId, manager)))[0].active).toBe(false);
    } finally {
      await gate.query("ROLLBACK");
      await Promise.all([operation, revocation]);
      gate.release();
    }
  });

  it("denies checkout when revocation acquired the role lock first", async () => {
    const f = await nfcFixture();
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const gate = await pool.connect();
    let revocation: Promise<unknown> | undefined;
    let checkout: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query("LOCK TABLE staff_audit_events IN SHARE MODE");
      revocation = revokeStaff({ actorUserId: f.userId, userId: cashier }).then(value => ({ value }), error => ({ error }));
      expect(await waitForLock('insert into "staff_audit_events"')).toBe(true);
      checkout = award({ userId: cashier, locationId: f.location.id, membershipId: f.member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() }).then(value => ({ value }), error => ({ error }));
      expect(await waitForLock("staff_roles")).toBe(true);
      await gate.query("COMMIT");
      expect(await revocation).toMatchObject({ value: { active: false } });
      expect(await checkout).toMatchObject({ error: { code: "FORBIDDEN" } });
      expect(await db.select().from(ledgerEntries)).toHaveLength(0);
      expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(0);
    } finally {
      await gate.query("ROLLBACK");
      await Promise.all([revocation, checkout]);
      gate.release();
    }
  });

  it("keeps user-before-role ordering when onboarding races an existing cashier's award", async () => {
    const f = await nfcFixture();
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const gate = await pool.connect();
    let onboarding: Promise<unknown> | undefined;
    let checkout: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [cashier]);
      onboarding = createMerchant({ userId: cashier, businessName: "Synthetic", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic card", programType: "stamp", rulesText: "One stamp per visit", rewardTitle: "Coffee", rewardCost: 8 }).then(value => ({ value }), error => ({ error }));
      expect(await waitForLock('select id from "user"')).toBe(true);
      checkout = award({ userId: cashier, locationId: f.location.id, membershipId: f.member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() }).then(value => ({ value }), error => ({ error }));
      expect(await waitForLock('user', 2)).toBe(true);
      await gate.query("COMMIT");
      expect(await onboarding).toMatchObject({ error: { code: "FORBIDDEN" } });
      expect(await checkout).toMatchObject({ value: { balance: 1 } });
      expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(1);
    } finally {
      await gate.query("ROLLBACK");
      await Promise.all([onboarding, checkout]);
      gate.release();
    }
  });
});
