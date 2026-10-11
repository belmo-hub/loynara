import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Real CLI, entirely synthetic transports: no database query/migration or network
// operation reaches an external system, including the child drizzle executable.
describe("migration CLI safe failure boundary", () => {
  function run(mode: string, code = "28P01") {
    const dir = mkdtempSync(path.join(tmpdir(), "loynara-migration-cli-"));
    try {
      const trace = path.join(dir, "trace.txt");
      const preload = path.join(dir, "transport.cjs");
      writeFileSync(trace, "");
      writeFileSync(preload, `
        const fs = require('node:fs');
        const { createRequire, syncBuiltinESMExports } = require('node:module');
        const { EventEmitter } = require('node:events');
        const pg = createRequire(process.cwd() + '/package.json')('pg');
        const mode = process.env.MIGRATION_REHEARSAL_MODE;
        const record = value => fs.appendFileSync(process.env.MIGRATION_REHEARSAL_TRACE, value + '\\n');
        const fail = () => {
          const error = new Error('synthetic-migration-secret https://user:synthetic-migration-password@private-migration-host/token');
          error.name = 'synthetic-migration-name'; error.code = process.env.MIGRATION_REHEARSAL_CODE;
          error.detail = 'synthetic-migration-detail';
          if (mode === 'cycle') { error.code = 'synthetic-untrusted-code'; error.cause = error; }
          if (mode === 'getter') Object.defineProperty(error, 'code', { get() { throw new Error('synthetic-wrapper-secret'); } });
          if (mode === 'nested') throw new Error('synthetic-wrapper-secret', { cause: error });
          throw error;
        };
        pg.Client.prototype.connect = async function() { record('connect'); if (mode === 'connect') fail(); };
        pg.Client.prototype.query = async function(sql) {
          if (sql.includes('pg_try_advisory_lock')) { record('lock'); return { rows: [{ acquired: mode !== 'locked' }] }; }
          if (sql.includes('information_schema.tables')) {
            record('inspect'); if (['query','nested','cycle','getter'].includes(mode)) fail();
            return { rows: (mode === 'schema' ? ['user'] : ['user','session','account','verification']).map(table_name => ({ table_name })) };
          }
          if (sql.includes('to_regclass')) { record('verify'); return { rows: [{auth:'user',tenants:'tenants',ledger:'ledger_entries',trigger_count:mode === 'verification' ? '0' : '1'}] }; }
          if (sql.includes('pg_advisory_unlock')) { record('unlock'); return { rows: [] }; }
          throw new Error('Unexpected query: no actual SQL allowed');
        };
        pg.Client.prototype.end = async function() { record('close'); };
        require('node:child_process').spawn = function(executable, args, options) {
          if (!executable.endsWith('/node_modules/.bin/drizzle-kit') || args.join() !== 'migrate' || options.stdio !== 'ignore') throw new Error('Unexpected subprocess');
          record('child'); const child = new EventEmitter();
          setImmediate(() => child.emit('exit', mode === 'child' ? 1 : 0)); return child;
        };
        syncBuiltinESMExports();
        globalThis.fetch = async () => { throw new Error('Network forbidden in migration rehearsal'); };
      `);
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH, NODE_ENV: "production", PRODUCTION_ENVIRONMENT: "loynara-production",
        PRODUCTION_APPROVED_ORIGIN: "https://app.getloynara.com",
        DATABASE_URL: "postgresql://web:synthetic-web-password@db.railway.internal:5432/loynara",
        MIGRATION_DATABASE_URL: "postgresql://migrator:synthetic-migration-password@db.railway.internal:5432/loynara",
        BETTER_AUTH_URL: "https://app.getloynara.com", PUBLIC_BASE_URL: "https://app.getloynara.com",
        BETTER_AUTH_SECRET: "a".repeat(64), SMTP_HOST: "disabled", PG_POOL_MAX: "5", TRUSTED_INGRESS: "cloudflare_tunnel",
        PRODUCTION_MIGRATION_APPROVED: mode === "approval" ? "false" : "true",
        PUBLIC_REGISTRATION_ENABLED: "false", EXTERNAL_EMAIL_ENABLED: "false", PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "false",
        TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "false", BILLING_FIXTURE_MODE: "false",
        MIGRATION_REHEARSAL_TRACE: trace, MIGRATION_REHEARSAL_MODE: mode, MIGRATION_REHEARSAL_CODE: code,
      };
      const result = spawnSync(process.execPath, ["--require", preload, "--import", "tsx", "scripts/production-migrate.ts"], {
        cwd: path.resolve(__dirname, ".."), env, encoding: "utf8", timeout: 15_000,
      });
      expect(result.error).toBeUndefined();
      const output = result.stdout + result.stderr;
      for (const secret of ["synthetic-migration-secret", "synthetic-migration-password", "synthetic-web-password", "private-migration-host", "synthetic-migration-name", "synthetic-migration-detail", "synthetic-wrapper-secret", "synthetic-untrusted-code"])
        expect(output).not.toContain(secret);
      return { status: result.status, output, trace: readFileSync(trace, "utf8").trim().split("\n").filter(Boolean) };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  it.each(["connect", "query", "nested"])("redacts %s errors and retains a safe authentication category", mode => {
    const result = run(mode);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain("migration PASS");
    expect(result.output).toContain("Database authentication failed");
    expect(result.trace).toEqual(mode === "connect" ? ["connect"] : ["connect", "lock", "inspect", "unlock", "close"]);
  });
  it("retains successful ordering, lock cleanup and PASS only after verification", () => {
    const result = run("ok");
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("Production migration PASS");
    expect(result.trace).toEqual(["connect", "lock", "inspect", "child", "verify", "unlock", "close"]);
  });
  it.each([
    ["ECONNREFUSED", "Database connection failed"], ["42501", "Database permission denied"],
    ["42P01", "Database schema mismatch"], ["57014", "Database query cancelled or timed out"],
    ["synthetic-untrusted-code", "Production migration failed"],
  ])("preserves safe category %s without raw details", (code, diagnostic) => {
    const result = run("query", code);
    expect(result.status).toBe(1);
    expect(result.output).toContain(diagnostic);
    expect(result.output).not.toContain("migration PASS");
    expect(result.trace).toEqual(["connect", "lock", "inspect", "unlock", "close"]);
  });
  it.each([
    ["approval", "Explicit production migration approval is required", []],
    ["locked", "Another Loynara production migration holds the database lock", ["connect", "lock", "close"]],
    ["schema", "Incomplete auth schema; inspect before migration", ["connect", "lock", "inspect", "unlock", "close"]],
    ["child", "Application migration failed; inspect before retry", ["connect", "lock", "inspect", "child", "unlock", "close"]],
    ["verification", "Migration verification failed: critical tables or append-only trigger missing", ["connect", "lock", "inspect", "child", "verify", "unlock", "close"]],
  ])("retains controlled %s refusal and unchanged cleanup ordering", (mode, diagnostic, trace) => {
    const result = run(mode as string);
    expect(result.status).toBe(1);
    expect(result.output).toContain(diagnostic as string);
    expect(result.output).not.toContain("migration PASS");
    expect(result.trace).toEqual(trace);
  });

  it.each(["cycle", "getter"])("bounds hostile %s exceptions without leaking or hanging", mode => {
    const result = run(mode);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Production migration failed");
    expect(result.output).not.toContain("migration PASS");
    expect(result.trace).toEqual(["connect", "lock", "inspect", "unlock", "close"]);
  });

});
