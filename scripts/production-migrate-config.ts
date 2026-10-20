import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { productionConfigIssues } from "./config-check";

export function productionMigrationIssues(env: NodeJS.ProcessEnv): string[] {
  const issues = productionConfigIssues({ ...env, NODE_ENV: "production" });
  if (env.NODE_ENV !== "production") issues.push("Migration process must run in production mode");
  if (env.PRODUCTION_MIGRATION_APPROVED !== "true") issues.push("Explicit production migration approval is required");
  try {
    const app = new URL(env.DATABASE_URL ?? "");
    const migration = new URL(env.MIGRATION_DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(migration.protocol)
      || migration.hostname !== app.hostname || migration.port !== app.port || migration.pathname !== app.pathname
      || migration.search || migration.hash || !migration.password) {
      issues.push("Migration target must be the exact approved production database host, port and name");
    }
  } catch {
    issues.push("Migration target is missing or malformed");
  }
  return issues;
}

/**
 * Journal entries drizzle would silently skip: it applies only entries whose `when` is newer than the newest applied
 * row, so an entry that lands later with an older `when` (e.g. a lower number merged after a higher one) never runs.
 */
export async function skippedMigrations(client: Pick<Client, "query">, migrationsFolder = "drizzle"): Promise<string[]> {
  const table = await client.query<{ present: boolean }>("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present");
  if (!table.rows[0]?.present) return [];
  const applied = await client.query<{ created_at: string }>("SELECT created_at::text FROM drizzle.__drizzle_migrations");
  const appliedWhen = new Set(applied.rows.map(row => Number(row.created_at)));
  const newest = Math.max(...appliedWhen);
  const { entries } = JSON.parse(readFileSync(path.resolve(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string; when: number }> };
  return entries.filter(entry => !appliedWhen.has(entry.when) && entry.when < newest).map(entry => entry.tag);
}
