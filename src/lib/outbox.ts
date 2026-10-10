import type { Pool } from "pg";

export type OutboxJob = {
  id: string;
  tenantId: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  /** Present on durable claims; absent legacy/unclaimed jobs cannot authorize an outcome. */
  claimToken?: string;
};
export type OutboxStatus = "complete" | "blocked" | "retry" | "failed" | "suppressed";

type Limits = { maxAttempts: number; leaseMinutes: number };

/**
 * Takes the oldest due job under a lease. Each claim spends one attempt; a job whose lease expired on its last attempt
 * is failed instead of being retried forever.
 */
export async function claimOutboxJob(pool: Pick<Pool, "query">, { maxAttempts, leaseMinutes }: Limits): Promise<OutboxJob | null> {
  await pool.query(
    "UPDATE outbox_jobs SET status = 'failed', last_error = 'Worker lease expired after retry limit' WHERE status = 'processing' AND next_attempt_at <= now() AND attempts >= $1",
    [maxAttempts],
  );
  const result = await pool.query<OutboxJob>(`
    WITH candidate AS (
      SELECT id FROM outbox_jobs
      WHERE next_attempt_at <= now() AND attempts < ${Number(maxAttempts)}
        AND (status IN ('pending', 'retry') OR status = 'processing')
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE outbox_jobs AS job
    SET status = 'processing', attempts = job.attempts + 1, claim_token = gen_random_uuid(),
        next_attempt_at = now() + CASE WHEN job.kind = 'push.tap_pending' THEN interval '30 seconds' ELSE interval '${Number(leaseMinutes)} minutes' END, last_error = NULL
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.id, job.tenant_id AS "tenantId", job.kind, job.payload, job.attempts, job.claim_token AS "claimToken"
  `);
  return result.rows[0] ?? null;
}

/** Records the outcome of the claimed attempt; ignored when the lease has since passed to another worker. */
export async function markOutboxJob(pool: Pick<Pool, "query">, job: Pick<OutboxJob, "id" | "attempts" | "claimToken">, status: OutboxStatus, reason?: string, delaySeconds = 0) {
  const result = await pool.query(
    `WITH locked AS MATERIALIZED (
       SELECT id, next_attempt_at FROM outbox_jobs WHERE id = $1 AND status = 'processing' AND attempts = $5 AND claim_token = $6::uuid FOR UPDATE
     ), owned AS MATERIALIZED (
       SELECT id FROM locked WHERE next_attempt_at > clock_timestamp()
     ) UPDATE outbox_jobs SET status = $2, last_error = $3, next_attempt_at = clock_timestamp() + $4::int * interval '1 second'
       FROM owned WHERE outbox_jobs.id = owned.id`,
    [job.id, status, reason?.slice(0, 300) ?? null, delaySeconds, job.attempts, job.claimToken ?? null],
  );
  return result.rowCount === 1;
}

/**
 * A quiet-hours deferral is not a failed delivery: the attempt that was just claimed is given back and the job sleeps
 * until the allowed time, so waiting overnight can never push it toward the retry limit.
 * Like completion and renewal, an expired or replaced owner cannot reschedule the job.
 */
export async function deferOutboxJob(pool: Pick<Pool, "query">, job: Pick<OutboxJob, "id" | "attempts" | "claimToken">, reason: string, until: Date) {
  const result = await pool.query(
    `WITH locked AS MATERIALIZED (
       SELECT id, next_attempt_at FROM outbox_jobs WHERE id = $1 AND status = 'processing' AND attempts = $4 AND claim_token = $5::uuid FOR UPDATE
     ), owned AS MATERIALIZED (
       SELECT id FROM locked WHERE next_attempt_at > clock_timestamp()
     ) UPDATE outbox_jobs SET status = 'retry', attempts = attempts - 1, last_error = $2, next_attempt_at = $3
       FROM owned WHERE outbox_jobs.id = owned.id`,
    [job.id, reason.slice(0, 300), until, job.attempts, job.claimToken ?? null],
  );
  return result.rowCount === 1;
}

/** Renewal cannot revive an expired claim, even if no replacement worker has claimed it yet. */
export async function renewOutboxJob(pool: Pick<Pool, "query">, job: Pick<OutboxJob, "id" | "attempts" | "claimToken">, leaseMinutes = 5): Promise<boolean> {
  const result = await pool.query(
    `WITH locked AS MATERIALIZED (
       SELECT id, next_attempt_at FROM outbox_jobs WHERE id = $1 AND attempts = $2 AND status = 'processing' AND claim_token = $4::uuid FOR UPDATE
     ), owned AS MATERIALIZED (
       SELECT id FROM locked WHERE next_attempt_at > clock_timestamp()
     ) UPDATE outbox_jobs SET next_attempt_at = clock_timestamp() + $3::double precision * interval '1 minute'
       FROM owned WHERE outbox_jobs.id = owned.id`,
    [job.id, job.attempts, leaseMinutes, job.claimToken ?? null],
  );
  return result.rowCount === 1;
}

/** Completion and suppression share the same atomic ownership fence. */
export async function completeWalletOutboxJob(pool: Pick<Pool, "query">, job: OutboxJob): Promise<boolean> {
  const result = await pool.query<{ owned: boolean }>(`
    WITH locked AS MATERIALIZED (
      SELECT id, next_attempt_at FROM outbox_jobs WHERE id = $1 AND kind = 'wallet.refresh'
        AND tenant_id = $3 AND status = 'processing' AND attempts = $2 AND claim_token = $5::uuid FOR UPDATE
    ), owned AS MATERIALIZED (
      SELECT id FROM locked WHERE next_attempt_at > clock_timestamp()
    ), completed AS (
      UPDATE outbox_jobs SET status = 'complete', last_error = NULL, next_attempt_at = clock_timestamp()
      FROM owned WHERE outbox_jobs.id = owned.id
      RETURNING outbox_jobs.created_at
    ), suppressed AS (
      UPDATE outbox_jobs AS older SET status = 'suppressed', last_error = 'Superseded by a later successful wallet refresh'
      FROM completed WHERE older.kind = 'wallet.refresh' AND older.status IN ('failed', 'blocked')
        AND older.tenant_id = $3 AND older.payload ->> 'membershipId' = $4 AND older.id <> $1
        AND older.created_at <= completed.created_at
      RETURNING older.id
    ) SELECT EXISTS(SELECT 1 FROM completed) AS owned
  `, [job.id, job.attempts, job.tenantId, String(job.payload.membershipId), job.claimToken ?? null]);
  return result.rows[0]?.owned === true;
}
