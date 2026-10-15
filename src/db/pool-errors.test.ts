import { EventEmitter } from "node:events";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardPoolErrors } from "./pool-errors";

// An "error" event without a listener ends the Node process. node-postgres emits one when the database drops an idle
// connection (restart, failover, network), so every pool needs these listeners, not just the application pool.
describe("database pool error handling", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the process alive when an idle or checked-out connection fails, without logging its details", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pool = guardPoolErrors(new Pool({ connectionString: "postgresql://synthetic:synthetic-secret@127.0.0.1:1/none" }));
    expect(() => pool.emit("error", new Error("terminating connection synthetic-secret"), new EventEmitter())).not.toThrow();
    const client = new EventEmitter();
    pool.emit("connect", client);
    expect(() => client.emit("error", new Error("synthetic-secret"))).not.toThrow();
    expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-secret");
  });

  it("protects the sign-in pool as well as the application pool", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { authPool } = await import("@/lib/auth");
    const { pool } = await import("@/db");
    for (const each of [authPool, pool]) expect(() => each.emit("error", new Error("idle connection lost"), new EventEmitter())).not.toThrow();
  });
});
