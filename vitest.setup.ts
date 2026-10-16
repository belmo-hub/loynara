import { Client } from "pg";
import { beforeAll } from "vitest";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./src/lib/disposable-test-database";

// Runs before every test file. Whenever a database is configured, it must be a marked, disposable local test database
// before any test can truncate tables or end connections in it (see src/lib/disposable-test-database.ts). Suites keep
// their own checks; this one covers every suite, including ones added later.
if (process.env.DATABASE_URL) {
  assertLocalTestDatabaseUrl();
  beforeAll(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try { await assertDisposableDatabase(client); } finally { await client.end(); }
  });
}
