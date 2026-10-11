import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { outboxHealth } from "./production-ops-check";

describe("production outbox alert decision", () => {
  it("requires no failed, blocked or overdue jobs", () => {
    expect(outboxHealth({ failed: 0, blocked: 0, overdue: 0 })).toBe(true);
    expect(outboxHealth({ failed: 1, blocked: 0, overdue: 0 })).toBe(false);
    expect(outboxHealth({ failed: 0, blocked: 1, overdue: 0 })).toBe(false);
    expect(outboxHealth({ failed: 0, blocked: 0, overdue: 1 })).toBe(false);
  });
});

// Run the real CLI entry point. The preload replaces only PostgreSQL transport and
// HTTP; no remote database or monitor is reachable in this rehearsal.
describe("operations CLI heartbeat outcome", () => {
  const root = path.resolve(__dirname, "..");
  function run(outcome: "ok" | "rejected" | "network" | "database" | "query" | "config" | "unhealthy", code = "28P01") {
    const dir = mkdtempSync(path.join(tmpdir(), "loynara-ops-heartbeat-"));
    try {
      const preload = path.join(dir, "transport.cjs");
      const trace = path.join(dir, "trace.txt");
      writeFileSync(trace, "");
      writeFileSync(preload, `
        const { createRequire } = require('node:module');
        const fs = require('node:fs');
        const pg = createRequire(process.cwd() + '/package.json')('pg');
        const record = value => fs.appendFileSync(process.env.OPS_REHEARSAL_TRACE, value + '\\n');
        const fail = () => {
          const error = new Error('synthetic-diagnostic-secret https://user:synthetic-password@private-host/token');
          error.name = 'synthetic-name-secret'; error.code = process.env.OPS_REHEARSAL_CODE;
          error.detail = 'synthetic-detail-secret';
          throw error;
        };
        pg.Client.prototype.connect = async function() { record('connected'); if (process.env.OPS_REHEARSAL_OUTCOME === 'database') fail(); };
        pg.Client.prototype.query = async function(sql) {
          if (!sql.includes('FROM outbox_jobs')) throw new Error('Unexpected query');
          record('queried');
          if (process.env.OPS_REHEARSAL_OUTCOME === 'query') fail();
          return { rows: [{ failed: process.env.OPS_REHEARSAL_OUTCOME === 'unhealthy' ? '1' : '0', blocked: '0', overdue: '0' }] };
        };
        pg.Client.prototype.end = async function() { record('closed'); };
        globalThis.fetch = async function(input, options) {
          if (String(input) !== 'https://heartbeat.uptimerobot.com/m-synthetic-secret-monitor') throw new Error('Unexpected request');
          if (options.method !== 'GET' || options.redirect !== 'error') throw new Error('Unsafe request');
          record('requested');
          if (process.env.OPS_REHEARSAL_OUTCOME === 'network') throw new Error('synthetic-private-monitor-token');
          return new Response('synthetic-private-response-body', { status: process.env.OPS_REHEARSAL_OUTCOME === 'rejected' ? 503 : 200 });
        };
      `);
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH, NODE_ENV: "production",
        PRODUCTION_ENVIRONMENT: "loynara-production",
        PRODUCTION_APPROVED_ORIGIN: "https://app.getloynara.com",
        DATABASE_URL: "postgresql://merchant:unique-value@db.railway.internal/loynara",
        BETTER_AUTH_URL: "https://app.getloynara.com", PUBLIC_BASE_URL: "https://app.getloynara.com",
        BETTER_AUTH_SECRET: "a".repeat(64), PUBLIC_REGISTRATION_ENABLED: outcome === "config" ? "true" : "false",
        SMTP_HOST: "disabled", BILLING_FIXTURE_MODE: "false", PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "false",
        EXTERNAL_EMAIL_ENABLED: "false", TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "false",
        PG_POOL_MAX: "5", TRUSTED_INGRESS: "cloudflare_tunnel",
        OPS_HEARTBEAT_URL: "https://heartbeat.uptimerobot.com/m-synthetic-secret-monitor",
        OPS_REHEARSAL_TRACE: trace, OPS_REHEARSAL_OUTCOME: outcome, OPS_REHEARSAL_CODE: code,
      };
      const result = spawnSync(process.execPath, ["--require", preload, "--import", "tsx", "scripts/production-ops-check.ts"], {
        cwd: root, env, encoding: "utf8", timeout: 15_000,
      });
      expect(result.error).toBeUndefined();
      expect(readFileSync(trace, "utf8").trim().split("\n").filter(Boolean)).toEqual(outcome === "config" ? [] : outcome === "database" ? ["connected"] : (outcome === "query" || outcome === "unhealthy") ? ["connected", "queried", "closed"] : ["connected", "queried", "requested", "closed"]);
      const output = result.stdout + result.stderr;
      for (const secret of ["m-synthetic-secret-monitor", "synthetic-private-monitor-token", "synthetic-private-response-body", "unique-value", "synthetic-diagnostic-secret", "synthetic-password", "private-host", "synthetic-name-secret", "synthetic-detail-secret"])
        expect(output).not.toContain(secret);
      return { status: result.status, output };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  it.each(["rejected", "network"] as const)("fails without a PASS claim when the heartbeat is %s", outcome => {
    const result = run(outcome);
    expect(result.status, result.output).toBe(1);
    expect(result.output).not.toContain("check PASS");
    expect(result.output).toContain("Operations heartbeat was not acknowledged");
  });
  it("passes only after healthy outbox and acknowledged heartbeat", () => {
    const result = run("ok");
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("check PASS");
  });
  it.each(["database", "query"] as const)("redacts raw %s exceptions while retaining authentication failure classification", outcome => {
    const result = run(outcome);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain("check PASS");
    expect(result.output).toContain("Database authentication failed");
  });

  it.each([
    ["ECONNREFUSED", "Database connection failed"],
    ["42501", "Database permission denied"],
    ["42P01", "Database schema mismatch"],
    ["57014", "Database query cancelled or timed out"],
    ["synthetic-untrusted-code-secret", "Operations check failed"],
  ])("preserves a safe category for %s without echoing exception fields", (code, diagnostic) => {
    const result = run("query", code);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain("check PASS");
    expect(result.output).not.toContain("synthetic-untrusted-code-secret");
    expect(result.output).toContain(diagnostic);
  });
  it("retains controlled configuration refusal details without starting database or monitor work", () => {
    const result = run("config");
    expect(result.status).toBe(1);
    expect(result.output).toContain("Production operations check refused");
    expect(result.output).toContain("Public registration is not approved for production");
    expect(result.output).not.toContain("check PASS");
  });
  it("retains nonsecret outbox counts and operator-review failure before monitor work", () => {
    const result = run("unhealthy");
    expect(result.status).toBe(1);
    expect(result.output).toContain('Outbox requires operator review: {"failed":1,"blocked":0,"overdue":0}');
    expect(result.output).not.toContain("check PASS");
  });

});
