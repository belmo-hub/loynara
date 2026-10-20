import { afterEach, beforeEach, expect, it, vi } from "vitest";

const postgres = vi.hoisted(() => ({
  query: vi.fn(),
  sharedQuery: vi.fn(),
  pools: [] as { options: Record<string, unknown>; on: ReturnType<typeof vi.fn> }[],
}));
vi.mock("@/db", () => ({ pool: { query: postgres.sharedQuery } }));
vi.mock("pg", () => ({
  Pool: class {
    query = postgres.query;
    on = vi.fn().mockReturnThis();
    constructor(options: Record<string, unknown>) {
      postgres.pools.push({ options, on: this.on });
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  postgres.pools.length = 0;
  postgres.query.mockReset().mockResolvedValue({ rows: [{ "?column?": 1 }] });
  postgres.sharedQuery.mockReset().mockResolvedValue({ rows: [{ "?column?": 1 }] });
});
afterEach(() => vi.restoreAllMocks());

it("reports database readiness without caching a successful response", async () => {
  const { GET } = await import("./route");
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "ok", database: "reachable" });
});

it("reports a generic uncached 503 when the database is unavailable", async () => {
  const privateFailure = new Error("postgresql://private-user:private-password@internal-host/customer@example.test");
  postgres.query.mockRejectedValue(privateFailure);
  postgres.sharedQuery.mockRejectedValue(privateFailure);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { GET } = await import("./route");
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "degraded", database: "unreachable" });
  expect(log).not.toHaveBeenCalled();
});

it("keeps readiness independent of an exhausted application pool", async () => {
  postgres.sharedQuery.mockRejectedValue(new Error("Shared application pool exhausted"));
  const { GET } = await import("./route");
  expect((await GET()).status).toBe(200);
  expect(postgres.sharedQuery).not.toHaveBeenCalled();
});

it("bounds readiness connections, queued acquisition and query execution on one reusable connection", async () => {
  const { GET } = await import("./route");
  await GET();
  await GET();
  expect(postgres.pools).toHaveLength(1);
  const options = postgres.pools[0].options;
  expect(options.max).toBe(1);
  // node-postgres applies connectionTimeoutMillis both to establishing a
  // connection and to waiting for a busy pool; query_timeout is client-side.
  for (const timeout of ["connectionTimeoutMillis", "statement_timeout", "query_timeout", "idleTimeoutMillis"]) {
    expect(options[timeout]).toEqual(expect.any(Number));
    expect(Number(options[timeout])).toBeGreaterThan(0);
    expect(Number(options[timeout])).toBeLessThanOrEqual(1000);
  }
  expect(options.allowExitOnIdle).toBe(true);
  const idleErrorHandler = postgres.pools[0].on.mock.calls.find(([event]) => event === "error")?.[1];
  expect(idleErrorHandler).toEqual(expect.any(Function));
  expect(() => idleErrorHandler(new Error("private idle connection failure"))).not.toThrow();
});
