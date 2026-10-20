import { afterEach, expect, it, vi } from "vitest";
import { startStalledPostgres } from "./postgres-stall.test-helper";

let server: Awaited<ReturnType<typeof startStalledPostgres>> | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

it("bounds best-effort telemetry when a connected server never answers its query", async () => {
  server = await startStalledPostgres(true);
  vi.stubEnv("DATABASE_URL", server.url);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { OperationalSignalBuffer, writeOperationalCounts } = await import("./operational-signals");
  const buffer = new OperationalSignalBuffer(writeOperationalCounts);
  buffer.record("request_error");
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const timely = await Promise.race([
    buffer.flush().then(() => true),
    new Promise<false>((resolve) => { watchdog = setTimeout(() => resolve(false), 2500); }),
  ]);
  clearTimeout(watchdog);
  expect(server.queryCount()).toBe(1);
  expect(timely).toBe(true);
  expect(log.mock.calls).toEqual([['{"event":"operational_telemetry_unavailable"}']]);
});
