import "dotenv/config";
import { pool } from "../src/db";
import { productionConfigIssues } from "./config-check";

type Job = {
  id: string;
  tenantId: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
};

const leaseMinutes = 5;
const maxAttempts = 5;
const pollMilliseconds = 5000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function claimJob(): Promise<Job | null> {
  await pool.query(
    "UPDATE outbox_jobs SET status = 'failed', last_error = 'Worker lease expired after retry limit' WHERE status = 'processing' AND next_attempt_at <= now() AND attempts >= $1",
    [maxAttempts],
  );
  const result = await pool.query<Job>(`
    WITH candidate AS (
      SELECT id FROM outbox_jobs
      WHERE next_attempt_at <= now() AND attempts < ${maxAttempts}
        AND (status IN ('pending', 'retry') OR status = 'processing')
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE outbox_jobs AS job
    SET status = 'processing', attempts = job.attempts + 1,
        next_attempt_at = now() + interval '${leaseMinutes} minutes', last_error = NULL
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.id, job.tenant_id AS "tenantId", job.kind, job.payload, job.attempts
  `);
  return result.rows[0] ?? null;
}

async function mark(job: Job, status: "complete" | "blocked" | "retry" | "failed" | "suppressed", reason?: string, delaySeconds = 0) {
  await pool.query(
    "UPDATE outbox_jobs SET status = $2, last_error = $3, next_attempt_at = now() + $4::int * interval '1 second' WHERE id = $1 AND status = 'processing' AND attempts = $5",
    [job.id, status, reason?.slice(0, 300) ?? null, delaySeconds, job.attempts],
  );
}

async function processJob(job: Job) {
  if (job.kind === "email.verify") {
    try {
      const { deliverVerificationEmail } = await import("../src/lib/contact-verification-delivery");
      const result = await deliverVerificationEmail(job);
      await mark(job, result.status, result.reason);
      return result.status;
    } catch (error) {
      const permanent = job.attempts >= maxAttempts;
      const delay = Math.min(3600, 10 * 2 ** (job.attempts - 1));
      await mark(job, permanent ? "failed" : "retry", "Local verification delivery failed", permanent ? 0 : delay);
      console.error(`Local verification job ${job.id} ${permanent ? "failed" : "scheduled for retry"} (${error instanceof Error ? error.name : "error"})`);
      return permanent ? "failed" : "retry";
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
      await mark(job, permanent ? "failed" : "retry", "Local campaign dispatch failed", permanent ? 0 : delay);
      console.error(`Campaign dispatch job ${job.id} ${permanent ? "failed" : "scheduled for retry"} (${error instanceof Error ? error.name : "error"})`);
      return permanent ? "failed" : "retry";
    }
  }
  if (job.kind === "email.campaign") {
    try {
      const { deliverCampaignRecipient } = await import("../src/lib/campaigns");
      const result = await deliverCampaignRecipient(job);
      const delay = result.status === "retry" ? Math.min(3600, 10 * 2 ** (job.attempts - 1)) : 0;
      await mark(job, result.status, result.reason, delay);
      return result.status;
    } catch (error) {
      const permanent = job.attempts >= maxAttempts;
      const delay = Math.min(3600, 10 * 2 ** (job.attempts - 1));
      await mark(job, permanent ? "failed" : "retry", "Local campaign delivery failed", permanent ? 0 : delay);
      console.error(`Local campaign job ${job.id} ${permanent ? "failed" : "scheduled for retry"} (${error instanceof Error ? error.name : "error"})`);
      return permanent ? "failed" : "retry";
    }
  }
  if (job.kind === "automation.event" || job.kind === "automation.scan" || job.kind === "email.automation") {
    try {
      const { processAutomationEvent, processAutomationScan, deliverAutomationRun } = await import("../src/lib/automations");
      const result = job.kind === "automation.event" ? await processAutomationEvent(job)
        : job.kind === "automation.scan" ? await processAutomationScan(job)
          : await deliverAutomationRun(job);
      const delay = result.status === "retry" ? Math.min(3600, 10 * 2 ** (job.attempts - 1)) : 0;
      await mark(job, result.status, result.reason, delay);
      return result.status;
    } catch (error) {
      const permanent = job.attempts >= maxAttempts;
      const delay = Math.min(3600, 10 * 2 ** (job.attempts - 1));
      await mark(job, permanent ? "failed" : "retry", "Local automation processing failed", permanent ? 0 : delay);
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
    const { refreshWalletForMembership } = await import("../src/lib/wallet/refresh");
    const result = await refreshWalletForMembership(membershipId);
    if (result.status === "blocked") {
      await mark(job, "blocked", result.reason);
      return "blocked";
    }
    await mark(job, "complete");
    return "complete";
  } catch (error) {
    const permanent = job.attempts >= maxAttempts;
    const delay = Math.min(3600, 10 * 2 ** (job.attempts - 1));
    // Provider messages can contain request details. Keep the stored error generic.
    await mark(job, permanent ? "failed" : "retry", "Wallet provider update failed", permanent ? 0 : delay);
    console.error(`Wallet job ${job.id} ${permanent ? "failed" : "scheduled for retry"} (${error instanceof Error ? error.name : "error"})`);
    return permanent ? "failed" : "retry";
  }
}

async function replay(jobId: string) {
  if (!uuidPattern.test(jobId)) throw new Error("Replay requires a job UUID");
  const result = await pool.query(
    "UPDATE outbox_jobs SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL WHERE id = $1 AND status IN ('blocked', 'failed') RETURNING id",
    [jobId],
  );
  if (result.rowCount !== 1) throw new Error("Job is not blocked or failed, or it does not exist");
  console.log(`Requeued job ${jobId}`);
}

async function main() {
  const configurationIssues = productionConfigIssues(process.env);
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
    let processed = 0;
    const counts: Record<string, number> = {};
    while (!stopping && processed < 1000) {
      const job = await claimJob();
      if (!job) break;
      const outcome = await processJob(job);
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      processed += 1;
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
