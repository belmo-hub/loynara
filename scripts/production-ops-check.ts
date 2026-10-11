import "dotenv/config";
import { Client } from "pg";
import { productionConfigIssues } from "./config-check";
import { sendWorkerHeartbeat, validHeartbeatUrl } from "./ops-heartbeat";

// Only our fixed validation/health diagnostics may cross the stderr boundary.
// Database error message/name/detail/stack can contain connection or query data.
class OperationsCheckRefusal extends Error {}

function failureDiagnostic(error: unknown): string {
  if (error instanceof OperationsCheckRefusal) return error.message;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  switch (code) {
    case "28P01": case "28000":
      return "Database authentication failed; check reviewed operations-check credentials";
    case "ECONNREFUSED": case "ENOTFOUND": case "EAI_AGAIN": case "ETIMEDOUT":
    case "08000": case "08001": case "08003": case "08004": case "08006": case "08007": case "08P01":
      return "Database connection failed; check database availability and reviewed connection configuration";
    case "42501":
      return "Database permission denied; check reviewed operations-check access";
    case "42P01": case "42703":
      return "Database schema mismatch; check reviewed migration and release identity";
    case "57014":
      return "Database query cancelled or timed out; check database availability";
    default:
      return "Operations check failed; check reviewed configuration and database availability (details withheld)";
  }
}

export function outboxHealth(counts: { failed: number; blocked: number; overdue: number }) {
  return counts.failed === 0 && counts.blocked === 0 && counts.overdue === 0;
}

async function main() {
  const issues = productionConfigIssues(process.env);
  if (process.env.NODE_ENV !== "production") issues.push("Operations check requires production mode");
  if (!validHeartbeatUrl(process.env.OPS_HEARTBEAT_URL)) issues.push("Operations heartbeat URL missing or invalid");
  if (issues.length) throw new OperationsCheckRefusal(`Production operations check refused: ${issues.join("; ")}`);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ failed: string; blocked: string; overdue: string }>(`
      SELECT count(*) FILTER (WHERE status = 'failed')::text AS failed,
        count(*) FILTER (WHERE status = 'blocked')::text AS blocked,
        count(*) FILTER (WHERE status IN ('pending','retry') AND next_attempt_at < now() - interval '15 minutes')::text AS overdue
      FROM outbox_jobs
    `);
    const counts = { failed: Number(result.rows[0]?.failed), blocked: Number(result.rows[0]?.blocked), overdue: Number(result.rows[0]?.overdue) };
    if (!outboxHealth(counts)) throw new OperationsCheckRefusal(`Outbox requires operator review: ${JSON.stringify(counts)}`);
    if (!await sendWorkerHeartbeat(process.env.OPS_HEARTBEAT_URL)) throw new OperationsCheckRefusal("Operations heartbeat was not acknowledged; check monitor availability and reviewed configuration");
    console.log("Production operations check PASS: database and outbox healthy");
  } finally { await client.end(); }
}

if (process.argv[1]?.endsWith("production-ops-check.ts")) {
  main().catch(error => { console.error(failureDiagnostic(error)); process.exitCode = 1; });
}
