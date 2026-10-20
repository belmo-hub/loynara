import { execFileSync } from "node:child_process";

const refusal = () => new Error("Checked local synthetic PostgreSQL required; use npm test");
type TestEnvironment = Readonly<Record<string, string | undefined>>;
function validPort(port: string | undefined): boolean {
  return Boolean(port && /^[1-9][0-9]{3,4}$/.test(port) && Number(port) <= 65535);
}

/** Test-only boundary: the runner supplies identity after inspecting the local Docker target. */
export function assertTestDatabaseUrl(env: TestEnvironment = process.env): URL {
  let database: URL;
  try { database = new URL(env.DATABASE_URL ?? ""); } catch { throw refusal(); }
  if (env.NODE_ENV !== "test" || !validPort(env.TEST_PG_PORT)
    || !/^[a-f0-9]{64}$/.test(env.TEST_PG_CONTAINER_ID ?? "")
    || !/^\/[^\0\r\n]+$/.test(env.TEST_PG_DATA_DIRECTORY ?? "")
    || !["postgres:", "postgresql:"].includes(database.protocol)
    || !["localhost", "127.0.0.1"].includes(database.hostname)
    || database.port !== env.TEST_PG_PORT || database.pathname !== "/looplocal_test"
    || database.username !== "looplocal" || database.password !== "looplocal_local_only"
    || database.search || database.hash) throw refusal();
  return database;
}

export function assertTestDatabaseIdentity(identity: unknown, env: TestEnvironment = process.env): void {
  assertTestDatabaseUrl(env);
  const row = identity as { database?: unknown; username?: unknown; data_directory?: unknown } | null;
  if (!row || row.database !== "looplocal_test" || row.username !== "looplocal"
    || row.data_directory !== env.TEST_PG_DATA_DIRECTORY) throw refusal();
}

export async function assertOwnedTestDatabase(client: { query(text: string): Promise<{ rows: unknown[] }> }, env: TestEnvironment = process.env): Promise<void> {
  assertTestDatabaseUrl(env);
  const result = await client.query("SELECT current_database() AS database, current_user AS username, current_setting('data_directory') AS data_directory");
  if (result.rows.length !== 1) throw refusal();
  assertTestDatabaseIdentity(result.rows[0], env);
}

export function checkedTestContainer(inspection: unknown, port: string): string {
  if (!validPort(port) || !Array.isArray(inspection) || inspection.length !== 1) throw refusal();
  const container = inspection[0] as {
    Id?: string; State?: { Running?: boolean }; Config?: { Env?: string[] };
    NetworkSettings?: { Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null> };
  } | null;
  const environment = container?.Config?.Env;
  const bindings = container?.NetworkSettings?.Ports?.["5432/tcp"];
  if (!container || !/^[a-f0-9]{64}$/.test(container.Id ?? "") || container.State?.Running !== true
    || !Array.isArray(environment) || !environment.includes("POSTGRES_USER=looplocal")
    || !environment.includes("POSTGRES_PASSWORD=looplocal_local_only")
    || !environment.some(value => value === "POSTGRES_DB=looplocal" || value === "POSTGRES_DB=looplocal_test")
    || !Array.isArray(bindings) || bindings.length === 0
    || bindings.some(binding => !["127.0.0.1", "::1"].includes(binding.HostIp ?? "") || binding.HostPort !== port)) throw refusal();
  return container.Id!;
}

// No environment values or Docker diagnostics may be printed on a refusal.
if (process.argv[1]?.endsWith("/test-database-guard.ts") && process.argv[2] === "--container") {
  try {
    const inspection = JSON.parse(execFileSync("docker", ["inspect", process.argv[3] ?? ""], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    process.stdout.write(checkedTestContainer(inspection, process.argv[4] ?? ""));
  } catch { console.error("Test runner refused an unverified local synthetic Docker target"); process.exitCode = 1; }
}
