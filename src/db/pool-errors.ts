import type { Pool } from "pg";

/** Every PostgreSQL pool in a long-running process needs these listeners: an unhandled "error" event ends the process. */
export function guardPoolErrors(pool: Pool): Pool {
  // A checked-out client can emit an error between transaction queries, when
  // pg-pool has removed its idle listener. Keep that event from crashing the
  // process; node-postgres marks the client unqueryable, subsequent SQL rejects,
  // and release discards it. Request handlers and the idle pool listener retain
  // their existing safe diagnostics. Never retry or turn a failed query into data.
  pool.on("connect", client => { client.on("error", () => undefined); });
  // node-postgres already discards the failed idle client before emitting this
  // event. Handle it without exposing connection details or replaying any query;
  // active query/transaction failures still reject at their existing call sites.
  pool.on("error", () => { console.error("Database idle connection failed"); });
  return pool;
}
