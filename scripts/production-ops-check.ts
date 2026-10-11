import "dotenv/config";
import { Client } from "pg";
import { productionConfigIssues } from "./config-check";
import { sendWorkerHeartbeat, validHeartbeatUrl } from "./ops-heartbeat";

export function outboxHealth(counts: { failed: number; blocked: number; overdue: number }) {
  return counts.failed === 0 && counts.blocked === 0 && counts.overdue === 0;
}

async function main() {
  const issues = productionConfigIssues(process.env);
  if (process.env.NODE_ENV !== "production") issues.push("Operations check requires production mode");
  if (!validHeartbeatUrl(process.env.OPS_HEARTBEAT_URL)) issues.push("Operations heartbeat URL missing or invalid");
  if (issues.length) throw new Error(`Production operations check refused: ${issues.join("; ")}`);
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
    if (!outboxHealth(counts)) throw new Error(`Outbox requires operator review: ${JSON.stringify(counts)}`);
    if (!await sendWorkerHeartbeat(process.env.OPS_HEARTBEAT_URL)) throw new Error("Operations heartbeat was not acknowledged; check monitor availability and reviewed configuration");
    console.log("Production operations check PASS: database and outbox healthy");
  } finally { await client.end(); }
}

if (process.argv[1]?.endsWith("production-ops-check.ts")) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Operations check failed"); process.exitCode = 1; });
}
