import { Client } from "pg";
import { pool } from "../../src/db";
import { GET } from "../../src/app/api/card/[token]/export/route";

void (async () => {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  const token = process.env.TEST_EXPORT_CARD_TOKEN;
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/looplocal_test" || url.username !== "looplocal" || process.env.PG_POOL_MAX !== "1" || !token) throw new Error("Synthetic export process required");
  const control = new Client({ connectionString: process.env.DATABASE_URL });
  await control.connect();
  const original = Client.prototype.query;
  let resume!: () => void, reached!: () => void;
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  const read = new Promise<void>(resolve => { reached = resolve; });
  const targets: Client[] = [];
  let pid: number | undefined;
  let rollbackRejected = false;
  const request = (bearer: string) => GET(new Request("http://localhost:3000/api/card/synthetic/export"), { params: Promise.resolve({ token: bearer }) });
  try {
    if ((await control.query("SHOW data_directory")).rows[0].data_directory !== "/private/tmp/loynara-goal-133-pg") throw new Error("Refuse unowned database");
    const before = await request(token);
    if (before.status !== 200) throw new Error("Baseline export failed");
    const first = await before.json();
    Client.prototype.query = (function (this: Client, ...args: unknown[]) {
      const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
      const result = Reflect.apply(original, this, args);
      if (targets[0] === this && text === "rollback") return (result as Promise<unknown>).catch(error => { rollbackRejected = true; throw error; });
      if (targets.length || !text?.startsWith("select") || !text.includes('from "memberships"') || !text.includes('"card_token"')) return result;
      targets.push(this);
      return (result as Promise<unknown>).then(async rows => {
        const identity = await Reflect.apply(original, this, ["SELECT pg_backend_pid() AS pid, current_setting('transaction_read_only') AS readonly, current_setting('transaction_isolation') AS isolation"]);
        if (identity.rows[0].readonly !== "on" || identity.rows[0].isolation !== "repeatable read") throw new Error("Expected export snapshot transaction");
        pid = identity.rows[0].pid;
        reached();
        await barrier;
        return rows;
      });
    }) as typeof original;
    const pending = request(token);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([read, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Active export gate not reached")), 2000); })]);
      const owned = (await control.query("SELECT datname, usename, state FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0];
      if (!targets[0] || !owned || owned.datname !== "looplocal_test" || owned.usename !== "looplocal" || owned.state !== "idle in transaction") throw new Error("Refuse unowned export connection");
      const ended = new Promise<void>(resolve => { targets[0].once("end", resolve); });
      if (!(await control.query("SELECT pg_terminate_backend($1) AS terminated", [pid])).rows[0].terminated) throw new Error("Owned export was not terminated");
      await ended;
      resume();
      const interrupted = await pending;
      if (interrupted.status !== 500 || interrupted.headers.has("Content-Disposition") || JSON.stringify(await interrupted.json()) !== JSON.stringify({ error: "Internal error" })) throw new Error("Interrupted export presented as successful");
    } finally { clearTimeout(timeout); resume(); Client.prototype.query = original; }
    if (!rollbackRejected) throw new Error("Expected failed rollback after connection loss");
    const healthy = await pool.connect();
    try {
      if ((await healthy.query("SELECT pg_backend_pid() AS pid")).rows[0].pid === pid) throw new Error("Failed client reused");
    } finally { healthy.release(); }
    const retry = await request(token);
    if (retry.status !== 200) throw new Error("Healthy explicit retry failed");
    const after = await retry.json();
    const { exportedAt: firstTime, ...firstData } = first;
    const { exportedAt: afterTime, ...afterData } = after;
    if (!firstTime || !afterTime || JSON.stringify(firstData) !== JSON.stringify(afterData)) throw new Error("Retry changed customer data");
    const invalid = await request(`card_${"x".repeat(40)}`);
    if (invalid.status !== 404) throw new Error("Invalid credential accepted");
    console.log(JSON.stringify({ survived: true, rollbackRejected, failedClientDiscarded: true, interruptedStatus: 500, retryStatus: 200, invalidStatus: 404, balance: after.membership.balance, ledgerCount: after.ledger.length }));
  } finally { resume(); Client.prototype.query = original; await control.end(); await pool.end(); }
})().catch(() => { console.error("Synthetic active export loss check failed"); process.exitCode = 1; });
