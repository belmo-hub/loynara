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
