import "dotenv/config";
import { Client } from "pg";
import { databaseFailureDiagnostic } from "./operational-error";
import { productionConfigIssues } from "./config-check";
import { sendWorkerHeartbeat, validHeartbeatUrl } from "./ops-heartbeat";
import { operationsAlerts, readOperationsCounts } from "./operations-health";

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
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 });
  await client.connect();
  try {
    const counts = await readOperationsCounts(client);
    const alerts = operationsAlerts(counts);
    if (alerts.length) throw new OperationsCheckRefusal(`Operations require operator review: ${JSON.stringify({ alerts, counts })}`);
    if (!await sendWorkerHeartbeat(process.env.OPS_HEARTBEAT_URL)) throw new OperationsCheckRefusal("Operations heartbeat was not acknowledged; check monitor availability and reviewed configuration");
    console.log("Production operations check PASS: database and outbox healthy");
  } finally { await client.end(); }
}

if (process.argv[1]?.endsWith("production-ops-check.ts")) {
  main().catch(error => { console.error(failureDiagnostic(error)); process.exitCode = 1; });
}
