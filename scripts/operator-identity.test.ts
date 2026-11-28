import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { runWithTransaction } from "@better-auth/core/context";
import { auth } from "../src/lib/auth";
import { pool } from "../src/db";
import { OperatorRefusal, assertOperatorTarget, loadTransportKey, normalizeIdentity, provisionIdentity, type AuthContextLike } from "./operator-identity";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const rsa = (bits: number) => generateKeyPairSync("rsa", { modulusLength: bits, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const operatorKeys = rsa(3072);

const productionEnv = {
  PRODUCTION_ENVIRONMENT: "loynara-production", NODE_ENV: "production", DATABASE_URL: "postgresql://user:pw@loynara-postgres.railway.internal:5432/railway",
  BETTER_AUTH_URL: "https://app.example-pilot.test", PUBLIC_BASE_URL: "https://app.example-pilot.test", PUBLIC_REGISTRATION_ENABLED: "false",
};
const refusalCode = (fn: () => unknown) => { try { fn(); } catch (error) { return error instanceof OperatorRefusal ? error.code : "OTHER"; } return "NONE"; };

const refusals: [string, string | undefined, Record<string, string | undefined>, string][] = [
  ["no target", undefined, {}, "TARGET_REQUIRED"],
  ["unknown target", "production", {}, "TARGET_REQUIRED"],
  ["missing production marker", "loynara-production", { PRODUCTION_ENVIRONMENT: undefined }, "WRONG_ENVIRONMENT_MARKER"],
  ["device-test marker", "loynara-production", { PRODUCTION_ENVIRONMENT: "device-test" }, "WRONG_ENVIRONMENT_MARKER"],
  ["NODE_ENV development", "loynara-production", { NODE_ENV: "development" }, "NODE_ENV_NOT_PRODUCTION"],
  ["public Railway TCP proxy", "loynara-production", { DATABASE_URL: "postgresql://u:p@roundhouse.proxy.rlwy.net:12345/railway" }, "DATABASE_NOT_PRIVATE_RAILWAY"],
  ["localhost database", "loynara-production", { DATABASE_URL: "postgresql://u:p@localhost:5432/looplocal" }, "DATABASE_NOT_PRIVATE_RAILWAY"],
  ["unparseable database url", "loynara-production", { DATABASE_URL: "nonsense" }, "DATABASE_URL_INVALID"],
  ["http origin", "loynara-production", { BETTER_AUTH_URL: "http://app.example-pilot.test", PUBLIC_BASE_URL: "http://app.example-pilot.test" }, "APP_ORIGIN_NOT_PRODUCTION"],
  ["localhost origin", "loynara-production", { BETTER_AUTH_URL: "https://localhost", PUBLIC_BASE_URL: "https://localhost" }, "APP_ORIGIN_NOT_PRODUCTION"],
  ["origin mismatch", "loynara-production", { PUBLIC_BASE_URL: "https://other.example-pilot.test" }, "APP_ORIGIN_NOT_PRODUCTION"],
  ["registration enabled", "loynara-production", { PUBLIC_REGISTRATION_ENABLED: "true" }, "PUBLIC_REGISTRATION_NOT_DISABLED"],
  ["registration unset", "loynara-production", { PUBLIC_REGISTRATION_ENABLED: undefined }, "PUBLIC_REGISTRATION_NOT_DISABLED"],
  ["local target on production", "local", { PRODUCTION_ENVIRONMENT: "loynara-production" }, "LOCAL_TARGET_ON_PRODUCTION"],
  ["local target on a Railway database", "local", { PRODUCTION_ENVIRONMENT: undefined, NODE_ENV: "development" }, "NOT_A_LOCAL_TARGET"],
];

describe("operator identity: target guard", () => {
  it("accepts exactly the production deployment", () => {
    expect(assertOperatorTarget("loynara-production", productionEnv)).toBe("loynara-production");
  });
  it.each(refusals)("refuses: %s", (_name, target, override, code) => {
    expect(refusalCode(() => assertOperatorTarget(target, { ...productionEnv, ...override } as Record<string, string | undefined>))).toBe(code);
  });
  it.each(refusals.filter(([, , , code]) => code !== "PUBLIC_REGISTRATION_NOT_DISABLED"))("still refuses with allowOpenRegistration: %s", (_name, target, override, code) => {
    expect(refusalCode(() => assertOperatorTarget(target, { ...productionEnv, PUBLIC_REGISTRATION_ENABLED: "true", ...override } as Record<string, string | undefined>, { allowOpenRegistration: true }))).toBe(code);
  });
  it("lets a tool that opts in through with shop sign-up open, and nothing else", () => {
    const open = { ...productionEnv, PUBLIC_REGISTRATION_ENABLED: "true" };
    expect(assertOperatorTarget("loynara-production", open, { allowOpenRegistration: true })).toBe("loynara-production");
    expect(refusalCode(() => assertOperatorTarget("loynara-production", open))).toBe("PUBLIC_REGISTRATION_NOT_DISABLED");
    expect(refusalCode(() => assertOperatorTarget("loynara-production", { ...open, DATABASE_URL: "postgresql://u:p@localhost:5432/x" }, { allowOpenRegistration: true }))).toBe("DATABASE_NOT_PRIVATE_RAILWAY");
  });
  // Every console tool runs on production with shop sign-up open, except the two that create or reset a login.
  const consoleTools: Record<string, boolean> = {
    "operator-provision-identity.ts": false, "operator-reset-credential.ts": false,
    "operator-register-tag.ts": true, "operator-plate.ts": true, "operator-programme.ts": true, "operator-wallet-templates.ts": true,
    "operator-shop-erasure.ts": true, "reapply-erasures.ts": true,
  };
  it("pins every console tool's choice of allowOpenRegistration", () => {
    const callers = readdirSync(__dirname).filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "operator-identity.ts" && readFileSync(`${__dirname}/${file}`, "utf8").includes("assertOperatorTarget("));
    expect(callers.sort()).toEqual(Object.keys(consoleTools).sort());
    for (const file of callers) {
      const calls = readFileSync(`${__dirname}/${file}`, "utf8").match(/assertOperatorTarget\([^)]*\)/g) ?? [];
      expect(calls.length, file).toBe(1);
      expect(calls[0]?.includes("allowOpenRegistration: true"), file).toBe(consoleTools[file]);
    }
  });
  it("accepts the local target only for the loopback looplocal database", () => {
    const local = { NODE_ENV: "development", DATABASE_URL: "postgresql://looplocal:x@localhost:54329/looplocal", BETTER_AUTH_URL: "http://localhost:3000", PUBLIC_BASE_URL: "http://localhost:3000" };
    expect(assertOperatorTarget("local", local)).toBe("local");
    expect(refusalCode(() => assertOperatorTarget("local", { ...local, DATABASE_URL: "postgresql://x:y@loynara-postgres.railway.internal:5432/railway" }))).toBe("NOT_A_LOCAL_TARGET");
  });
});

describe("operator identity: demo target", () => {
  const demoEnv = {
    DEMO_ENVIRONMENT: "true", NODE_ENV: "production", DATABASE_URL: "postgresql://postgres:pw@postgres-demo.railway.internal:5432/railway",
    BETTER_AUTH_URL: "https://demo.example-pilot.test", PUBLIC_BASE_URL: "https://demo.example-pilot.test", PUBLIC_REGISTRATION_ENABLED: "false",
  };
  it("accepts the demo environment", () => {
    expect(assertOperatorTarget("loynara-demo", demoEnv)).toBe("loynara-demo");
  });
  it.each([
    ["the production deployment", { PRODUCTION_ENVIRONMENT: "loynara-production" }, "DEMO_TARGET_ON_PRODUCTION"],
    ["demo environment off", { DEMO_ENVIRONMENT: "false" }, "NOT_DEMO_ENVIRONMENT"],
    ["demo environment unset", { DEMO_ENVIRONMENT: undefined }, "NOT_DEMO_ENVIRONMENT"],
    ["a database that does not name itself demo", { DATABASE_URL: "postgresql://user:pw@loynara-postgres.railway.internal:5432/railway" }, "DATABASE_NOT_DEMO"],
    ["a public TCP proxy", { DATABASE_URL: "postgresql://u:p@demo.proxy.rlwy.net:12345/railway" }, "DATABASE_NOT_PRIVATE_RAILWAY"],
    ["NODE_ENV development", { NODE_ENV: "development" }, "NODE_ENV_NOT_PRODUCTION"],
    ["registration enabled", { PUBLIC_REGISTRATION_ENABLED: "true" }, "PUBLIC_REGISTRATION_NOT_DISABLED"],
  ])("refuses: %s", (_name, override, code) => {
    expect(refusalCode(() => assertOperatorTarget("loynara-demo", { ...demoEnv, ...override } as Record<string, string | undefined>))).toBe(code);
  });
  it("the production target still refuses the demo environment", () => {
    expect(refusalCode(() => assertOperatorTarget("loynara-production", demoEnv))).toBe("WRONG_ENVIRONMENT_MARKER");
  });
});

describe("operator identity: inputs", () => {
  it("normalizes and validates the identity", () => {
    expect(normalizeIdentity({ email: "  Owner@Example.COM ", name: " Mira Test " })).toEqual({ email: "owner@example.com", name: "Mira Test" });
    for (const email of ["", "no-at", "a@b", "a b@c.de", "x@y.z", "<a>@b.de"]) expect(refusalCode(() => normalizeIdentity({ email, name: "N" }))).toBe("EMAIL_INVALID");
    for (const name of ["", "x".repeat(81), "<script>", "line\nbreak"]) expect(refusalCode(() => normalizeIdentity({ email: "a@b.de", name }))).toBe("NAME_INVALID");
  });
  it("requires a strong RSA public key and refuses private keys", () => {
    expect(loadTransportKey(operatorKeys.publicKey).type).toBe("public");
    expect(refusalCode(() => loadTransportKey(undefined))).toBe("TRANSPORT_KEY_REQUIRED");
    expect(refusalCode(() => loadTransportKey(operatorKeys.privateKey))).toBe("TRANSPORT_KEY_IS_PRIVATE");
    expect(refusalCode(() => loadTransportKey("not a key"))).toBe("TRANSPORT_KEY_INVALID");
    expect(refusalCode(() => loadTransportKey(rsa(2048).publicKey))).toBe("TRANSPORT_KEY_TOO_WEAK");
  });
});

const TABLES_SQL = "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1";
async function counts() {
  const names = (await pool.query<{ table_name: string }>(TABLES_SQL)).rows.map(row => row.table_name);
  const result: Record<string, number> = {};
  for (const name of names) result[name] = Number((await pool.query(`select count(*)::int as n from "${name}"`)).rows[0].n);
  return result;
}
const identity = { email: "pilot.owner@example.test", name: "Pilot Owner" };
async function provision(overrides: Partial<Parameters<typeof provisionIdentity>[0]> = {}) {
  const ctx = (await auth.$context) as unknown as AuthContextLike & { adapter: Parameters<typeof runWithTransaction>[0] };
  return provisionIdentity({ ctx, inTransaction: <T>(fn: () => Promise<T>) => runWithTransaction(ctx.adapter, fn) as unknown as Promise<T>, identity, transportKey: loadTransportKey(operatorKeys.publicKey), ...overrides });
}

describe("operator identity: provisioning (real Better Auth against the disposable test database)", () => {
  beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
  afterAll(async () => { await pool.end(); });

  it("creates the identity only: no merchant state, no session, no e-mail, nothing printed", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await counts();
    const result = await provision();
    const after = await counts();
    expect(result.status).toBe("created");
    for (const table of Object.keys(before)) {
      if (table === "user" || table === "account") continue;
      expect(after[table], `table ${table} must be unchanged`).toBe(before[table]);
    }
    expect(after.user).toBe(before.user + 1);
    expect(after.account).toBe(before.account + 1);
    expect(after.session).toBe(0);
    expect(after.staff_roles).toBe(0);
    expect(after.tenants).toBe(0);
    expect(after.outbox_jobs).toBe(0);
    const account = (await pool.query('select "providerId", "accountId", "userId", password from account')).rows[0];
    expect(account.providerId).toBe("credential");
    expect(account.userId).toBe(result.userId);
    expect(account.password).not.toMatch(/Pl!/);
    expect((await pool.query('select "emailVerified" from "user"')).rows[0].emailVerified).toBe(true);
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    log.mockRestore(); err.mockRestore();
  });

  it("delivers the password only inside the sealed envelope, and it matches the stored hash", async () => {
    const result = await provision();
    if (result.status !== "created") throw new Error("expected created");
    const opened = JSON.parse(privateDecrypt({ key: operatorKeys.privateKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(result.envelope, "base64")).toString("utf8")) as { email: string; temporary_password: string; auth_user_id: string };
    expect(opened.email).toBe(identity.email);
    expect(opened.auth_user_id).toBe(result.userId);
    expect(opened.temporary_password.length).toBeGreaterThanOrEqual(43);
    const stored = (await pool.query("select password from account")).rows[0].password as string;
    const ctx = (await auth.$context) as unknown as AuthContextLike;
    expect(await ctx.password.verify({ hash: stored, password: opened.temporary_password })).toBe(true);
    // The password appears nowhere outside the envelope: not in the audit record, not in the result fields.
    const visible = JSON.stringify({ ...result, envelope: undefined });
    expect(visible).not.toContain(opened.temporary_password);
    expect(JSON.stringify(result.audit)).not.toContain(opened.temporary_password);
    expect(JSON.stringify(result.audit)).not.toContain("Pl!");
    expect(result.audit).toMatchObject({ status: "created", merchantStateCreated: false, sessionsCreated: 0, emailsSent: 0, emailDomain: "example.test" });
    expect(JSON.stringify(result.audit)).not.toContain(identity.email);
  });

  it("is idempotent: a retry reports the existing identity and changes nothing, even with different casing", async () => {
    const first = await provision();
    const hashBefore = (await pool.query("select password from account")).rows[0].password;
    const before = await counts();
    const retry = await provision({ identity: { email: "PILOT.Owner@Example.TEST", name: "Someone Else" } });
    expect(retry.status).toBe("existing");
    expect(retry.userId).toBe(first.userId);
    expect("envelope" in retry).toBe(false);
    expect(retry.audit.passwordChanged).toBe(false);
    expect(await counts()).toEqual(before);
    expect((await pool.query("select password from account")).rows[0].password).toBe(hashBefore);
    expect((await pool.query('select name from "user"')).rows[0].name).toBe("Pilot Owner");
  });

  it("refuses to touch an existing user that has no single credential account", async () => {
    await pool.query('insert into "user" (id, name, email, "emailVerified") values ($1, $2, $3, false)', ["u-orphan", "Orphan", identity.email]);
    const before = await counts();
    await expect(provision()).rejects.toMatchObject({ code: "EXISTING_USER_WITHOUT_SINGLE_CREDENTIAL" });
    expect(await counts()).toEqual(before);
  });

  it("rolls back completely if the credential cannot be sealed, leaving no unreachable account", async () => {
    // A 1024-bit key cannot seal the payload: the failure happens after the rows are written, inside the transaction.
    const tiny = loadTransportKeyUnchecked(rsa(1024).publicKey);
    const before = await counts();
    await expect(provision({ transportKey: tiny })).rejects.toBeTruthy();
    expect(await counts()).toEqual(before);
  });

  it("refuses when an auth hook could send mail or cause side effects", async () => {
    const ctx = (await auth.$context) as unknown as AuthContextLike & { adapter: Parameters<typeof runWithTransaction>[0] };
    const hooked = { ...ctx, internalAdapter: ctx.internalAdapter, password: ctx.password, options: { ...ctx.options, databaseHooks: { user: { create: { before: () => undefined } } } } } as AuthContextLike;
    const before = await counts();
    await expect(provision({ ctx: hooked })).rejects.toMatchObject({ code: "UNEXPECTED_AUTH_HOOK" });
    expect(await counts()).toEqual(before);
  });
});

import { createPublicKey } from "node:crypto";
function loadTransportKeyUnchecked(pem: string) { return createPublicKey(pem); }

describe("operator identity: CLI refuses before touching any database", () => {
  const run = (args: string[], env: Record<string, string | undefined>) => spawnSync("./node_modules/.bin/tsx", ["scripts/operator-provision-identity.ts", ...args], { env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
  it("exits non-zero with a bare reason code and prints nothing else when the environment is wrong", () => {
    const result = run(["--target", "loynara-production", "--email", "a@b.de", "--name", "A"], { ...productionEnv, DATABASE_URL: "postgresql://u:secretpw@localhost:5432/looplocal", OPERATOR_TRANSPORT_PUBLIC_KEY: operatorKeys.publicKey });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("OPERATOR_IDENTITY_REFUSED DATABASE_NOT_PRIVATE_RAILWAY");
    expect(result.stderr + result.stdout).not.toContain("secretpw");
  });
  it("has no password option", () => {
    const result = run(["--target", "loynara-production", "--email", "a@b.de", "--name", "A", "--password", "hunter2hunter2"], { ...productionEnv, OPERATOR_TRANSPORT_PUBLIC_KEY: operatorKeys.publicKey });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain("hunter2");
  });
});
