/**
 * Guard for test suites that truncate tables or end database connections. A database name alone proves nothing (a
 * local forward to a restored copy can be called looplocal_test), so the test setup (CI and scripts/test-local.sh)
 * marks the database it created, and these suites refuse any database without that mark.
 */
export const DISPOSABLE_DATABASE_MARKER = "loynara-disposable-test-database";

const refused = () => new Error("Disposable local test database required: see scripts/test-local.sh");

/** Checked before connecting. Query parameters are refused outright: node-postgres lets them override the host. */
export function assertLocalTestDatabaseUrl(raw: string | undefined = process.env.DATABASE_URL): void {
  let url: URL;
  try { url = new URL(raw ?? ""); } catch { throw refused(); }
  if (process.env.NODE_ENV === "production" || !["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/looplocal_test" || url.search !== "" || url.hash !== "") throw refused();
}

type Queryable = { query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> };

/** Checked on the open connection, before the first destructive statement. */
export async function assertDisposableDatabase(database: Queryable): Promise<void> {
  const { rows: [row] } = await database.query(
    "SELECT current_database() AS name, shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()");
  if (row?.name !== "looplocal_test" || row?.marker !== DISPOSABLE_DATABASE_MARKER) throw refused();
}
