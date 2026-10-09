import "dotenv/config";
import { Pool } from "pg";
import { pool } from "../src/db";
import { claimOutboxJob, completeWalletOutboxJob, deferOutboxJob, markOutboxJob, renewOutboxJob, type OutboxJob, type OutboxStatus } from "../src/lib/outbox";
import { replayOutboxJob } from "../src/lib/outbox-replay";
import { productionConfigIssues } from "./config-check";
import { productionWalletRuntimeIssues } from "./wallet-runtime-config";
import { sendWorkerHeartbeat, validHeartbeatUrl } from "./ops-heartbeat";
import { boundedWorkerDatabase } from "./worker-database";
import { startWorkerMonitor } from "./worker-monitor";
import { superviseWalletJob, walletJobLifetimeMs } from "./worker-supervisor";

type Job = OutboxJob;

const leaseMinutes = 5;
const maxAttempts = 5;
const pollMilliseconds = 5000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let stopping = false;
let recoveryPrunedAt = 0;
const shutdown = new AbortController();
const stop = () => { stopping = true; shutdown.abort(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const workerDatabase = boundedWorkerDatabase(pool);
// Monitoring never occupies the parent pool needed to renew an active job.
const monitorPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });

const claimJob = () => claimOutboxJob(workerDatabase, { maxAttempts, leaseMinutes });
const mark = (job: Job, status: OutboxStatus, reason?: string, delaySeconds = 0) => markOutboxJob(workerDatabase, job, status, reason, delaySeconds);
const defer = (job: Job, reason: string, until: Date) => deferOutboxJob(workerDatabase, job, reason, until);

async function processJob(job: Job, claimedAt: number) {
  if (job.kind === "email.verify") {
    try {
      const { deliverVerificationEmail } = await import("../src/lib/contact-verification-delivery");
      const result = await deliverVerificationEmail(job);
      await mark(job, result.status, "reason" in result ? result.reason : undefined);
      return result.status;
    } catch (error) {
      await mark(job, "blocked", "Verification outcome uncertain; operator review required");
      console.error(`Verification job ${job.id} blocked (${error instanceof Error ? error.name : "error"})`);
      return "blocked";
    }
  }
  if (job.kind === "email.recover") {
    try {
      const { deliverRecoveryEmail } = await import("../src/lib/card-recovery-delivery");
      const result = await deliverRecoveryEmail(job);
      await mark(job, result.status, "reason" in result ? result.reason : undefined);
      return result.status;
    } catch (error) {
      await mark(job, "blocked", "Recovery delivery outcome uncertain; operator review required");
      console.error(`Recovery job ${job.id} blocked (${error instanceof Error ? error.name : "error"})`);
      return "blocked";
    }
  }
  if (job.kind === "email.recovery_notice") {
    try {
      const { deliverRecoveryNotice } = await import("../src/lib/card-recovery-delivery");
      const result = await deliverRecoveryNotice(job);
      await mark(job, result.status, "reason" in result ? result.reason : undefined);
      return result.status;
    } catch (error) {
      await mark(job, "blocked", "Security notice outcome uncertain; operator review required");
      console.error(`Security notice job ${job.id} blocked (${error instanceof Error ? error.name : "error"})`);
      return "blocked";
    }
  }
  if (job.kind === "campaign.dispatch") {
    try {
      const { dispatchCampaign } = await import("../src/lib/campaigns");
      const result = await dispatchCampaign(job);
      await mark(job, result.status, result.reason);
      return result.status;
    } catch (error) {
      const permanent = job.attempts >= maxAttempts;
      const delay = Math.min(3600, 10 * 2 ** (job.attempts - 1));
      await mark(job, permanent ? "failed" : "retry", "Campaign dispatch failed", permanent ? 0 : delay);
      console.error(`Campaign dispatch job ${job.id} ${permanent ? "failed" : "scheduled for retry"} (${error instanceof Error ? error.name : "error"})`);
      return permanent ? "failed" : "retry";
    }
  }
  if (job.kind === "email.campaign") {
    try {
      const { deliverCampaignRecipient } = await import("../src/lib/campaigns");
      const result = await deliverCampaignRecipient(job);
      if (result.status === "deferred") { await defer(job, result.reason, result.until); return "retry"; }
      const delay = result.status === "retry" ? Math.min(3600, 10 * 2 ** (job.attempts - 1)) : 0;
      await mark(job, result.status, result.reason, delay);
      return result.status;
    } catch (error) {
      const permanent = job.attempts >= maxAttempts;
      const delay = Math.min(3600, 10 * 2 ** (job.attempts - 1));
      await mark(job, permanent ? "failed" : "retry", "Campaign delivery failed or is uncertain", permanent ? 0 : delay);
      console.error(`Campaign job ${job.id} ${permanent ? "failed" : "scheduled for retry"} (${error instanceof Error ? error.name : "error"})`);
      return permanent ? "failed" : "retry";
    }
  }
  if (job.kind === "automation.event" || job.kind === "automation.scan" || job.kind === "email.automation") {
    try {
      const { processAutomationEvent, processAutomationScan, deliverAutomationRun } = await import("../src/lib/automations");
      const result = job.kind === "automation.event" ? await processAutomationEvent(job)
        : job.kind === "automation.scan" ? await processAutomationScan(job)
          : await deliverAutomationRun(job);
      if (result.status === "deferred") { await defer(job, result.reason, result.until); return "retry"; }
      const delay = result.status === "retry" ? Math.min(3600, 10 * 2 ** (job.attempts - 1)) : 0;
      await mark(job, result.status, result.reason, delay);
      return result.status;
    } catch (error) {
      const permanent = job.attempts >= maxAttempts;
      const delay = Math.min(3600, 10 * 2 ** (job.attempts - 1));
      await mark(job, permanent ? "failed" : "retry", "Automation processing failed", permanent ? 0 : delay);
      console.error(`Automation job ${job.id} ${permanent ? "failed" : "scheduled for retry"} (${error instanceof Error ? error.name : "error"})`);
      return permanent ? "failed" : "retry";
    }
  }
  if (job.kind === "email.marketing") {
    try {
      const { deliverMarketingEmail } = await import("../src/lib/email");
      const result = await deliverMarketingEmail({ id: job.id, tenantId: job.tenantId, payload: job.payload });
      await mark(job, result.status, result.reason);
      return result.status;
    } catch (error) {
      const permanent = job.attempts >= maxAttempts;
      const delay = Math.min(3600, 10 * 2 ** (job.attempts - 1));
      await mark(job, permanent ? "failed" : "retry", "Local Mailpit delivery failed", permanent ? 0 : delay);
      console.error(`Local email job ${job.id} ${permanent ? "failed" : "scheduled for retry"} (${error instanceof Error ? error.name : "error"})`);
      return permanent ? "failed" : "retry";
    }
  }
  if (job.kind === "push.tap_pending") {
    // NFC wake-up for cashier phones. Usually already sent by the web process right after the tap; this is the retry path.
    try {
      const { deliverTapPush } = await import("../src/lib/staff-push");
      const outcome = await deliverTapPush(job);
      const status = outcome.status === "retry" && job.attempts >= maxAttempts ? "failed" : outcome.status;
      await mark(job, status, outcome.reason, status === "retry" ? outcome.delaySeconds ?? 15 : 0);
      return status;
    } catch (error) {
      const permanent = job.attempts >= maxAttempts;
      await mark(job, permanent ? "failed" : "retry", "NFC push delivery failed", permanent ? 0 : 15);
      console.error(`NFC push job ${job.id} ${permanent ? "failed" : "scheduled for retry"} (${error instanceof Error ? error.name : "error"})`);
      return permanent ? "failed" : "retry";
    }
  }
  if (job.kind !== "wallet.refresh") {
    await mark(job, "failed", "Unknown job kind");
    return "failed";
  }
  const membershipId = job.payload?.membershipId;
  if (typeof membershipId !== "string" || !uuidPattern.test(membershipId)) {
    await mark(job, "failed", "Invalid wallet job payload");
    return "failed";
  }

  const deadline = claimedAt + walletJobLifetimeMs;
  const walletDatabase = boundedWorkerDatabase(pool, { deadline });
  const outcome = await superviseWalletJob({ job, deadline, signal: shutdown.signal,
    renew: () => renewOutboxJob(walletDatabase, job, leaseMinutes),
  });
  if (outcome.status === "lease_lost") {
    // An unknown renewal result also loses local ownership. Reconciliation belongs to a later durable claim.
    stop();
    return "lease_lost";
  }
  if (outcome.status === "complete") {
    const owned = await completeWalletOutboxJob(walletDatabase, job);
    if (!owned) stop();
    return owned ? "complete" : "lease_lost";
  }
  const permanent = job.attempts >= maxAttempts;
  const status = outcome.status === "blocked" ? "blocked" : permanent ? "failed" : "retry";
  const delay = status === "retry" ? Math.min(3600, 60 * 4 ** (job.attempts - 1)) : 0;
  const owned = await markOutboxJob(walletDatabase, job, status,
    status === "blocked" ? "Wallet provider unavailable" : "Wallet provider update failed or is uncertain", delay);
  if (!owned) stop();
  return owned ? status : "lease_lost";
}

async function replay(jobId: string) {
  const status = await replayOutboxJob(pool, jobId);
  console.log(status === "suppressed" ? `Job ${jobId} is covered by an existing Wallet refresh` : `Requeued job ${jobId}`);
}

async function main() {
  const configurationIssues = [...productionConfigIssues(process.env), ...productionWalletRuntimeIssues(process.env)];
  if (process.env.NODE_ENV === "production" && !validHeartbeatUrl(process.env.WORKER_HEARTBEAT_URL)) {
    configurationIssues.push("Production worker requires a reviewed HTTPS heartbeat monitor URL");
  }
  if (configurationIssues.length) throw new Error(`Worker configuration rejected: ${configurationIssues.join("; ")}`);
  const args = process.argv.slice(2);
  if (args[0] === "--replay") {
    if (args.length !== 2) throw new Error("Usage: npm run worker -- --replay <job-uuid>");
    await replay(args[1]);
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== "--once")) throw new Error("Usage: npm run worker -- [--once | --replay <job-uuid>]");
  const once = args[0] === "--once";
  const stopMonitor = !once && process.env.NODE_ENV === "production" ? startWorkerMonitor({
    heartbeat: async signal => {
      await boundedWorkerDatabase(monitorPool, { signal }).query("select 1");
      if (!signal.aborted) await sendWorkerHeartbeat(process.env.WORKER_HEARTBEAT_URL, fetch, signal);
    },
    onFailure: () => { console.error("Worker monitoring deadline exceeded"); stop(); },
  }) : async () => {};
  try {
    do {
      if (Date.now() - recoveryPrunedAt >= 60 * 60_000) {
        await workerDatabase.query("DELETE FROM card_recovery_challenges WHERE expires_at <= now() OR consumed_at IS NOT NULL");
        await workerDatabase.query("DELETE FROM contact_verification_challenges WHERE expires_at <= now() OR consumed_at IS NOT NULL");
        const { pruneRevokedAppleRegistrations } = await import("../src/lib/wallet/refresh");
        await pruneRevokedAppleRegistrations(workerDatabase);
        recoveryPrunedAt = Date.now();
      }
      let processed = 0;
      const counts: Record<string, number> = {};
      while (!stopping && processed < 1000) {
        const claimedAt = Date.now();
        const job = await claimJob();
        if (!job) break;
        const outcome = await processJob(job, claimedAt);
        counts[outcome] = (counts[outcome] ?? 0) + 1;
        processed += 1;
      }
      if (once) {
        console.log(`Worker examined ${processed} due job(s): ${JSON.stringify(counts)}`);
        break;
      }
      if (!stopping) await new Promise<void>(resolve => {
        const onStop = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { shutdown.signal.removeEventListener("abort", onStop); resolve(); }, pollMilliseconds);
        shutdown.signal.addEventListener("abort", onStop, { once: true });
      });
    } while (!stopping);
  } finally { await stopMonitor(); }
}

async function closePools() {
  const timer = setTimeout(() => process.exit(1), 5000);
  await Promise.all([pool.end(), monitorPool.end()]);
  clearTimeout(timer);
}
main().then(closePools, async () => {
  // Failures can originate in database connection strings; log only a fixed message.
  console.error("Worker failed; check reviewed configuration and database availability");
  stop();
  await closePools();
  process.exitCode = 1;
});
