import { describe, expect, it } from "vitest";
import { productionMigrationIssues } from "./production-migrate-config";

const valid: NodeJS.ProcessEnv = {
  NODE_ENV: "production", PRODUCTION_ENVIRONMENT: "loynara-production",
  PRODUCTION_APPROVED_ORIGIN: "https://app.getloynara.com",
  DATABASE_URL: "postgresql://web:long-secret@db.railway.internal:5432/loynara",
  MIGRATION_DATABASE_URL: "postgresql://migrator:other-secret@db.railway.internal:5432/loynara",
  BETTER_AUTH_URL: "https://app.getloynara.com", PUBLIC_BASE_URL: "https://app.getloynara.com",
  BETTER_AUTH_SECRET: "a".repeat(64), SMTP_HOST: "disabled", PRODUCTION_MIGRATION_APPROVED: "true",
  PG_POOL_MAX: "5",
};

describe("production migration gate", () => {
  it("accepts an explicitly approved same-database target", () => expect(productionMigrationIssues(valid)).toEqual([]));
  it("refuses missing approval and a device-test target", () => {
    const issues = productionMigrationIssues({ ...valid, PRODUCTION_MIGRATION_APPROVED: "false", MIGRATION_DATABASE_URL: "postgresql://dev:secret@127.0.0.1:54331/looplocal_device_test" });
    expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/approval/i), expect.stringMatching(/target/i)]));
  });
  it("refuses URL query overrides and another database", () => {
    expect(productionMigrationIssues({ ...valid, MIGRATION_DATABASE_URL: `${valid.MIGRATION_DATABASE_URL}?host=other` })).toEqual(expect.arrayContaining([expect.stringMatching(/target/i)]));
    expect(productionMigrationIssues({ ...valid, MIGRATION_DATABASE_URL: valid.MIGRATION_DATABASE_URL!.replace("/loynara", "/preview") })).toEqual(expect.arrayContaining([expect.stringMatching(/target/i)]));
  });
});
