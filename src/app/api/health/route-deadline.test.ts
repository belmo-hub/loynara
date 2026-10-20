import { performance } from "node:perf_hooks";
import { afterEach, expect, it, vi } from "vitest";
import { startStalledPostgres } from "@/lib/postgres-stall.test-helper";

let server: Awaited<ReturnType<typeof startStalledPostgres>> | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function stalledPostgres(acceptStartup: boolean) {
  server = await startStalledPostgres(acceptStartup);
  vi.stubEnv("DATABASE_URL", server.url);
  return server.queryCount;
}

it("returns a generic 503 within its connection deadline when startup never completes", async () => {
  await stalledPostgres(false);
  const { GET } = await import("./route");
  const started = performance.now();
  const response = await GET();
  expect(performance.now() - started).toBeLessThan(2500);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "degraded", database: "unreachable" });
});

it("bounds both an unresponsive query and concurrent acquisition of the busy readiness connection", async () => {
  const queries = await stalledPostgres(true);
  const { GET } = await import("./route");
  const started = performance.now();
  const responses = await Promise.all([GET(), GET()]);
  expect(queries()).toBeGreaterThan(0);
  expect(performance.now() - started).toBeLessThan(3500);
  for (const response of responses) {
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "degraded", database: "unreachable" });
  }
});
