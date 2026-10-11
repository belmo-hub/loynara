import { Client } from "pg";
import { pool } from "../../src/db";
import { getCustomerExport } from "../../src/lib/export";

void (async () => {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/looplocal_test" || url.username !== "looplocal" || process.env.PG_POOL_MAX !== "1" || !process.env.TEST_EXPORT_CARD_TOKEN) throw new Error("Synthetic export process required");
  const control = new Client({ connectionString: process.env.DATABASE_URL });
  await control.connect();
  try {
    const first = await getCustomerExport(process.env.TEST_EXPORT_CARD_TOKEN);
    const client = await pool.connect();
    const pid: number = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    client.release();
    const owned = (await control.query("SELECT datname, usename, state FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0];
    if (!owned || owned.datname !== "looplocal_test" || owned.usename !== "looplocal" || owned.state !== "idle") throw new Error("Refuse unowned or active connection");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const ended = new Promise<void>((resolve, reject) => {
      client.once("end", resolve);
      timeout = setTimeout(() => reject(new Error("Owned connection did not end")), 2000);
    });
    try {
      if (!(await control.query("SELECT pg_terminate_backend($1) AS terminated", [pid])).rows[0].terminated) throw new Error("Owned connection was not terminated");
      await ended;
    } finally { clearTimeout(timeout); }
    // The idle error handler must not convert active SQL failures into success.
    let queryRejected = false;
    try { await pool.query("SELECT 1/0"); }
    catch (error) { queryRejected = (error as { code?: string }).code === "22012"; }
    if (!queryRejected) throw new Error("Query failure did not propagate");
    const retry = await getCustomerExport(process.env.TEST_EXPORT_CARD_TOKEN);
    const { exportedAt: beforeTime, ...before } = first;
    const { exportedAt: afterTime, ...after } = retry;
    if (!beforeTime || !afterTime || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Retry export differs");
    console.log(JSON.stringify({ survived: true, queryRejected, balance: retry.membership.balance, ledgerCount: retry.ledger.length }));
  } finally { await control.end(); await pool.end(); }
})().catch(() => { console.error("Synthetic export connection-loss check failed"); process.exitCode = 1; });
