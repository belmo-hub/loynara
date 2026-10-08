import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../src/db";
import { createMerchant, enroll } from "../src/lib/product";
import { award } from "../src/lib/loyalty";
import { issueWalletPass } from "../src/lib/wallet/issue";
import { passFastObjectId } from "../src/lib/wallet/passfast";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Requires isolated looplocal_test");
const target = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(target.hostname)) throw new Error("Worker rehearsal requires loopback database");
const root = path.resolve(__dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "loynara-combined-worker-"));
const preload = path.join(dir, "mock-provider.cjs"), callLog = path.join(dir, "calls.jsonl");
// No real HTTP path exists in this child. The fake rejects any unexpected origin before recording safe metadata.
writeFileSync(preload, `const fs = require('node:fs');
globalThis.fetch = async input => {
  const url = new URL(String(input));
  if (url.origin !== 'https://api.passfa.st') throw new Error('External network forbidden in worker rehearsal');
  fs.appendFileSync(process.env.COMBINED_MOCK_CALL_LOG, JSON.stringify({path:url.pathname,platform:url.searchParams.get('wallet_type')})+'\\n');
  return Response.json({error:'synthetic provider outage'},{status:503});
};
`);
const runWorker = (enabled: boolean) => {
  const result = spawnSync(process.execPath, ["--require", preload, "--import", "tsx", "scripts/worker.ts", "--once"], {
    cwd: root, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL: target.toString(), PRODUCTION_ENVIRONMENT: "", PG_POOL_MAX: "5",
      PASSFAST_ENABLED: String(enabled), PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: "11111111-1111-4111-8111-111111111111", PASSFAST_TEMPLATE_ID: "22222222-2222-4222-8222-222222222222", PASSFAST_WALLET_TYPES: "both",
      APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false", WALLET_PRODUCTION_APPROVED: "false", SMTP_HOST: "disabled",
      EXTERNAL_EMAIL_ENABLED: "false", TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "false", PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "false", LIVE_BILLING_ENABLED: "false",
      COMBINED_MOCK_CALL_LOG: callLog,
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("Worker examined");
  expect(result.stdout + result.stderr).not.toContain("sk_live_");
};
const calls = () => readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
async function fixture() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [owner, "Synthetic worker owner", `${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Synthetic Worker Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Worker Card", programType: "stamp", rulesText: "One confirmed visit", rewardTitle: "Coffee", rewardCost: 5 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  await issueWalletPass(member.cardToken, "apple", passFastObjectId);
  await issueWalletPass(member.cardToken, "google", passFastObjectId);
  await award({ userId: owner, locationId: merchant.locationId, membershipId: member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const jobs = (await pool.query("SELECT id FROM outbox_jobs WHERE kind='wallet.refresh' AND status='pending'")).rows;
  expect(jobs).toHaveLength(1);
  return { merchant, member, job: jobs[0].id };
}
beforeEach(async () => {
  for(const [key,value] of Object.entries({PASSFAST_ENABLED:"true",PASSFAST_API_KEY:"sk_live_synthetic_0123456789abcdef0123456789",PASSFAST_APP_ID:"11111111-1111-4111-8111-111111111111",PASSFAST_TEMPLATE_ID:"22222222-2222-4222-8222-222222222222"})) vi.stubEnv(key,value);
  await pool.query('TRUNCATE tenants, "user", rate_limits, apple_devices CASCADE'); writeFileSync(callLog, ""); });
afterEach(()=>vi.unstubAllEnvs());
afterAll(async () => { await pool.end(); rmSync(dir, { recursive: true, force: true }); });

describe("actual combined worker process with fake HTTP only", () => {
  it("starts providers OFF and blocks a synthetic existing Wallet job without contacting either platform or changing balance", async () => {
    const f = await fixture();
    runWorker(false);
    expect(calls()).toHaveLength(0);
    expect((await pool.query("SELECT status,attempts FROM outbox_jobs WHERE id=$1", [f.job])).rows[0]).toEqual({ status: "blocked", attempts: 1 });
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.member.id])).rows[0].balance).toBe(2);
  });
  it("attempts both failed platforms independently with bounded backoff and leaves the queue healthy after five attempts", async () => {
    const f = await fixture();
    for (const [index, delay] of [60, 240, 960, 3600, 0].entries()) {
      if (index) await pool.query("UPDATE outbox_jobs SET next_attempt_at=now() WHERE id=$1", [f.job]);
      runWorker(true);
      const job = (await pool.query("SELECT status,attempts,extract(epoch FROM next_attempt_at-clock_timestamp())::float AS remaining FROM outbox_jobs WHERE id=$1", [f.job])).rows[0];
      expect(job.status).toBe(index === 4 ? "failed" : "retry");
      expect(job.attempts).toBe(index + 1);
      if (delay) { expect(job.remaining).toBeGreaterThan(delay - 5); expect(job.remaining).toBeLessThanOrEqual(delay); }
      const attemptCalls = calls().slice(index * 2, index * 2 + 2);
      expect(new Set(attemptCalls.map(call => call.platform))).toEqual(new Set(["apple", "google"]));
    }
    expect(calls()).toHaveLength(10);
    const next = await enroll({ slug: f.merchant.programSlug, acceptedTerms: true });
    const job = (await pool.query("INSERT INTO outbox_jobs (tenant_id,kind,payload) VALUES ($1,'wallet.refresh',jsonb_build_object('membershipId',$2::text)) RETURNING id", [f.merchant.tenantId, next.id])).rows[0].id;
    runWorker(true);
    expect((await pool.query("SELECT status FROM outbox_jobs WHERE id=$1", [job])).rows[0].status).toBe("complete");
    expect(calls()).toHaveLength(10);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.member.id])).rows[0].balance).toBe(2);
  }, 120_000);
});
