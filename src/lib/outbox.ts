import type { Pool } from "pg";

export type OutboxJob = {
  id: string;
  tenantId: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
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
    SET status = 'processing', attempts = job.attempts + 1,
        next_attempt_at = now() + interval '${Number(leaseMinutes)} minutes', last_error = NULL
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.id, job.tenant_id AS "tenantId", job.kind, job.payload, job.attempts
  `);
  return result.rows[0] ?? null;
}

/** Records the outcome of the claimed attempt; ignored when the lease has since passed to another worker. */
export async function markOutboxJob(pool: Pick<Pool, "query">, job: Pick<OutboxJob, "id" | "attempts">, status: OutboxStatus, reason?: string, delaySeconds = 0) {
  await pool.query(
    "UPDATE outbox_jobs SET status = $2, last_error = $3, next_attempt_at = now() + $4::int * interval '1 second' WHERE id = $1 AND status = 'processing' AND attempts = $5",
    [job.id, status, reason?.slice(0, 300) ?? null, delaySeconds, job.attempts],
  );
}

/**
 * A quiet-hours deferral is not a failed delivery: the attempt that was just claimed is given back and the job sleeps
 * until the allowed time, so waiting overnight can never push it toward the retry limit.
 */
export async function deferOutboxJob(pool: Pick<Pool, "query">, job: Pick<OutboxJob, "id" | "attempts">, reason: string, until: Date) {
  await pool.query(
    "UPDATE outbox_jobs SET status = 'retry', attempts = attempts - 1, last_error = $2, next_attempt_at = $3 WHERE id = $1 AND status = 'processing' AND attempts = $4",
    [job.id, reason.slice(0, 300), until, job.attempts],
  );
}
