import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OperationalSignalBuffer } from "./operational-signals";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T09:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("saturates each fixed event bucket without retaining unknown dimensions", async () => {
  const batches: unknown[] = [];
  const buffer = new OperationalSignalBuffer(async (counts) => { batches.push(counts); });
  for (let index = 0; index < 1_000_005; index++) buffer.record("rate_limit");
  buffer.record("request_error");
  buffer.record("private@example.test" as "rate_limit");
  await buffer.flush();
  expect(batches).toEqual([{ rate_limit: 1_000_000, request_error: 1 }]);
  await buffer.flush();
  expect(batches).toHaveLength(1);
});

it("never overlaps writes and keeps events recorded during a write for the next batch", async () => {
  let complete!: () => void;
  const batches: unknown[] = [];
  const buffer = new OperationalSignalBuffer((counts) => {
    batches.push(counts);
    return new Promise<void>((resolve) => { complete = resolve; });
  });
  buffer.record("push_failure");
  const first = buffer.flush();
  const concurrent = buffer.flush();
  await Promise.resolve();
  buffer.record("wallet_failure");
  expect(batches).toEqual([{ push_failure: 1 }]);
  complete();
  await Promise.all([first, concurrent]);
  const next = buffer.flush();
  await Promise.resolve();
  expect(batches).toEqual([{ push_failure: 1 }, { wallet_failure: 1 }]);
  complete();
  await next;
});

it("retries failed counts with new events and throttles diagnostics without exposing the error", async () => {
  const batches: unknown[] = [];
  let failing = true;
  const buffer = new OperationalSignalBuffer(async (counts) => {
    batches.push(counts);
    if (failing) throw new Error("postgresql://private:password@internal/customer@example.test");
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  buffer.record("request_error");
  await expect(buffer.flush()).resolves.toBeUndefined();
  buffer.record("request_error");
  await buffer.flush();
  expect(log.mock.calls).toEqual([['{"event":"operational_telemetry_unavailable"}']]);
  vi.advanceTimersByTime(60_000);
  await buffer.flush();
  expect(log).toHaveBeenCalledTimes(2);
  failing = false;
  await buffer.flush();
  expect(batches).toEqual([{ request_error: 1 }, { request_error: 2 }, { request_error: 2 }, { request_error: 2 }]);
  await buffer.flush();
  expect(batches).toHaveLength(4);
});

it("treats a synchronous writer throw as a retryable best-effort failure", async () => {
  let failing = true;
  const batches: unknown[] = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const buffer = new OperationalSignalBuffer((counts) => {
    batches.push(counts);
    if (failing) throw new Error("private synchronous writer failure");
    return Promise.resolve();
  });
  buffer.record("rate_limit");
  await expect(buffer.flush()).resolves.toBeUndefined();
  failing = false;
  await expect(buffer.flush()).resolves.toBeUndefined();
  expect(batches).toEqual([{ rate_limit: 1 }, { rate_limit: 1 }]);
});

it("does not let an unavailable diagnostic sink escape into a caller", async () => {
  const buffer = new OperationalSignalBuffer(async () => { throw new Error("private writer failure"); });
  vi.spyOn(console, "error").mockImplementation(() => { throw new Error("private log sink failure"); });
  buffer.record("rate_limit");
  await expect(buffer.flush()).resolves.toBeUndefined();
});
