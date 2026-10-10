import { createHmac, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { automationRuns, campaignAttempts, campaignRecipients, consentEvents, emailDeliveries, membershipContacts, outboxJobs } from "@/db/schema";
import { createMerchant, enroll } from "./product";
import { award } from "./loyalty";
import { createDraftCampaign, deliverCampaignRecipient, dispatchCampaign, scheduleCampaign } from "./campaigns";
import { deliverAutomationRun, processAutomationEvent, upsertAutomationRule } from "./automations";
import { mailgunEuProvider, promotionalProvider, recordMailgunWebhook, sendPromotional, sendTransactional } from "./transactional-email";

// Parent supplies and migrates a disposable local DB. No HTTP request can escape this suite.
const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/looplocal_test") {
  throw new Error("LOY-139 requires a loopback disposable looplocal_test database");
}
const syntheticEnv = {
  NODE_ENV: "test" as const, PUBLIC_BASE_URL: "https://app.example.test", SMTP_HOST: "disabled",
  BETTER_AUTH_SECRET: "synthetic-rate-limit-auth-secret-over-32-characters",
  EXTERNAL_EMAIL_ENABLED: "true", TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "true",
  PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "true", MAILGUN_SEND_APPROVED: "true", MAILGUN_PROMOTIONAL_SEND_APPROVED: "true",
  MAILGUN_EU_DOMAIN: "mail.example.test", MAILGUN_FROM_EMAIL: "service@mail.example.test",
  MAILGUN_EU_API_KEY: "synthetic-not-a-real-api-key",
  MAILGUN_EU_WEBHOOK_SIGNING_KEY: "synthetic-webhook-signing-key-over-32-characters",
  PROMOTIONAL_MONTHLY_LOCATION_LIMIT: "100", PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: "24",
  PROMOTIONAL_UNSUBSCRIBE_ORIGIN: "https://unsubscribe.example.test",
  PROMOTIONAL_UNSUBSCRIBE_SECRET: "synthetic-unsubscribe-secret-over-32-characters",
};
const recipient = "rate-limit-holder@example.test";
const execute = promisify(execFile);
const message = (jobId: string) => ({ to: recipient, subject: "Synthetic offer", body: "Synthetic content", jobId,
  unsubscribeUrl: "https://unsubscribe.example.test/unsubscribe#token=synthetic" });
const rejected = (reset: number) => new Response(null, { status: 429, headers: { "X-RateLimit-Reset": String(reset) } });
const accepted = () => Response.json({ id: "<synthetic-accepted@example.test>" });

beforeEach(async () => {
  for (const [key, value] of Object.entries(syntheticEnv)) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unstubbed HTTP forbidden"); }));
  await pool.query('TRUNCATE TABLE email_provider_events, email_suppressions, tenants, "user", demo_requests CASCADE');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await pool.end(); });

async function fixture(kind: "campaign" | "automation" = "campaign") {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  // Put the real quiet-hours policy at local noon, without mocking it or the clock.
  const offset = new Date().getUTCHours() - 12;
  const timezone = offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "+" : ""}${offset}`;
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Rate Limit Café", city: "Kassel", country: "DE",
    timezone, locale: "de", currency: "EUR", programName: "Synthetic Card", programType: "stamp", rulesText: "One stamp per checkout", rewardTitle: "Coffee", rewardCost: 8 });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: recipient, marketingOptIn: true });
  await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  if (kind === "campaign") {
    const campaign = await createDraftCampaign({ actorUserId: ownerId, programSlug: merchant.programSlug, title: "Synthetic offer",
      subject: "Synthetic offer", body: "Synthetic campaign content", audienceDefinition: { kind: "all" } });
    const when = new Date(Date.now() + 1000);
    await scheduleCampaign({ actorUserId: ownerId, campaignId: campaign.id, scheduledAt: when });
    const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(await dispatchCampaign(dispatch, new Date(when.getTime() + 1000))).toMatchObject({ queuedCount: 1 });
  } else {
    await upsertAutomationRule({ actorUserId: ownerId, programSlug: merchant.programSlug, triggerKind: "first_checkout", enabled: true,
      subject: "Synthetic offer", body: "Synthetic automation content", cooldownDays: 7, dailyCap: 20 });
    await award({ userId: ownerId, locationId: merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [event] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.event"));
    expect(await processAutomationEvent(event)).toMatchObject({ queuedCount: 1 });
  }
  const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, kind === "campaign" ? "email.campaign" : "email.automation"));
  // Fixture setup is already executed; leave only the delivery due for the actual worker.
  await pool.query("UPDATE outbox_jobs SET status='complete' WHERE id<>$1", [job.id]);
  return { job, card, merchant };
}

async function delivery(jobId: string) {
  // SELECT * intentionally lets the red tests compile before the nullable retry_at column exists.
  return (await pool.query("SELECT * FROM email_deliveries WHERE job_id=$1", [jobId])).rows[0];
}
async function expireBackoff(jobId: string) {
  // Simulate the persisted deadline becoming due; never sleep or add an application retry loop.
  await pool.query("UPDATE email_deliveries SET retry_at=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND status='rate_limited'", [jobId]);
}
function temporaryWebhook(jobId: string) {
  const timestamp = String(Math.floor(Date.now() / 1000)), token = randomUUID();
  return { signature: { timestamp, token, signature: createHmac("sha256", syntheticEnv.MAILGUN_EU_WEBHOOK_SIGNING_KEY).update(timestamp + token).digest("hex") },
    "event-data": { id: randomUUID(), event: "temporary_fail", recipient, "user-variables": { job_id: jobId } } };
}

describe("LOY-139 explicit Mailgun rate rejection", () => {
  it("maps HTTP 429 to rate_limited and honors X-RateLimit-Reset as UTC milliseconds", async () => {
    // Mailgun API overview: 429 rejects the request; X-RateLimit-Reset is UTC milliseconds.
    // https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview
    const reset = Date.now() + 120_123;
    const http = vi.fn(async () => rejected(reset));
    expect(await mailgunEuProvider(process.env, http as typeof fetch)!.send(message(randomUUID())))
      .toEqual({ state: "rate_limited", retryAt: new Date(reset) });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([null, "invalid", "-1", "Infinity", "0", String(Number.MAX_SAFE_INTEGER), String(Date.now() + 7_200_000), String(Math.floor(Date.now() / 1000))])("uses finite future backoff for unusable reset header %s", async header => {
    const started = Date.now();
    const http = vi.fn(async () => new Response(null, { status: 429, headers: header === null ? {} : { "X-RateLimit-Reset": header } }));
    const result = await mailgunEuProvider(process.env, http as typeof fetch)!.send(message(randomUUID()));
    expect(result).toMatchObject({ state: "rate_limited", retryAt: expect.any(Date) });
    if (result.state !== "rate_limited") throw new Error("Expected explicit rate rejection");
    const retryAt = result.retryAt.getTime();
    expect(retryAt).toBeGreaterThan(started);
    expect(retryAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit 429 non-retriable for transactional recovery and verification", async () => {
    const { job } = await fixture();
    const http = vi.fn(async () => rejected(Date.now() + 120_000));
    const provider = mailgunEuProvider(process.env, http as typeof fetch)!;
    expect(await sendTransactional(message(job.id), provider)).toMatchObject({ status: "blocked" });
    expect(await delivery(job.id)).toMatchObject({ status: "ambiguous", retry_at: null });
    expect(await sendTransactional(message(job.id), provider)).toMatchObject({ status: "blocked" });
    // Changing callers cannot turn a recovery reservation into a promotional retry.
    expect(await sendPromotional(message(job.id), provider)).toMatchObject({ status: "blocked" });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("persists rejection backoff and atomically retries the same job ID once after reset", async () => {
    const { job } = await fixture();
    const reset = Date.now() + 120_000;
    const http = vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      expect((options?.body as FormData).get("v:job_id")).toBe(job.id);
      expect((options?.body as FormData).get("to")).toBe(recipient);
      return accepted();
    }).mockImplementationOnce(async () => rejected(reset));
    const provider = promotionalProvider(process.env, http as typeof fetch)!;
    expect(await sendPromotional(message(job.id), provider)).toMatchObject({ status: "retry", retryAt: new Date(reset) });
    expect(await delivery(job.id)).toMatchObject({ status: "rate_limited", retry_at: new Date(reset), provider_message_id: null });
    // A fresh adapter instance must obey the persisted deadline after a process restart.
    expect(await sendPromotional(message(job.id), promotionalProvider(process.env, http as typeof fetch)!))
      .toMatchObject({ status: "retry", retryAt: new Date(reset) });
    expect(http).toHaveBeenCalledTimes(1);
    await expireBackoff(job.id);
    await Promise.all([sendPromotional(message(job.id), provider), sendPromotional(message(job.id), provider)]);
    expect(http).toHaveBeenCalledTimes(2);
    expect(await delivery(job.id)).toMatchObject({ status: "accepted", provider_message_id: "<synthetic-accepted@example.test>" });
    expect(await db.select().from(emailDeliveries)).toHaveLength(1);
    expect(await sendPromotional(message(job.id), provider)).toMatchObject({ status: "blocked" });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each(["accepted", "ambiguous", "5xx", "transport throw", "webhook temporary failure", "hard rejection"] as const)
    ("never replays %s through the real adapter and persisted reservation", async outcome => {
      const { job } = await fixture();
      const http = vi.fn(async () => {
        if (outcome === "transport throw") throw new Error("Synthetic transport failure");
        if (outcome === "5xx") return new Response(null, { status: 503 });
        if (outcome === "hard rejection") return new Response(null, { status: 400 });
        if (outcome === "ambiguous") return Response.json({ message: "Missing acceptance ID" });
        return accepted();
      });
      const provider = promotionalProvider(process.env, http as typeof fetch)!;
      const first = await sendPromotional(message(job.id), provider);
      expect(first.status).toBe(["accepted", "webhook temporary failure"].includes(outcome) ? "complete" : "blocked");
      if (outcome === "webhook temporary failure") {
        expect(await recordMailgunWebhook(temporaryWebhook(job.id))).toEqual({ accepted: true });
        expect((await delivery(job.id)).status).toBe("temporary_failure");
      }
      expect(await sendPromotional(message(job.id), provider)).toMatchObject({ status: "blocked" });
      expect(http).toHaveBeenCalledTimes(1);
      expect(await db.select().from(emailDeliveries)).toHaveLength(1);
    });
});

describe.each(["campaign", "automation"] as const)("LOY-139 %s marketing retry", kind => {
  const deliver = (job: Awaited<ReturnType<typeof fixture>>["job"], attempts: number, provider: NonNullable<ReturnType<typeof promotionalProvider>>) =>
    kind === "campaign" ? deliverCampaignRecipient({ ...job, attempts }, undefined, provider)
      : deliverAutomationRun({ ...job, attempts }, undefined, undefined, provider);

  it("retains queued state after rejection and completes the same job once after reset", async () => {
    const { job } = await fixture(kind);
    const reset = Date.now() + 120_000;
    const http = vi.fn(async () => accepted()).mockImplementationOnce(async () => rejected(reset));
    const provider = promotionalProvider(process.env, http as typeof fetch)!;
    expect(await deliver(job, 1, provider)).toMatchObject({ status: "retry", retryAt: new Date(reset) });
    const rows = kind === "campaign" ? await db.select().from(campaignRecipients) : await db.select().from(automationRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "queued", sentAt: null });
    await expireBackoff(job.id);
    expect(await deliver(job, 2, provider)).toMatchObject({ status: "complete" });
    expect(await deliver(job, 3, provider)).toMatchObject({ status: "complete" });
    expect(http).toHaveBeenCalledTimes(2);
    expect(await db.select().from(emailDeliveries)).toHaveLength(1);
    expect((await db.select().from(outboxJobs).where(eq(outboxJobs.kind, job.kind))).map(row => row.id)).toEqual([job.id]);
    if (kind === "campaign") expect((await db.select().from(campaignAttempts).orderBy(campaignAttempts.attempt)).map(row => row.status)).toEqual(["retry", "complete"]);
  });

  it("suppresses retry when consent is withdrawn after rate rejection", async () => {
    const { job, card, merchant } = await fixture(kind);
    const http = vi.fn(async () => rejected(Date.now() + 120_000));
    const provider = promotionalProvider(process.env, http as typeof fetch)!;
    expect(await deliver(job, 1, provider)).toMatchObject({ status: "retry" });
    await db.insert(consentEvents).values({ tenantId: merchant.tenantId, membershipId: card.id, channel: "email", purpose: "marketing",
      granted: false, noticeVersion: "synthetic", source: "synthetic", createdAt: new Date(Date.now() + 1000) });
    await expireBackoff(job.id);
    expect(await deliver(job, 2, provider)).toMatchObject({ status: "suppressed" });
    expect(http).toHaveBeenCalledTimes(1);
    const rows = kind === "campaign" ? await db.select().from(campaignRecipients) : await db.select().from(automationRuns);
    expect(rows[0]).toMatchObject({ status: "suppressed", sentAt: null });
  });

  it("actual worker honors reset and stops after five rejected attempts without a retry loop", async () => {
    const { job } = await fixture(kind);
    const root = path.resolve(__dirname, "../..");
    mkdirSync(path.join(root, "var"), { recursive: true });
    const dir = mkdtempSync(path.join(root, "var", "rate-limit-worker-"));
    const preload = path.join(dir, "http-only.cjs"), log = path.join(dir, "calls.jsonl");
    writeFileSync(log, "");
    writeFileSync(preload, `const fs = require('node:fs');
globalThis.fetch = async (input, options) => {
  if (String(input) !== 'https://api.eu.mailgun.net/v3/mail.example.test/messages' || options?.method !== 'POST') throw new Error('Unexpected HTTP forbidden');
  const body = options.body;
  if (!String(body.get('to')).endsWith('.test')) throw new Error('Only synthetic recipients allowed');
  fs.appendFileSync(process.env.LOY139_CALL_LOG, JSON.stringify({jobId:body.get('v:job_id'),to:body.get('to')})+'\\n');
  return new Response(null,{status:429,headers:{'X-RateLimit-Reset':process.env.LOY139_RESET}});
};\n`);
    const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const reset = Date.now() + 600_000;
    const runWorker = async () => {
      // Keep the runner's event loop available (including a parent-hosted synthetic DB).
      // An execution failure includes captured child output instead of a bare spawn timeout.
      const result = await execute(process.execPath, ["--require", preload, "--import", "tsx", "scripts/worker.ts", "--once"], {
        cwd: root, encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL",
        // Explicit synthetic configuration, no inherited provider credentials; dotenv cannot read .env.
        env: { ...syntheticEnv, PATH: process.env.PATH, DATABASE_URL: target.toString(), DOTENV_CONFIG_PATH: "/dev/null",
          PRODUCTION_ENVIRONMENT: "", PG_POOL_MAX: "5", APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false",
          PASSFAST_ENABLED: "false", LIVE_BILLING_ENABLED: "false", NFC_ENABLED: "false", LOY139_CALL_LOG: log, LOY139_RESET: String(reset) },
      }).catch((error: Error & { stdout?: string; stderr?: string }) => {
        throw new Error(`Synthetic worker execution failed: ${error.message}\n${error.stdout ?? ""}\n${error.stderr ?? ""}\nHTTP stub calls: ${calls().length}`);
      });
      expect(result.stdout).toContain("Worker examined");
    };
    try {
      await runWorker();
      let recorded = (await pool.query("SELECT status,attempts,next_attempt_at FROM outbox_jobs WHERE id=$1", [job.id])).rows[0];
      expect(recorded).toMatchObject({ status: "retry", attempts: 1 });
      expect(recorded.next_attempt_at.getTime()).toBeGreaterThanOrEqual(reset);
      expect(calls()).toEqual([{ jobId: job.id, to: recipient }]);
      await runWorker();
      expect(calls()).toHaveLength(1);
      expect((await pool.query("SELECT attempts FROM outbox_jobs WHERE id=$1", [job.id])).rows[0].attempts).toBe(1);
      for (let attempt = 2; attempt <= 5; attempt++) {
        await expireBackoff(job.id);
        await pool.query("UPDATE outbox_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1", [job.id]);
        await runWorker();
        recorded = (await pool.query("SELECT status,attempts FROM outbox_jobs WHERE id=$1", [job.id])).rows[0];
        expect(recorded).toEqual({ status: attempt === 5 ? "failed" : "retry", attempts: attempt });
        expect(calls()).toHaveLength(attempt);
      }
      await pool.query("UPDATE outbox_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1", [job.id]);
      await runWorker();
      expect(calls()).toHaveLength(5);
      expect(await db.select().from(emailDeliveries)).toHaveLength(1);
      const rows = kind === "campaign" ? await db.select().from(campaignRecipients) : await db.select().from(automationRuns);
      expect(rows[0]).toMatchObject({ status: "failed", sentAt: null });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
