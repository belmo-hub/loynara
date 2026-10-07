import type { Pool } from "pg";

const coveredReason = "Wallet refresh already covered by a pending job";
type ReplayStatus = "pending" | "suppressed";

/** Replays an operator-selected job without competing with a Wallet refresh that already covers its current state. */
export async function replayOutboxJob(pool: Pick<Pool, "query">, jobId: string): Promise<ReplayStatus> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) throw new Error("Replay requires a job UUID");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await pool.query<{ status: ReplayStatus }>(`
        WITH candidate AS (
          SELECT id, kind, tenant_id, payload FROM outbox_jobs
          WHERE id = $1 AND status IN ('blocked', 'failed') FOR UPDATE
        ), decision AS (
          SELECT c.id, c.kind, c.payload, c.kind = 'wallet.refresh' AND EXISTS (
            SELECT 1 FROM outbox_jobs p WHERE p.id <> c.id AND p.tenant_id = c.tenant_id
              AND p.kind = 'wallet.refresh' AND p.status = 'pending'
              AND p.payload ->> 'membershipId' = c.payload ->> 'membershipId'
          ) AS covered FROM candidate c
        )
        UPDATE outbox_jobs j SET
          status = CASE WHEN d.covered THEN 'suppressed' ELSE 'pending' END,
          attempts = CASE WHEN d.covered THEN j.attempts ELSE 0 END,
          next_attempt_at = now(), last_error = CASE WHEN d.covered THEN $2 ELSE NULL END,
          payload = CASE WHEN d.kind = 'wallet.refresh' THEN d.payload || jsonb_build_object('coalescingVersion', '1') ELSE d.payload END
        FROM decision d WHERE j.id = d.id RETURNING j.status`, [jobId, coveredReason]);
      if (result.rows[0]) return result.rows[0].status;
      const existing = await pool.query<{ status: string; last_error: string | null }>("SELECT status, last_error FROM outbox_jobs WHERE id = $1", [jobId]);
      const row = existing.rows[0];
      if (row?.status === "pending") return "pending";
      if (row?.status === "suppressed" && row.last_error === coveredReason) return "suppressed";
      throw new Error("Job is not blocked or failed, or it does not exist");
    } catch (error) {
      const collision = error as { code?: string; constraint?: string };
      if (collision.code !== "23505" || collision.constraint !== "outbox_wallet_pending_member_idx") throw error;
      // An enqueue committed after our snapshot. Re-read it and suppress this replay without touching that job.
    }
  }
  throw new Error("Wallet replay raced with another refresh; retry the replay");
}
