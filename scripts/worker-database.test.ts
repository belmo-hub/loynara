import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";

async function api() {
  const implementation = await import("./worker-database").catch(() => null);
  expect(implementation?.boundedWorkerDatabase).toBeTypeOf("function");
  return implementation!;
}
describe("bounded parent database operations", () => {
  it("destroys a late acquired client rather than running a query after acquisition timeout", async () => {
    const { boundedWorkerDatabase } = await api();
    let queried = false, destroyed = false;
    const client = { query: () => { queried = true; }, release: (destroy?: boolean) => { destroyed = !!destroy; } };
    const pool = { connect: () => new Promise(resolve => setTimeout(() => resolve(client), 60)) } as unknown as Pool;
    const bounded = boundedWorkerDatabase(pool, { timeoutMs: 15 });
    await expect(bounded.query("select 1")).rejects.toThrow("Worker database deadline exceeded");
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(queried).toBe(false);
    expect(destroyed).toBe(true);
  });
  it("destroys a client with an ongoing query and never returns it to the pool", async () => {
    const { boundedWorkerDatabase } = await api();
    const releases: boolean[] = [];
    const client = { query: () => new Promise(() => {}), release: (destroy?: boolean) => releases.push(!!destroy) } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;
    await expect(boundedWorkerDatabase(pool, { timeoutMs: 15 }).query("select pg_sleep(30)")).rejects.toThrow("Worker database deadline exceeded");
    expect(releases).toEqual([true]);
  });
  it("rejects before acquisition once the absolute job deadline has expired", async () => {
    const { boundedWorkerDatabase } = await api();
    let connected = false;
    const pool = { connect: async () => { connected = true; } } as unknown as Pool;
    await expect(boundedWorkerDatabase(pool, { deadline: Date.now() - 1 }).query("select 1")).rejects.toThrow("Worker database deadline exceeded");
    expect(connected).toBe(false);
  });
  it("destroys a running transaction immediately when shutdown aborts it", async () => {
    const { boundedWorkerDatabase } = await api();
    const controller = new AbortController();
    let destroyed = false;
    const client = { query: () => new Promise(() => {}), release: (value?: boolean) => { destroyed = !!value; } };
    const pool = { connect: async () => client } as unknown as Pool;
    const operation = boundedWorkerDatabase(pool, { timeoutMs: 200, signal: controller.signal }).query("select 1");
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    expect(await Promise.race([operation.catch(() => "aborted"), new Promise(resolve => setTimeout(() => resolve("still_running"),30))])).toBe("aborted");
    expect(destroyed).toBe(true);
  });

});
