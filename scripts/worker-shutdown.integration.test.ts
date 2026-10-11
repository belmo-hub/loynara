import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/looplocal_test" || database.username !== "looplocal") {
  throw new Error("Requires dedicated local looplocal_test");
}
beforeEach(async () => { await pool.query('TRUNCATE tenants, "user", apple_devices CASCADE'); });
afterAll(() => pool.end());
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function worker(url = database.toString()) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "USER", "SHELL"]) env[key] = process.env[key];
  const applicationName = `shutdown-${randomUUID()}`;
  Object.assign(env, { DATABASE_URL: url, PGAPPNAME: applicationName, PG_POOL_MAX: "5", NODE_ENV: "test",
    DOTENV_CONFIG_PATH: "/tmp/loynara-no-dotenv-worker-075", SMTP_HOST: "disabled", EXTERNAL_EMAIL_ENABLED: "false",
    TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "false", PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "false",
    PASSFAST_ENABLED: "false", APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false", LIVE_BILLING_ENABLED: "false" });
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/worker.ts", "--once"], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env,
  });
  let output = "";
  child.stdout.on("data", part => { output += part; });
  child.stderr.on("data", part => { output += part; });
  const done = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  return { child, applicationName, done, output: () => output };
}

describe("actual worker shutdown during housekeeping", () => {
  it("stops cleanly without spending queued attempts and allows a fresh worker to process them", async () => {
    const tenant = (await pool.query("INSERT INTO tenants(name,slug) VALUES ('Synthetic shutdown merchant',$1) RETURNING id", [randomUUID()])).rows[0].id;
    const job = (await pool.query("INSERT INTO outbox_jobs(tenant_id,kind,payload) VALUES ($1,'automation.event','{}') RETURNING id", [tenant])).rows[0].id;
    const gate = await pool.connect();
    let running: ReturnType<typeof worker> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query("LOCK TABLE card_recovery_challenges IN ACCESS EXCLUSIVE MODE");
      running = worker();
      let waiting = false;
      for (let i = 0; i < 200 && !waiting; i++) {
        waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'DELETE FROM card_recovery_challenges%') AS waiting", [running.applicationName])).rows[0].waiting;
        if (!waiting) await pause(10);
      }
      expect(waiting, running.output()).toBe(true);
      const stoppedAt = Date.now();
      running.child.kill("SIGTERM");
      const exit = await Promise.race([running.done, pause(7000).then(() => "still_running")]);
      expect(exit, running.output()).toBe(0);
      expect(Date.now() - stoppedAt).toBeLessThan(3000);
      expect((await pool.query("SELECT status,attempts FROM outbox_jobs WHERE id=$1", [job])).rows[0]).toEqual({ status: "pending", attempts: 0 });
      expect(running.output()).not.toContain("Worker failed");
      await gate.query("ROLLBACK");
      const next = worker();
      try {
        expect(await next.done, next.output()).toBe(0);
        expect((await pool.query("SELECT status,attempts,last_error FROM outbox_jobs WHERE id=$1", [job])).rows[0]).toEqual({ status: "blocked", attempts: 1, last_error: "Invalid automation event payload" });
      } finally { next.child.kill("SIGKILL"); }
    } finally { running?.child.kill("SIGKILL"); await gate.query("ROLLBACK"); gate.release(); }
  });

  it("preserves a real startup database failure as a sanitized nonzero exit", async () => {
    const invalid = new URL(database);
    invalid.username = "looplocal_missing_075";
    expect((await pool.query("SELECT count(*)::int AS count FROM pg_roles WHERE rolname=$1", [invalid.username])).rows[0].count).toBe(0);
    const running = worker(invalid.toString());
    try {
      expect(await running.done).toBe(1);
      expect(running.output()).toContain("Worker failed; check reviewed configuration and database availability");
      expect(running.output()).not.toContain(invalid.toString());
      expect(running.output()).not.toContain(invalid.username);
      expect(running.output()).not.toContain(database.password);
    } finally { running.child.kill("SIGKILL"); }
  });
});
