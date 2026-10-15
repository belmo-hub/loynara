import "dotenv/config";
import { Client } from "pg";
import { databaseFailureDiagnostic } from "./operational-error";
import { productionConfigIssues } from "./config-check";
import { sendWorkerHeartbeat, validHeartbeatUrl } from "./ops-heartbeat";

// Only our fixed validation/health diagnostics may cross the stderr boundary.
// Database error message/name/detail/stack can contain connection or query data.
class OperationsCheckRefusal extends Error {}

function failureDiagnostic(error: unknown): string {
  if (error instanceof OperationsCheckRefusal) return error.message;
  return databaseFailureDiagnostic(error)
    ?? "Operations check failed; check reviewed configuration and database availability (details withheld)";
}

export function outboxHealth(counts: { failed: number; blocked: number; overdue: number; stalled: number }) {
  return counts.failed === 0 && counts.blocked === 0 && counts.overdue === 0 && counts.stalled === 0;
}

async function main() {
  const issues = productionConfigIssues(process.env);
  if (process.env.NODE_ENV !== "production") issues.push("Operations check requires production mode");
  if (!validHeartbeatUrl(process.env.OPS_HEARTBEAT_URL)) issues.push("Operations heartbeat URL missing or invalid");
  if (issues.length) throw new OperationsCheckRefusal(`Production operations check refused: ${issues.join("; ")}`);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // For a processing job, next_attempt_at is the end of its claim lease. One still processing 15 minutes past that
    // means the worker stopped claiming work, even while its separate heartbeat connection keeps reporting.
    const result = await client.query<{ failed: string; blocked: string; overdue: string; stalled: string }>(`
      SELECT count(*) FILTER (WHERE status = 'failed')::text AS failed,
        count(*) FILTER (WHERE status = 'blocked')::text AS blocked,
        count(*) FILTER (WHERE status IN ('pending','retry') AND next_attempt_at < now() - interval '15 minutes')::text AS overdue,
        count(*) FILTER (WHERE status = 'processing' AND next_attempt_at < now() - interval '15 minutes')::text AS stalled
      FROM outbox_jobs
    `);
    const counts = { failed: Number(result.rows[0]?.failed), blocked: Number(result.rows[0]?.blocked), overdue: Number(result.rows[0]?.overdue), stalled: Number(result.rows[0]?.stalled) };
    if (!outboxHealth(counts)) throw new OperationsCheckRefusal(`Outbox requires operator review: ${JSON.stringify(counts)}`);
    if (!await sendWorkerHeartbeat(process.env.OPS_HEARTBEAT_URL)) throw new OperationsCheckRefusal("Operations heartbeat was not acknowledged; check monitor availability and reviewed configuration");
    console.log("Production operations check PASS: database and outbox healthy");
  } finally { await client.end(); }
}

if (process.argv[1]?.endsWith("production-ops-check.ts")) {
  main().catch(error => { console.error(failureDiagnostic(error)); process.exitCode = 1; });
}
