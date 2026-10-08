import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db";
import * as outbox from "../src/lib/outbox";
import { boundedWorkerDatabase } from "./worker-database";
import { createMerchant } from "../src/lib/product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Requires dedicated localhost looplocal_test");
beforeEach(async () => { await pool.query('TRUNCATE tenants, "user", apple_devices CASCADE'); });
afterAll(() => pool.end());
async function fixture() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [owner, "Worker lease fixture", `${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Lease Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Lease", programType: "stamp", rulesText: "One confirmed visit", rewardTitle: "Coffee", rewardCost: 5 });
  const membershipId = randomUUID();
  const result = await pool.query("INSERT INTO outbox_jobs (tenant_id,kind,payload) VALUES ($1,'wallet.refresh',jsonb_build_object('membershipId',$2::text)) RETURNING id", [merchant.tenantId, membershipId]);
  return { id: result.rows[0].id, tenantId: merchant.tenantId, membershipId };
}
const state = (id: string) => pool.query("SELECT status,attempts,next_attempt_at FROM outbox_jobs WHERE id=$1", [id]).then(result => result.rows[0]);
const claim = () => outbox.claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 });
describe("real fenced Wallet worker leases", () => {
  it("renews only the current unexpired processing attempt", async () => {
    expect(outbox.renewOutboxJob).toBeTypeOf("function");
    const f = await fixture();
    const job = (await claim())!;
    await pool.query("UPDATE outbox_jobs SET next_attempt_at=now()+interval '5 seconds' WHERE id=$1", [f.id]);
    expect(await outbox.renewOutboxJob(pool, job)).toBe(true);
    expect((await state(f.id)).next_attempt_at.getTime() - Date.now()).toBeGreaterThan(295_000);
    expect(await outbox.renewOutboxJob(pool, { ...job, attempts: 0 })).toBe(false);
    await pool.query("UPDATE outbox_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [f.id]);
    expect(await outbox.renewOutboxJob(pool, job)).toBe(false);
  });
  it("prevents completion by an expired owner before any competing worker claims", async () => {
    const f = await fixture();
    const job = (await claim())!;
    await pool.query("UPDATE outbox_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [f.id]);
    expect(await outbox.markOutboxJob(pool, job, "complete")).toBe(false);
    expect((await state(f.id)).status).toBe("processing");
  });
  it("allows exactly one competing claim and fences every stale outcome after recovery", async () => {
    const f = await fixture();
    const first = (await claim())!;
    const simultaneous = await Promise.all([claim(),claim()]);
    expect(simultaneous).toEqual([null,null]);
    await pool.query("UPDATE outbox_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [f.id]);
    const recovery = await Promise.all([claim(),claim()]);
    expect(recovery.filter(Boolean)).toHaveLength(1);
    expect(recovery.find(Boolean)?.attempts).toBe(2);
    expect(await outbox.markOutboxJob(pool,first,"complete")).toBe(false);
    expect((await state(f.id)).status).toBe("processing");
  });
  it("cannot suppress an older failure unless the successful attempt still owns its lease", async () => {
    expect(outbox.completeWalletOutboxJob).toBeTypeOf("function");
    const f = await fixture();
    const older = await pool.query("INSERT INTO outbox_jobs (tenant_id,kind,payload,status,attempts,created_at) VALUES ($1,'wallet.refresh',jsonb_build_object('membershipId',$2::text),'failed',5,now()-interval '1 hour') RETURNING id", [f.tenantId,f.membershipId]);
    const first = (await claim())!;
    await pool.query("UPDATE outbox_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [f.id]);
    const current = (await claim())!;
    expect(await outbox.completeWalletOutboxJob(pool,first)).toBe(false);
    expect((await state(older.rows[0].id)).status).toBe("failed");
    expect(await outbox.completeWalletOutboxJob(pool,current)).toBe(true);
    expect((await state(older.rows[0].id)).status).toBe("suppressed");
    expect((await state(f.id)).status).toBe("complete");
  });
  it.each(["renew", "mark", "complete"])("rejects %s after the lease expires while waiting on another transaction", async operation => {
    const f = await fixture();
    const job = (await claim())!;
    await pool.query("UPDATE outbox_jobs SET next_attempt_at=clock_timestamp()+interval '100 milliseconds' WHERE id=$1", [f.id]);
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM outbox_jobs WHERE id=$1 FOR UPDATE", [f.id]);
      const renewal = operation === "renew" ? outbox.renewOutboxJob(pool,job) : operation === "mark" ? outbox.markOutboxJob(pool,job,"complete") : outbox.completeWalletOutboxJob(pool,job);
      await new Promise(resolve => setTimeout(resolve,180));
      await locker.query("COMMIT");
      expect(await renewal).toBe(false);
      expect((await state(f.id)).next_attempt_at.getTime()).toBeLessThan(Date.now());
    } finally { await locker.query("ROLLBACK"); locker.release(); }
  });
  it("rolls back a timed-out parent SQL write rather than allowing it to commit later", async () => {
    const f = await fixture();
    await expect(boundedWorkerDatabase(pool,{timeoutMs:50}).query("UPDATE outbox_jobs SET status='complete' WHERE id=$1 RETURNING pg_sleep(0.2)", [f.id])).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve,250));
    expect((await state(f.id)).status).toBe("pending");
  });
  it("fails an expired fifth claim and does not grant a sixth attempt", async () => {
    const f = await fixture();
    for (let attempt=1;attempt<=5;attempt++) {
      const claimed = (await claim())!;
      expect(claimed.attempts).toBe(attempt);
      await pool.query("UPDATE outbox_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [f.id]);
    }
    expect(await claim()).toBe(null);
    expect(await state(f.id)).toMatchObject({status:"failed",attempts:5});
  });
});
