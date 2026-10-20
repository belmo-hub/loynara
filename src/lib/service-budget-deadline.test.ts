import { performance } from "node:perf_hooks";
import { Pool, type PoolClient } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { startStalledPostgres } from "./postgres-stall.test-helper";
import { reserveServiceCall, ServiceBudgetError } from "./service-budget";

let server: Awaited<ReturnType<typeof startStalledPostgres>> | undefined;
let pool: Pool | undefined;
afterEach(async () => {
  await server?.close();
  await pool?.end();
  server = undefined;
  pool = undefined;
  vi.restoreAllMocks();
});

it("fails closed within the reservation deadline and discards the unresponsive connection", async () => {
  server = await startStalledPostgres(true);
  // No client-wide query_timeout: the reservation must supply its own deadline.
  // The synthetic peer accepts startup but never answers or executes any SQL.
  pool = new Pool({ connectionString: server.url, max: 1, connectionTimeoutMillis: 1000, statement_timeout: 1000 });
  pool.on("error", () => undefined);
  const clients: PoolClient[] = [];
  pool.on("connect", (client) => { clients.push(client); });
  const started = performance.now();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    reserveServiceCall("email", { SERVICE_EMAIL_MONTHLY_LIMIT: "2" }, pool)
      .then(() => ({ error: undefined }), (error: unknown) => ({ error })),
    new Promise<{ watchdog: true }>((resolve) => { watchdog = setTimeout(() => resolve({ watchdog: true }), 6500); }),
  ]);
  clearTimeout(watchdog);
  expect(result).not.toHaveProperty("watchdog");
  expect(performance.now() - started).toBeLessThan(6500);
  expect(server.queryCount()).toBe(1);
  if (!("error" in result)) throw new Error("Reservation did not reach its finite failure boundary");
  expect(result.error).toBeInstanceOf(ServiceBudgetError);
  expect(String(result.error)).toBe("ServiceBudgetError: Optional service temporarily unavailable");
  expect(String(result.error)).not.toContain(server.url);
  expect(pool.totalCount).toBe(0);
  expect(pool.idleCount).toBe(0);
  expect(pool.waitingCount).toBe(0);
  expect(clients).toHaveLength(1);

  // A later acquisition must use a new physical connection, never the query
  // whose server-side outcome is unknown. It performs no subsequent SQL.
  const fresh = await pool.connect();
  expect(clients).toHaveLength(2);
  expect(fresh).not.toBe(clients[0]);
  fresh.release(true);
  expect(pool.totalCount).toBe(0);
  expect(server.queryCount()).toBe(1);
});
