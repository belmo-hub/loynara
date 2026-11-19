import "dotenv/config";
import { pool } from "../src/db";
import { pruneExpiredRateLimits } from "../src/lib/rate-limit";

// The worker runs this daily (ENG-281); this script is for a manual run.
async function main() {
  const removed = await pruneExpiredRateLimits();
  console.log(`Pruned ${removed} expired rate-limit records${removed === 10_000 ? "; rerun if backlog remains" : ""}.`);
}

main().catch((error) => {
  console.error("Rate-limit prune failed", error instanceof Error ? error.name : "unknown");
  process.exitCode = 1;
}).finally(async () => { await pool.end(); });
