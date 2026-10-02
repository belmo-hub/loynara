import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, privateDecrypt, constants, createPublicKey } from "node:crypto";
import { spawnSync } from "node:child_process";
import { runWithTransaction } from "@better-auth/core/context";
import { auth } from "../src/lib/auth";
import { pool } from "../src/db";
import { OperatorRefusal, assertOperatorTarget, loadTransportKey, provisionIdentity, resetCredential, type AuthContextLike, type ResetContextLike } from "./operator-identity";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const rsa = (bits: number) => generateKeyPairSync("rsa", { modulusLength: bits, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const operatorKeys = rsa(3072);
const identity = { email: "pilot.owner@example.test", name: "Pilot Owner" };

async function context() { return (await auth.$context) as unknown as ResetContextLike & AuthContextLike & { adapter: Parameters<typeof runWithTransaction>[0] }; }
const tx = (ctx: { adapter: Parameters<typeof runWithTransaction>[0] }) => <T>(fn: () => Promise<T>) => runWithTransaction(ctx.adapter, fn) as unknown as Promise<T>;
async function provision(email = identity.email) {
  const ctx = await context();
  const result = await provisionIdentity({ ctx, inTransaction: tx(ctx), identity: { email, name: identity.name }, transportKey: loadTransportKey(operatorKeys.publicKey) });
  return result;
}
async function reset(overrides: Partial<Parameters<typeof resetCredential>[0]> = {}) {
  const ctx = await context();
  return resetCredential({ ctx, inTransaction: tx(ctx), email: identity.email, transportKey: loadTransportKey(operatorKeys.publicKey), ...overrides });
}
async function addSession(userId: string, token: string) {
  await pool.query('insert into session (id, "expiresAt", token, "createdAt", "updatedAt", "userId") values ($1, now() + interval \'1 day\', $2, now(), now(), $3)', [`s-${token}`, token, userId]);
}
const open = (envelope: string) => JSON.parse(privateDecrypt({ key: operatorKeys.privateKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope, "base64")).toString("utf8")) as { email: string; temporary_password: string; auth_user_id: string };
const TABLES_SQL = "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1";
async function counts() {
  const names = (await pool.query<{ table_name: string }>(TABLES_SQL)).rows.map(row => row.table_name);
  const result: Record<string, number> = {};
  for (const name of names) result[name] = Number((await pool.query(`select count(*)::int as n from "${name}"`)).rows[0].n);
  return result;
}
const passwordOf = async (userId: string) => (await pool.query('select password from account where "userId" = $1', [userId])).rows[0].password as string;

describe("operator credential reset (existing owner or staff identity)", () => {
  beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
  afterAll(async () => { await pool.end(); });

  it("replaces the password, revokes every session, and touches nothing else", async () => {
    const created = await provision();
    const other = await provision("someone.else@example.test");
    // The identity is an owner of a merchant: reset must leave tenant and role untouched.
    const tenantId = (await pool.query("insert into tenants (name, slug) values ('Reset Café', 'reset-cafe') returning id")).rows[0].id;
    await pool.query("insert into staff_roles (tenant_id, user_id, role) values ($1, $2, 'owner')", [tenantId, created.userId]);
    await addSession(created.userId, "tok-a"); await addSession(created.userId, "tok-b"); await addSession(other.userId, "tok-other");
    const oldHash = await passwordOf(created.userId);
    const otherHash = await passwordOf(other.userId);
    const before = await counts();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await reset();
    const after = await counts();
    expect(result.status).toBe("reset");
    expect(result.userId).toBe(created.userId);
    expect(result.audit).toMatchObject({ status: "reset", passwordChanged: true, sessionsRevoked: 2, sessionsRemaining: 0, usersCreated: 0, merchantStateTouched: false, emailsSent: 0, emailDomain: "example.test" });
    // Only the sessions of this user are gone; no row is added anywhere.
    expect(after).toEqual({ ...before, session: before.session - 2 });
    expect((await pool.query("select token from session")).rows.map(row => row.token)).toEqual(["tok-other"]);
    expect((await pool.query("select count(*)::int as n from staff_roles where user_id = $1 and role = 'owner'", [created.userId])).rows[0].n).toBe(1);
    expect(await passwordOf(other.userId)).toBe(otherHash);

    const opened = open(result.envelope);
    expect(opened).toMatchObject({ email: identity.email, auth_user_id: created.userId });
    const ctx = await context();
    expect(await ctx.password.verify({ hash: await passwordOf(created.userId), password: opened.temporary_password })).toBe(true);
    expect(await passwordOf(created.userId)).not.toBe(oldHash);
    // The old temporary password (from provisioning) no longer works.
    if (created.status !== "created") throw new Error("expected created");
    expect(await ctx.password.verify({ hash: await passwordOf(created.userId), password: open(created.envelope).temporary_password })).toBe(false);
    // The new password appears nowhere outside the sealed envelope, and nothing was printed.
    expect(JSON.stringify({ ...result, envelope: undefined })).not.toContain(opened.temporary_password);
    expect(JSON.stringify(result.audit)).not.toContain("Pl!");
    expect(JSON.stringify(result.audit)).not.toContain(identity.email);
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    log.mockRestore(); err.mockRestore();
  });

  it("finds the account case-insensitively", async () => {
    const created = await provision();
    const result = await reset({ email: "  PILOT.Owner@Example.TEST " });
    expect(result.userId).toBe(created.userId);
  });

  it("refuses an unknown or malformed e-mail without creating anything", async () => {
    await provision();
    const before = await counts();
    await expect(reset({ email: "nobody@example.test" })).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    await expect(reset({ email: "not-an-email" })).rejects.toMatchObject({ code: "EMAIL_INVALID" });
    expect(await counts()).toEqual(before);
  });

  it("refuses an ambiguous or malformed credential model and changes nothing", async () => {
    const created = await provision();
    await addSession(created.userId, "tok-keep");
    const hash = await passwordOf(created.userId);

    // Two credential accounts for one user.
    await pool.query('insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, \'credential\', $3, $4, now(), now())', ["acc-dup", "dup-account", created.userId, hash]);
    await expect(reset()).rejects.toMatchObject({ code: "CREDENTIAL_ACCOUNT_AMBIGUOUS_OR_MALFORMED" });
    await pool.query("delete from account where id = 'acc-dup'");

    // The single credential account is not the one Better Auth's updatePassword targets (accountId != userId).
    await pool.query('update account set "accountId" = \'something-else\' where "userId" = $1', [created.userId]);
    await expect(reset()).rejects.toMatchObject({ code: "CREDENTIAL_ACCOUNT_AMBIGUOUS_OR_MALFORMED" });
    await pool.query('update account set "accountId" = "userId" where "userId" = $1', [created.userId]);

    // A user with no credential account at all.
    await pool.query('insert into "user" (id, name, email, "emailVerified") values (\'u-social\', \'Social\', \'social@example.test\', false)');
    await expect(reset({ email: "social@example.test" })).rejects.toMatchObject({ code: "CREDENTIAL_ACCOUNT_AMBIGUOUS_OR_MALFORMED" });

    expect(await passwordOf(created.userId)).toBe(hash);
    expect((await pool.query("select token from session")).rows.map(row => row.token)).toEqual(["tok-keep"]);
  });

  it("rolls back completely when the credential cannot be sealed: old password and sessions stay", async () => {
    const created = await provision();
    await addSession(created.userId, "tok-keep");
    const hash = await passwordOf(created.userId);
    const tiny = createPublicKey(rsa(1024).publicKey); // too small to seal the payload
    await expect(reset({ transportKey: tiny })).rejects.toBeTruthy();
    expect(await passwordOf(created.userId)).toBe(hash);
    expect((await pool.query("select token from session")).rows.map(row => row.token)).toEqual(["tok-keep"]);
  });

  it("refuses when an auth hook could send mail or cause side effects", async () => {
    await provision();
    const ctx = await context();
    const hooked = { ...ctx, internalAdapter: ctx.internalAdapter, password: ctx.password, options: { ...ctx.options, emailVerification: { sendVerificationEmail: () => undefined } } } as unknown as ResetContextLike;
    await expect(reset({ ctx: hooked })).rejects.toMatchObject({ code: "UNEXPECTED_AUTH_HOOK" });
  });

  it("uses the same target guard as provisioning", () => {
    for (const target of [undefined, "production"]) expect(() => assertOperatorTarget(target, {})).toThrow(OperatorRefusal);
  });
});

describe("operator reset CLI refuses before touching any database", () => {
  const run = (args: string[], env: Record<string, string | undefined>) => spawnSync("./node_modules/.bin/tsx", ["scripts/operator-reset-credential.ts", ...args], { env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
  const productionEnv = { PRODUCTION_ENVIRONMENT: "loynara-production", NODE_ENV: "production", DATABASE_URL: "postgresql://u:secretpw@localhost:5432/looplocal", BETTER_AUTH_URL: "https://app.example-pilot.test", PUBLIC_BASE_URL: "https://app.example-pilot.test", PUBLIC_REGISTRATION_ENABLED: "false", OPERATOR_TRANSPORT_PUBLIC_KEY: operatorKeys.publicKey };
  it("exits non-zero with a bare reason code on the wrong environment", () => {
    const result = run(["--target", "loynara-production", "--email", "a@b.de"], productionEnv);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("OPERATOR_CREDENTIAL_RESET_REFUSED DATABASE_NOT_PRIVATE_RAILWAY");
    expect(result.stderr).not.toContain("secretpw");
  });
  it("has no password option and requires a target", () => {
    const withPassword = run(["--target", "loynara-production", "--email", "a@b.de", "--password", "hunter2hunter2"], { ...productionEnv, DATABASE_URL: "postgresql://u:p@db.railway.internal:5432/x" });
    expect(withPassword.status).toBe(1);
    expect(withPassword.stdout + withPassword.stderr).not.toContain("hunter2");
    expect(run(["--email", "a@b.de"], productionEnv).stderr.trim()).toBe("OPERATOR_CREDENTIAL_RESET_REFUSED TARGET_REQUIRED");
  });
});
