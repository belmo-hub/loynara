import { Client } from "pg";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./src/lib/disposable-test-database";

// CI and production run Postgres in UTC. A local cluster defaults to the host's zone (Europe/Berlin), and then every
// `interval 'N days'` in the product and the tests shifts by an hour across a DST change. Pin every test connection to UTC.
process.env.PGOPTIONS = `${process.env.PGOPTIONS ?? ""} -c timezone=UTC`.trim();

// Runs before every test file is collected. Whenever a database is configured, it must be a marked, disposable local
// test database (see src/lib/disposable-test-database.ts). Checked here, while this module loads, rather than in a
// hook: a refusal then stops the file before any of its hooks exist, so not even a teardown can truncate anything.
// Suites keep their own checks; this one covers every suite, including ones added later.
if (process.env.DATABASE_URL) {
  assertLocalTestDatabaseUrl();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { await assertDisposableDatabase(client); } finally { await client.end(); }
}
