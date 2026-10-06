import "dotenv/config";
import { pool } from "../src/db";
import { claimOutboxJob, deferOutboxJob, markOutboxJob, type OutboxJob, type OutboxStatus } from "../src/lib/outbox";
import { replayOutboxJob } from "../src/lib/outbox-replay";
import { productionConfigIssues } from "./config-check";
import { productionWalletRuntimeIssues } from "./wallet-runtime-config";
import { sendWorkerHeartbeat, validHeartbeatUrl } from "./ops-heartbeat";

type Job = OutboxJob;

const leaseMinutes = 5;
const maxAttempts = 5;
const pollMilliseconds = 5000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let stopping = false;
let recoveryPrunedAt = 0;
let heartbeatSentAt = 0;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const claimJob = () => claimOutboxJob(pool, { maxAttempts, leaseMinutes });
const mark = (job: Job, status: OutboxStatus, reason?: string, delaySeconds = 0) => markOutboxJob(pool, job, status, reason, delaySeconds);
const defer = (job: Job, reason: string, until: Date) => deferOutboxJob(pool, job, reason, until);

async function processJob(job: Job) {
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
  if (job.kind !== "wallet.refresh") {
    await mark(job, "failed", "Unknown job kind");
    return "failed";
  }
  const membershipId = job.payload?.membershipId;
  if (typeof membershipId !== "string" || !uuidPattern.test(membershipId)) {
    await mark(job, "failed", "Invalid wallet job payload");
    return "failed";
  }

  try {
    const { refreshWalletForMembership, supersedeOlderWalletRefreshes } = await import("../src/lib/wallet/refresh");
    const result = await refreshWalletForMembership(membershipId, { expectedTenantId: job.tenantId });
    if (result.status === "blocked") {
      await mark(job, "blocked", result.reason);
      return "blocked";
    }
    await mark(job, "complete");
    await supersedeOlderWalletRefreshes(pool, job);
    return "complete";
  } catch (error) {
    const permanent = job.attempts >= maxAttempts;
    // Provider outages last minutes to hours: 1, 4, 16 and 60 minutes span about 80 minutes before the job fails. A
    // later loyalty change queues a fresh refresh anyway, and its success supersedes this one.
    const delay = Math.min(3600, 60 * 4 ** (job.attempts - 1));
    // Provider messages can contain request details. Keep the stored error generic.
    await mark(job, permanent ? "failed" : "retry", "Wallet provider update failed", permanent ? 0 : delay);
    console.error(`Wallet job ${job.id} ${permanent ? "failed" : "scheduled for retry"} (${error instanceof Error ? error.name : "error"})`);
    return permanent ? "failed" : "retry";
  }
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
  do {
    if (Date.now() - recoveryPrunedAt >= 60 * 60_000) {
      await pool.query("DELETE FROM card_recovery_challenges WHERE expires_at <= now() OR consumed_at IS NOT NULL");
      await pool.query("DELETE FROM contact_verification_challenges WHERE expires_at <= now() OR consumed_at IS NOT NULL");
      const { pruneRevokedAppleRegistrations } = await import("../src/lib/wallet/refresh");
      await pruneRevokedAppleRegistrations(pool);
      recoveryPrunedAt = Date.now();
    }
    let processed = 0;
    const counts: Record<string, number> = {};
    while (!stopping && processed < 1000) {
      const job = await claimJob();
      if (!job) break;
      const outcome = await processJob(job);
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      processed += 1;
    }
    if (!once && process.env.NODE_ENV === "production" && Date.now() - heartbeatSentAt >= 60_000) {
      await pool.query("select 1");
      await sendWorkerHeartbeat(process.env.WORKER_HEARTBEAT_URL);
      heartbeatSentAt = Date.now();
    }
    if (once) {
      console.log(`Worker examined ${processed} due job(s): ${JSON.stringify(counts)}`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
  } while (!stopping);
}

main().then(() => pool.end(), async (error) => {
  console.error(error instanceof Error ? error.message : "Worker failed");
  await pool.end();
  process.exitCode = 1;
});
