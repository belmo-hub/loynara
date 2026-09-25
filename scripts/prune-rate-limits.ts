import "dotenv/config";
import { pool } from "../src/db";

// Daily operator task. This is technical counter housekeeping, not a legal
// retention policy. Each invocation removes at most 10,000 expired records.
async function main() {
  let removed = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const result = await pool.query(`
      WITH expired AS (
        SELECT key_hash FROM rate_limits
        WHERE reset_at < now() - interval '48 hours'
        ORDER BY reset_at
        LIMIT 500
      )
      DELETE FROM rate_limits AS r USING expired
      WHERE r.key_hash = expired.key_hash
    `);
    removed += result.rowCount ?? 0;
    if ((result.rowCount ?? 0) < 500) break;
  }
  console.log(`Pruned ${removed} expired rate-limit records${removed === 10_000 ? "; rerun if backlog remains" : ""}.`);
}

main().catch((error) => {
  console.error("Rate-limit prune failed", error instanceof Error ? error.name : "unknown");
  process.exitCode = 1;
}).finally(async () => { await pool.end(); });
