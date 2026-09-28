import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Client } from "pg";
import { productionMigrationIssues } from "./production-migrate-config";

async function main() {
  const issues = productionMigrationIssues(process.env);
  if (["var/demo-access.json", "var/preview-access.json", "var/preview.env", "var/device-test-access.json", "var/device-test.env", "var/nfc-development-keys.json"]
    .some(file => existsSync(path.resolve(file)))) issues.push("Local test credentials or NFC development keys exist in the deployment directory");
  if (issues.length) throw new Error(`Production migration refused: ${issues.join("; ")}`);

  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  let locked = false;
  try {
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(731849, 1001) AS acquired");
    if (!lock.rows[0]?.acquired) throw new Error("Another Loynara production migration holds the database lock");
    locked = true;
    const existing = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
    const names = new Set(existing.rows.map(row => row.table_name));
    const authTables = ["user", "session", "account", "verification"];
    const present = authTables.filter(name => names.has(name));
    if (present.length > 0 && present.length !== authTables.length) throw new Error("Incomplete auth schema; inspect before migration");
    if (present.length === 0) {
      if (names.size !== 0) throw new Error("Nonempty database without auth schema; inspect before migration");
      await client.query(readFileSync(path.resolve("drizzle/auth.sql"), "utf8"));
    }
    const child = spawn(path.resolve("node_modules/.bin/drizzle-kit"), ["migrate"], {
      // Database drivers may include connection details in failure output.
      stdio: "ignore",
      env: { ...process.env, DATABASE_URL: process.env.MIGRATION_DATABASE_URL },
    });
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => resolve(code ?? 1));
    });
    if (exitCode !== 0) throw new Error("Application migration failed; inspect before retry");
    const check = await client.query<{ auth: string | null; tenants: string | null; ledger: string | null; trigger_count: string }>(
      "SELECT to_regclass('public.user')::text AS auth, to_regclass('public.tenants')::text AS tenants, to_regclass('public.ledger_entries')::text AS ledger, (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'ledger_append_only' AND NOT tgisinternal) AS trigger_count",
    );
    if (!check.rows[0]?.auth || !check.rows[0]?.tenants || !check.rows[0]?.ledger || check.rows[0]?.trigger_count !== "1") {
      throw new Error("Migration verification failed: critical tables or append-only trigger missing");
    }
    console.log("Production migration PASS: auth, app schema and append-only ledger trigger present. No seed was run.");
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(731849, 1001)");
    await client.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Production migration failed");
  process.exitCode = 1;
});
