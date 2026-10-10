import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { membershipContacts, outboxJobs } from "../src/db/schema";
import { createMerchant, enroll } from "../src/lib/product";
import { createDraftCampaign, dispatchCampaign, scheduleCampaign } from "../src/lib/campaigns";
import { claimOutboxJob, deferOutboxJob } from "../src/lib/outbox";

const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/looplocal_test") {
  throw new Error("Deferral recovery requires a disposable loopback looplocal_test database");
}
const syntheticEnv = {
  NODE_ENV: "test" as const, PUBLIC_BASE_URL: "http://localhost:3000", SMTP_HOST: "localhost",
  BETTER_AUTH_SECRET: "synthetic-deferral-auth-secret-over-32-characters",
  EXTERNAL_EMAIL_ENABLED: "false", TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "false",
  PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "false", MAILGUN_SEND_APPROVED: "false",
  MAILGUN_PROMOTIONAL_SEND_APPROVED: "false", MAILGUN_EU_API_KEY: "",
  PROMOTIONAL_MONTHLY_LOCATION_LIMIT: "100", PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: "24",
};
beforeEach(async () => {
  for (const [key, value] of Object.entries(syntheticEnv)) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External HTTP forbidden"); }));
  await pool.query('TRUNCATE TABLE email_provider_events, email_suppressions, tenants, "user", demo_requests CASCADE');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await pool.end(); });

async function fixture() {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  // UTC offsets supported by Etc/GMT put the real quiet-hours policy at 00:xx or 23:xx.
  const hour = new Date().getUTCHours(), offset = hour > 12 ? hour - 23 : hour;
  const timezone = offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "+" : ""}${offset}`;
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Deferral Café", city: "Kassel", country: "DE",
    timezone, locale: "de", currency: "EUR", programName: "Synthetic Card", programType: "stamp", rulesText: "One stamp per checkout", rewardTitle: "Coffee", rewardCost: 8 });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: "deferral-holder@example.test", marketingOptIn: true });
  await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  const campaign = await createDraftCampaign({ actorUserId: ownerId, programSlug: merchant.programSlug, title: "Synthetic offer",
    subject: "Synthetic offer", body: "Synthetic campaign", audienceDefinition: { kind: "all" } });
  const when = new Date(Date.now() + 1000);
  await scheduleCampaign({ actorUserId: ownerId, campaignId: campaign.id, scheduledAt: when });
  const [dispatch] = await db.select().from(outboxJobs).where(and(eq(outboxJobs.kind, "campaign.dispatch"), eq(outboxJobs.tenantId, merchant.tenantId)));
  expect(await dispatchCampaign(dispatch, new Date(when.getTime() + 1000))).toMatchObject({ queuedCount: 1 });
  const [job] = await db.select().from(outboxJobs).where(and(eq(outboxJobs.kind, "email.campaign"), eq(outboxJobs.tenantId, merchant.tenantId)));
  await pool.query("UPDATE outbox_jobs SET status='complete' WHERE id<>$1 AND tenant_id=$2", [job.id, merchant.tenantId]);
  return job;
}
async function snapshot(id: string) {
  return (await pool.query("SELECT status, attempts, next_attempt_at, last_error FROM outbox_jobs WHERE id=$1", [id])).rows[0];
}
async function expire(id: string) {
  await pool.query("UPDATE outbox_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
}
async function waitFor(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!await condition()) {
    if (Date.now() >= deadline) throw new Error("Synthetic worker barrier timed out");
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}
function worker(preload: string, marker: string, release: string, pause: boolean) {
  const child = spawn(process.execPath, ["--require", preload, "--import", "tsx", "scripts/worker.ts", "--once"], {
    cwd: process.cwd(), env: { ...process.env, ...syntheticEnv, DEFER_MARKER: marker, DEFER_RELEASE: release, DEFER_PAUSE: String(pause) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timeout = setTimeout(() => { child.kill("SIGCONT"); child.kill("SIGKILL"); }, 15000);
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const done = new Promise<string>((resolve, reject) => {
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("exit", code => {
      clearTimeout(timeout);
      if (code === 0) resolve(output);
      else reject(new Error(`Synthetic worker exit ${code}: ${output}`));
    });
  });
  return { child, done };
}

describe("quiet-hours deferral ownership", () => {
  it("does not reschedule an expired claim even before a replacement claims it", async () => {
    const job = await fixture();
    const claim = (await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 }))!;
    expect(claim.id).toBe(job.id);
    await expire(job.id);
    const before = await snapshot(job.id);
    await deferOutboxJob(pool, claim, "Quiet hours", new Date(Date.now() + 3600000));
    expect(await snapshot(job.id)).toEqual(before);
  });

  it("allows only the replacement owner to defer once and leaves another tenant untouched", async () => {
    const job = await fixture();
    const stale = (await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 }))!;
    await expire(job.id);
    const replacement = (await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 }))!;
    expect(replacement.attempts).toBe(2);
    const foreign = await fixture(), foreignBefore = await snapshot(foreign.id);
    const before = await snapshot(job.id), until = new Date(Date.now() + 3600000);
    expect(await deferOutboxJob(pool, stale, "Quiet hours", until)).toBe(false);
    expect(await snapshot(job.id)).toEqual(before);
    expect(await deferOutboxJob(pool, replacement, "Quiet hours", until)).toBe(true);
    expect(await snapshot(job.id)).toEqual({ status: "retry", attempts: 1, next_attempt_at: until, last_error: "Quiet hours" });
    expect(await deferOutboxJob(pool, replacement, "Repeated outcome", new Date(Date.now() + 7200000))).toBe(false);
    expect(await snapshot(job.id)).toEqual({ status: "retry", attempts: 1, next_attempt_at: until, last_error: "Quiet hours" });
    expect(await snapshot(foreign.id)).toEqual(foreignBefore);
  });

  it("checks lease expiry after obtaining a contended row lock", async () => {
    const job = await fixture();
    const claim = (await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 }))!;
    const locker = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await pool.query("UPDATE outbox_jobs SET next_attempt_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1", [job.id]);
      const lease = (await snapshot(job.id)).next_attempt_at;
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM outbox_jobs WHERE id=$1 FOR UPDATE", [job.id]);
      pending = deferOutboxJob(pool, claim, "Quiet hours", new Date(Date.now() + 3600000));
      await waitFor(async () => (await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%attempts = attempts - 1%'")).rowCount! > 0);
      // The statement starts while the lease is valid, then waits until the real database clock expires it.
      expect((await pool.query("SELECT query_start < $1::timestamptz AS started_before_expiry FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%attempts = attempts - 1%'", [lease])).rows).toEqual([{ started_before_expiry: true }]);
      await waitFor(async () => (await pool.query("SELECT clock_timestamp() >= $1::timestamptz AS expired", [lease])).rows[0].expired);
      await locker.query("COMMIT");
      await pending;
      expect(await snapshot(job.id)).toMatchObject({ status: "processing", attempts: 1 });
      expect((await snapshot(job.id)).next_attempt_at.getTime()).toBeLessThan(Date.now());
    } finally {
      await locker.query("ROLLBACK");
      await pending?.catch(() => {});
      locker.release();
    }
  });

  it("fences a paused real worker and lets its replacement defer once without sending", async () => {
    const job = await fixture();
    const directory = mkdtempSync(path.join(tmpdir(), "loynara-deferral-"));
    const preload = path.join(directory, "barrier.cjs"), marker = path.join(directory, "claimed"), release = path.join(directory, "release");
    // Only adds a deterministic pause before actual SQL. Provider I/O is forbidden in both processes.
    writeFileSync(preload, `const fs=require('node:fs'); const pg=require(${JSON.stringify(path.resolve("node_modules/pg"))});
const original=pg.Client.prototype.query; let paused=false;
pg.Client.prototype.query=function(...args){ const text=typeof args[0]==='string'?args[0]:args[0]?.text;
if(process.env.DEFER_PAUSE==='true'&&!paused&&text?.includes('attempts = attempts - 1')){paused=true;fs.writeFileSync(process.env.DEFER_MARKER,'claimed');
return new Promise(resolve=>{const timer=setInterval(()=>{if(fs.existsSync(process.env.DEFER_RELEASE)){clearInterval(timer);resolve();}},10);}).then(()=>original.apply(this,args));}
return original.apply(this,args);};
global.fetch=async()=>{throw new Error('External HTTP forbidden');};`);
    const workers: ReturnType<typeof worker>[] = [];
    const startWorker = (pause: boolean) => {
      const running = worker(preload, marker, release, pause);
      workers.push(running);
      void running.done.catch(() => {});
      return running;
    };
    const paused = startWorker(true);
    // Attach a rejection handler immediately so failed cleanup cannot create an unhandled rejection.
    void paused.done.catch(() => {});
    try {
      await waitFor(() => existsSync(marker));
      expect(await snapshot(job.id)).toMatchObject({ status: "processing", attempts: 1 });
      expect(paused.child.kill("SIGSTOP")).toBe(true);
      await expire(job.id);
      const expired = await snapshot(job.id);
      writeFileSync(release, "resume");
      expect(paused.child.kill("SIGCONT")).toBe(true);
      expect(await paused.done).toContain('"lease_lost":1');
      expect(await snapshot(job.id)).toEqual(expired);
      const replacement = startWorker(false);
      expect(await replacement.done).toContain('"retry":1');
      expect(await snapshot(job.id)).toMatchObject({ status: "retry", attempts: 1, last_error: "Quiet hours in the location's timezone" });
      expect((await snapshot(job.id)).next_attempt_at.getTime()).toBeGreaterThan(Date.now());
      expect(await startWorker(false).done).toContain("Worker examined 0 due job(s)");
      expect((await pool.query("SELECT status FROM campaign_recipients WHERE id=$1", [job.payload.recipientId])).rows).toEqual([{ status: "queued" }]);
      expect((await pool.query("SELECT count(*)::int AS count FROM campaign_attempts")).rows[0].count).toBe(0);
      expect((await pool.query("SELECT count(*)::int AS count FROM email_deliveries")).rows[0].count).toBe(0);
    } finally {
      for (const running of workers) {
        if (running.child.exitCode === null) { running.child.kill("SIGCONT"); running.child.kill("SIGKILL"); }
        await running.done.catch(() => {});
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
