import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { createMerchant } from "@/lib/product";
import { claimOutboxJob } from "@/lib/outbox";
import { replayOutboxJob } from "@/lib/outbox-replay";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices CASCADE'); });
afterAll(async () => { await pool.end(); });
const run = promisify(execFile);

async function tenant() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Replay fixture", `${owner}@example.test`]);
  return (await createMerchant({ userId: owner, businessName: "Replay Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 5 })).tenantId;
}
async function job(tenantId: string, membershipId: string, status: string, kind = "wallet.refresh") {
  const result = await pool.query<{ id: string }>("INSERT INTO outbox_jobs (tenant_id, kind, status, attempts, payload) VALUES ($1,$2,$3::varchar(12),CASE WHEN $3::varchar(12) = 'pending' THEN 0 ELSE 5 END,jsonb_build_object('membershipId',$4::text,'coalescingVersion','1')) RETURNING id", [tenantId, kind, status, membershipId]);
  return result.rows[0].id;
}
const replay = (id: string) => run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/worker.ts", "--replay", id], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false" } });
const state = async (id: string) => pool.query("SELECT status, attempts, payload FROM outbox_jobs WHERE id = $1", [id]).then(result => result.rows[0]);

describe("Worker replay with coalesced Wallet jobs", () => {
  it("handles a refresh committing after the replay lookup without exposing a unique-constraint error", async () => {
    const tenantId = await tenant();
    const membershipId = randomUUID();
    const failed = await job(tenantId, membershipId, "failed");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO outbox_jobs (tenant_id,kind,payload) VALUES ($1,'wallet.refresh',jsonb_build_object('membershipId',$2::text,'coalescingVersion','1'))", [tenantId, membershipId]);
      const replaying = replayOutboxJob(pool, failed);
      const deadline = Date.now() + 5000;
      while (true) {
        const result = await pool.query<{ waiting: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0 AND query ILIKE '%outbox_jobs%') AS waiting");
        if (result.rows[0].waiting) break;
        if (Date.now() >= deadline) throw new Error("Replay did not reach the concurrent pending-job conflict");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await client.query("COMMIT");
      expect(await replaying).toBe("suppressed");
      expect(await state(failed)).toMatchObject({ status: "suppressed" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("suppresses a failed replay already covered by a pending refresh and leaves that refresh claimable", async () => {
    const tenantId = await tenant();
    const membershipId = randomUUID();
    const failed = await job(tenantId, membershipId, "failed");
    const current = await job(tenantId, membershipId, "pending");
    await expect(replay(failed)).resolves.toHaveProperty("stdout");
    expect(await state(failed)).toMatchObject({ status: "suppressed" });
    expect(await state(current)).toMatchObject({ status: "pending", payload: { membershipId, coalescingVersion: "1" } });
    await expect(replay(failed)).resolves.toHaveProperty("stdout");
    expect(await state(current)).toMatchObject({ status: "pending" });
    expect(await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 })).toMatchObject({ id: current, payload: { membershipId } });
  });

  it("requeues a blocked Wallet job when the other card's job or another tenant's job is pending", async () => {
    const tenantId = await tenant();
    const otherTenant = await tenant();
    const membershipId = randomUUID();
    const blocked = await job(tenantId, membershipId, "blocked");
    await job(tenantId, randomUUID(), "pending");
    await job(otherTenant, membershipId, "pending");
    await replay(blocked);
    expect(await state(blocked)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("keeps non-Wallet replay behavior and resets its attempts", async () => {
    const failed = await job(await tenant(), randomUUID(), "failed", "email.marketing");
    await replay(failed);
    expect(await state(failed)).toMatchObject({ status: "pending", attempts: 0 });
  });
});
