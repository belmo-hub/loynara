import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, redemptions, staffRoles } from "@/db/schema";
import { award, redeem } from "./loyalty";
import { nfcFixture } from "./nfc-test-db";
import { archiveReward, createReward, editReward, getMerchantRewards } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function waitForLock(fragment: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE $1", [`%${fragment}%`]);
    if (result.rows[0].count > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return false;
}
async function fixture(kind: "edit" | "archive") {
  const f = await nfcFixture();
  const [reward] = await getMerchantRewards({ actorUserId: f.userId, programSlug: f.program.slug });
  await createReward({ actorUserId: f.userId, programSlug: f.program.slug, title: "Other synthetic reward", cost: 12 });
  await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 20, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const request = { userId: f.userId, locationId: f.location.id, membershipId: f.member.id, rewardVersionId: reward.versionId, idempotencyKey: randomUUID(), requestId: randomUUID() };
  const change = () => kind === "edit" ? editReward({ actorUserId: f.userId, programSlug: f.program.slug, rewardId: reward.rewardId, title: "Changed synthetic reward", cost: 9, termsText: "" }) : archiveReward({ actorUserId: f.userId, programSlug: f.program.slug, rewardId: reward.rewardId });
  return { f, request, change };
}

describe("redemption orders catalogue changes against the authoritative booking", () => {
  it.each(["edit", "archive"] as const)("finishes an authorized redemption before catalogue %s returns", async kind => {
    const { f, request, change } = await fixture(kind);
    const gate = await pool.connect();
    const order: string[] = [];
    let booking: Promise<unknown> | undefined;
    let catalogue: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query("LOCK TABLE ledger_entries IN SHARE MODE");
      booking = redeem(request).then(value => { order.push("redeem"); return { value }; }, error => ({ error }));
      expect(await waitForLock('insert into "ledger_entries"')).toBe(true);
      catalogue = change().then(value => { order.push("catalogue"); return { value }; }, error => ({ error }));
      expect.soft(await waitForLock("rewards"), "Catalogue mutation must wait for the in-flight validated reward").toBe(true);
      expect.soft(order).toEqual([]);
      await gate.query("COMMIT");
      expect(await booking).toMatchObject({ value: { balance: 12, duplicate: false } });
      expect(await catalogue).toHaveProperty("value");
      expect.soft(order).toEqual(["redeem", "catalogue"]);
      await expect(redeem(request)).resolves.toMatchObject({ balance: 12, duplicate: true });
      await expect(redeem({ ...request, idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: kind === "edit" ? "STALE_REWARD" : "INVALID_REWARD" });
      expect(await db.select().from(redemptions).where(eq(redemptions.membershipId, f.member.id))).toHaveLength(1);
      expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(12);
    } finally { await gate.query("ROLLBACK"); await Promise.all([booking, catalogue]); gate.release(); }
  });

  it.each(["edit", "archive"] as const)("rejects stale redemption when catalogue %s acquired its lock first", async kind => {
    const { f, request, change } = await fixture(kind);
    const gate = await pool.connect();
    let catalogue: Promise<unknown> | undefined;
    let booking: Promise<unknown> | undefined;
    try {
      await gate.query("BEGIN");
      // The real catalogue operation has updated its reward before enqueueing Wallet work.
      await gate.query("LOCK TABLE outbox_jobs IN SHARE MODE");
      catalogue = change().then(value => ({ value }), error => ({ error }));
      expect(await waitForLock("INSERT INTO outbox_jobs")).toBe(true);
      booking = redeem(request).then(value => ({ value }), error => ({ error }));
      expect.soft(await waitForLock("rewards"), "Redemption must wait for the catalogue transaction").toBe(true);
      await gate.query("COMMIT");
      expect(await catalogue).toHaveProperty("value");
      expect.soft(await booking).toMatchObject({ error: { code: kind === "edit" ? "STALE_REWARD" : "INVALID_REWARD" } });
      expect(await db.select().from(redemptions).where(eq(redemptions.membershipId, f.member.id))).toHaveLength(0);
      expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(20);
      expect((await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id))).filter(row => row.kind === "redeem")).toHaveLength(0);
    } finally { await gate.query("ROLLBACK"); await Promise.all([catalogue, booking]); gate.release(); }
  });

  it("rejects foreign rewards, tenants, locations, revoked staff and closed cards without redemption effects", async () => {
    const { f, request } = await fixture("edit");
    const other = await nfcFixture();
    const [foreignReward] = await getMerchantRewards({ actorUserId: other.userId, programSlug: other.program.slug });
    await expect(redeem({ ...request, rewardVersionId: foreignReward.versionId })).rejects.toMatchObject({ code: "INVALID_REWARD" });
    await expect(redeem({ ...request, userId: other.userId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(redeem({ ...request, locationId: other.location.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, f.userId));
    await expect(redeem(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(memberships).set({ closedAt: new Date() }).where(eq(memberships.id, f.member.id));
    await expect(redeem(request)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(redemptions)).toHaveLength(0);
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(20);
  });

});
