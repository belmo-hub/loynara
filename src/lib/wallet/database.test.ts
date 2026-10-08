import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { withWalletDatabase } from "./database";

afterEach(() => vi.useRealTimers());
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function connection() {
  let closed = false, commits = 0;
  const client = { query: vi.fn(async (sql: unknown) => { if (closed) throw new Error("closed"); if (String(sql).includes("COMMIT")) commits++; return { rows: [] }; }), release: vi.fn((destroy?: boolean) => { closed = Boolean(destroy); }) } as unknown as PoolClient;
  return { client, commits: () => commits, closed: () => closed };
}
describe("bounded Wallet database work", () => {
  it("expires while waiting for a connection and destroys a late acquisition without executing work", async () => {
    vi.useFakeTimers(); const late = deferred<PoolClient>(), c = connection(), work = vi.fn(async () => "late write");
    const result = expect(withWalletDatabase(work, 30, { connect: () => late.promise } as Pick<Pool, "connect">)).rejects.toThrow("Wallet operation timed out");
    await vi.advanceTimersByTimeAsync(30); await result; late.resolve(c.client); await Promise.resolve(); await Promise.resolve();
    expect(work).not.toHaveBeenCalled(); expect(c.client.release).toHaveBeenCalledWith(true);
  });
  it("destroys an active stalled operation so resumed work cannot commit after the HTTP deadline", async () => {
    vi.useFakeTimers(); const c = connection(), stalled = deferred<void>();
    const result = expect(withWalletDatabase(async (_db, client) => { await client.query("BEGIN"); await stalled.promise; await client.query("COMMIT"); }, 50, { connect: async () => c.client } as Pick<Pool, "connect">)).rejects.toThrow("Wallet operation timed out");
    await vi.advanceTimersByTimeAsync(50); await result; stalled.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(c.closed()).toBe(true); expect(c.commits()).toBe(0); expect(c.client.release).toHaveBeenCalledTimes(1);
  });
  it("releases successful work without leaking session timeout settings into another pool borrower", async () => {
    const c = connection(); await expect(withWalletDatabase(async () => "ready", 100, { connect: async () => c.client } as Pick<Pool, "connect">)).resolves.toBe("ready");
    expect(c.client.release).toHaveBeenCalledWith(true); expect(c.client.release).toHaveBeenCalledTimes(1);
  });
});
