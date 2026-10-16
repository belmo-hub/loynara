import { afterAll, beforeEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pool } from "@/db";
import { nfcFixture } from "./nfc-test-db";
import { award } from "./loyalty";
import { getCustomerExport } from "./export";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./disposable-test-database";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
assertLocalTestDatabaseUrl();
if (database.username !== "looplocal") throw new Error("Synthetic export database required");
beforeEach(async () => { await assertDisposableDatabase(pool); await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });
it("survives active export connection loss, rejects incomplete response and preserves healthy explicit retry", async () => {
  const own = await nfcFixture(), foreign = await nfcFixture();
  for (const [fixture, quantity] of [[own, 2], [foreign, 5]] as const) await award({ userId: fixture.userId, locationId: fixture.location.id, membershipId: fixture.member.id, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const before = await getCustomerExport(own.member.cardToken), foreignBefore = await getCustomerExport(foreign.member.cardToken);
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "USER", "SHELL"]) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { DATABASE_URL: process.env.DATABASE_URL, PG_POOL_MAX: "1", TEST_EXPORT_CARD_TOKEN: own.member.cardToken, NODE_ENV: "test", BETTER_AUTH_SECRET: "synthetic-export-disconnect-regression-only", PUBLIC_BASE_URL: "http://localhost:3000", BETTER_AUTH_URL: "http://localhost:3000", EXTERNAL_EMAIL_ENABLED: "false", SMTP_HOST: "localhost", APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false", PASSFAST_ENABLED: "false" });
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(path.resolve("node_modules/.bin/tsx"), ["scripts/test-fixtures/customer-export-active-loss.ts"], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Synthetic export child exceeded timeout")); }, 10_000);
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", error => { clearTimeout(timeout); reject(error); }); child.once("close", code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout.trim())).toEqual({ survived: true, rollbackRejected: true, failedClientDiscarded: true, interruptedStatus: 500, retryStatus: 200, invalidStatus: 404, balance: 2, ledgerCount: 1 });
  expect(result.stderr).toContain("Request failed");
  for (const raw of ["terminating connection", "pg-protocol", "Unhandled", "FATAL"]) expect(result.stderr).not.toContain(raw);
  for (const secret of [own.member.cardToken, own.member.scanCode, foreign.member.cardToken, process.env.DATABASE_URL!, database.password]) if (secret) expect(result.stdout + result.stderr).not.toContain(secret);
  const { exportedAt: beforeTime, ...ownData } = before, { exportedAt: foreignTime, ...foreignData } = foreignBefore;
  expect(beforeTime).toBeTruthy(); expect(foreignTime).toBeTruthy();
  expect(await getCustomerExport(own.member.cardToken)).toMatchObject(ownData); expect(await getCustomerExport(foreign.member.cardToken)).toMatchObject(foreignData);
});
