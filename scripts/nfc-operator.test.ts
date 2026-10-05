import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const folder = mkdtempSync(path.join(os.tmpdir(), "nfc-operator-offline-"));
const marker = path.join(folder, "side-effects.txt");
const envFile = path.join(folder, "blocked.env");
const custodyFile = path.join(folder, "blocked-custody.json");
const hook = path.join(folder, "deny-side-effects.mjs");
writeFileSync(envFile, "DATABASE_URL=postgresql://synthetic:do-not-read@invalid.invalid/blocked\n");
// Real subprocess boundaries: never permit a hardware child or database import,
// and record any attempted envfile read or random key/reference generation.
writeFileSync(hook, `
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import crypto from 'node:crypto';
import child from 'node:child_process';
const mark = action => { fs.appendFileSync(${JSON.stringify(marker)}, action + '\\n'); throw new Error('FORBIDDEN_SIDE_EFFECT'); };
const read = fs.promises.readFile;
fs.promises.readFile = (...args) => String(args[0]) === ${JSON.stringify(envFile)} ? mark('envfile') : read(...args);
const open = fs.promises.open;
fs.promises.open = (...args) => String(args[0]) === ${JSON.stringify(custodyFile)} ? mark('transport key custody') : open(...args);
child.spawn = () => mark('hardware/auth/write bridge');
crypto.randomBytes = () => mark('key/reference generation');
syncBuiltinESMExports();
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'drizzle-orm' || /(?:^|\\/)src\\/db(?:$|\\/)/.test(specifier) || specifier.includes('secure-tap') && !specifier.includes('secure-tap-crypto')) mark('database import');
  return next(specifier, context);
} });
`);
afterAll(() => rmSync(folder, { recursive: true, force: true }));

function run(args: string[]) {
  rmSync(marker, { force: true });
  const result = spawnSync(process.execPath, ["--import", "tsx", "--import", hook, "scripts/nfc-operator.ts", ...args], {
    cwd: path.resolve("."),
    // No inherited production environment or key material.
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, encoding: "utf8", timeout: 15_000,
  });
  return { ...result, attempted: existsSync(marker) ? readFileSync(marker, "utf8") : "" };
}

describe("NFC operator offline execution boundary", () => {
  it.each(["provision", "resume"])("%s defaults to an offline static plan with no environment or device activity", command => {
    const result = run([command, "--target", "production", "--env-file", envFile, "--transport-keys-file", custodyFile]);
    expect(result.attempted).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/OFFLINE DRY RUN/);
    expect(result.stdout).toMatch(/chip state.*not observed/i);
  });
  it("preview provisioning also defaults to offline", () => {
    const result = run(["provision", "--target", "preview", "--env-file", envFile]);
    expect(result.attempted).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/OFFLINE DRY RUN/);
  });
  it.each(["provision", "resume"])("%s accepts an explicit dry-run flag", command => {
    const result = run([command, "--target", "production", "--dry-run", "--env-file", envFile]);
    expect(result.attempted).toBe("");
    expect(result.status).toBe(0);
  });
  it.each(["provision", "resume", "tag-revoke"])("%s refuses execution without provenance before any side effect", command => {
    const result = run([command, "--target", command === "tag-revoke" ? "preview" : "production", "--execute", "--env-file", envFile, "--transport-keys-file", custodyFile]);
    expect(result.attempted).toBe("");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/PROVENANCE_REQUIRED/);
  });
  it("refuses conflicting dry-run and execution flags offline", () => {
    const result = run(["provision", "--target", "production", "--dry-run", "--execute", "--provenance-ref", "operator-receipt-001", "--env-file", envFile]);
    expect(result.attempted).toBe("");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/CONFLICTING_EXECUTION_FLAGS/);
  });
  it.each(["provision", "resume"])("%s requires a transport custody file before any side effect", command => {
    const result = run([command, "--target", "production", "--execute", "--provenance-ref", "review-001", "--env-file", envFile]);
    expect(result.attempted).toBe("");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/TRANSPORT_KEYS_REQUIRED/);
  });
});
