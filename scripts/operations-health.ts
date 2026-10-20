import { serviceMonthlyLimit } from "../src/lib/service-budget";
import type { Client, Pool } from "pg";

export type OperationsCounts = {
  failed: number; blocked: number; overdue: number; expiredLeases: number;
  emailFailures: number; errors: number; rateLimited: number;
  pushFailures: number; walletFailures: number; budgetWarnings: number;
  overdueCards: number; overdueTenants: number; holdReviews: number; remoteIncomplete: number; unclassifiedTenants: number;
};
export function operationsAlerts(counts: OperationsCounts): string[] {
  const names: (keyof OperationsCounts)[] = ["failed", "blocked", "overdue", "expiredLeases", "emailFailures", "errors", "rateLimited", "pushFailures", "walletFailures", "budgetWarnings", "overdueCards", "overdueTenants", "holdReviews", "remoteIncomplete", "unclassifiedTenants"];
  if (names.some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0)) return ["invalid_measurement"];
  const alerts: string[] = [];
  if (counts.failed) alerts.push("failed_jobs");
  if (counts.blocked) alerts.push("blocked_jobs");
  if (counts.overdue) alerts.push("queue_stalled");
  if (counts.expiredLeases) alerts.push("expired_processing_lease");
  if (counts.emailFailures) alerts.push("email_delivery_failure");
  if (counts.errors) alerts.push("request_errors");
  if (counts.rateLimited >= 100) alerts.push("rate_limit_spike");
  if (counts.pushFailures) alerts.push("push_failure");
  if (counts.walletFailures) alerts.push("wallet_failure");
  if (counts.budgetWarnings) alerts.push("service_budget_warning");
  if (counts.overdueCards) alerts.push("card_erasure_overdue");
  if (counts.overdueTenants) alerts.push("tenant_erasure_overdue");
  if (counts.holdReviews) alerts.push("legal_hold_review_due");
  if (counts.remoteIncomplete) alerts.push("remote_revocation_incomplete");
  if (counts.unclassifiedTenants) alerts.push("tenant_retention_classification_required");
  return alerts;
}
/** One statement gives a coherent database snapshot; no identifiers or error bodies leave the database. */
export async function readOperationsCounts(client: Pick<Client | Pool, "query">, env: NodeJS.ProcessEnv = process.env): Promise<OperationsCounts> {
  const result = await client.query(`
    WITH retention AS (SELECT * FROM public.loynara_retention_health())
    SELECT count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
      count(*) FILTER (WHERE status IN ('pending','retry') AND next_attempt_at < now() - interval '15 minutes')::int AS overdue,
      count(*) FILTER (WHERE status = 'processing' AND next_attempt_at < now() - interval '2 minutes')::int AS "expiredLeases",
      (SELECT count(*)::int FROM email_deliveries WHERE
        (updated_at > now() - interval '24 hours' AND status IN ('ambiguous','temporary_failure','permanent_failure'))
        OR (status = 'sending' AND updated_at < now()-interval '15 minutes')) AS "emailFailures",
      (SELECT coalesce(sum(count),0)::int FROM operational_counters WHERE event='request_error' AND minute >= date_trunc('minute',now())-interval '4 minutes') AS errors,
      (SELECT coalesce(sum(count),0)::int FROM operational_counters WHERE event='rate_limit' AND minute >= date_trunc('minute',now())-interval '4 minutes') AS "rateLimited",
      (SELECT coalesce(sum(count),0)::int FROM operational_counters WHERE event='push_failure' AND minute >= date_trunc('minute',now())-interval '4 minutes') AS "pushFailures",
      (SELECT coalesce(sum(count),0)::int FROM operational_counters WHERE event='wallet_failure' AND minute >= date_trunc('minute',now())-interval '4 minutes') AS "walletFailures",
      (SELECT count(*)::int FROM service_usage WHERE month = date_trunc('month',now() at time zone 'UTC')::date
        AND attempts >= greatest(1, ceil(0.8 * CASE service WHEN 'email' THEN $1::int WHEN 'wallet' THEN $2::int ELSE $3::int END))) AS "budgetWarnings",
      (SELECT overdue_cards FROM retention) AS "overdueCards",
      (SELECT overdue_tenants FROM retention) AS "overdueTenants",
      (SELECT hold_reviews FROM retention) AS "holdReviews",
      (SELECT remote_incomplete FROM retention) AS "remoteIncomplete",
      (SELECT unclassified_tenants FROM retention) AS "unclassifiedTenants"
    FROM outbox_jobs`, [serviceMonthlyLimit("email", env), serviceMonthlyLimit("wallet", env), serviceMonthlyLimit("push", env)]);
  const raw = result.rows[0] ?? {};
  return Object.fromEntries(["failed", "blocked", "overdue", "expiredLeases", "emailFailures", "errors", "rateLimited", "pushFailures", "walletFailures", "budgetWarnings", "overdueCards", "overdueTenants", "holdReviews", "remoteIncomplete", "unclassifiedTenants"].map(key => [key, typeof raw[key] === "number" ? raw[key] : NaN])) as OperationsCounts;
}
