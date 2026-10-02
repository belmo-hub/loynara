import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { db, pool } from "../src/db";
import { secureTags } from "../src/db/schema";
import { DerivedTapKeyProvider, deriveTagKeys, parseMaster } from "../src/lib/nfc-keys";
import { sdmFor, tapUrl } from "../src/lib/nfc-test-support";
import { addStaff, nfcFixture } from "../src/lib/nfc-test-db";
import { buildRegistrationBundle, type RegistrationBundle } from "../src/lib/nfc-provision/production";
import { processSecureTap } from "../src/lib/secure-tap";
import { RegistrationRefusal, registerTag } from "./nfc-register";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const VERIFY = parseMaster("7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a");
const ADMIN = parseMaster("c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e");
const ORIGIN = "https://app.example-pilot.test";
const env = { PUBLIC_BASE_URL: `${ORIGIN}/` };
const provider = new DerivedTapKeyProvider(VERIFY);
const code = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { return error instanceof RegistrationRefusal || (error as { code?: string }).code ? (error as { code: string }).code : "OTHER"; } return "NONE"; };

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

type Fx = Awaited<ReturnType<typeof nfcFixture>>;
function bundleFor(f: Fx, overrides: Partial<RegistrationBundle> = {}, uid = "04de5f1eacc040") {
  const keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  const publicRef = randomBytes(18).toString("base64url");
  const keys = deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: keyRef, uid });
  const sample = tapUrl(ORIGIN, publicRef, sdmFor({ uid, counter: 3, keys }));
  const bundle = buildRegistrationBundle({ tenantId: f.tenant.id, locationId: f.location.id, programId: f.program.id, origin: ORIGIN, uid, publicRef, keyRef, sampleUrl: sample, firstCounter: 2, secondCounter: 3 });
  return { ...bundle, ...overrides } as RegistrationBundle;
}
const register = (f: Fx, bundle: RegistrationBundle, extra: { execute?: boolean; actorUserId?: string; provider?: DerivedTapKeyProvider; env?: Record<string, string | undefined> } = {}) =>
  registerTag({ bundleText: JSON.stringify(bundle), actorUserId: extra.actorUserId ?? f.userId, execute: extra.execute ?? false, env: extra.env ?? env, provider: extra.provider ?? provider, guard: () => undefined });
const tagRows = () => db.select().from(secureTags);

describe("server-side tag registration", () => {
  it("is a dry run by default: every check runs, nothing is written", async () => {
    const f = await nfcFixture();
    const audit = await register(f, bundleFor(f));
    expect(audit).toMatchObject({ status: "would_register", executed: false });
    expect(audit.checks.length).toBeGreaterThanOrEqual(3);
    expect(await tagRows()).toHaveLength(0);
  });

  it("registers on --execute, is idempotent, and the tag then works but the proof read cannot be replayed", async () => {
    const f = await nfcFixture();
    const bundle = bundleFor(f);
    const audit = await register(f, bundle, { execute: true });
    expect(audit).toMatchObject({ status: "registered", executed: true });
    const rows = await tagRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", publicRef: bundle.publicRef, uid: bundle.uid, keyRef: bundle.keyRef, lastCounter: 3, programId: f.program.id });
    expect(await register(f, bundle, { execute: true })).toMatchObject({ status: "already_registered", tagId: rows[0].id });
    expect(await tagRows()).toHaveLength(1);
    const keys = deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: bundle.keyRef, uid: bundle.uid });
    await expect(processSecureTap({ tagRef: bundle.publicRef, fields: { encrypted: new URL(bundle.sampleUrl).searchParams.get("e")!, mac: new URL(bundle.sampleUrl).searchParams.get("c")! }, cardToken: f.member.cardToken, keyProvider: provider })).rejects.toMatchObject({ code: "REPLAYED_TAP" });
    expect(await processSecureTap({ tagRef: bundle.publicRef, fields: sdmFor({ uid: bundle.uid, counter: 4, keys }), cardToken: f.member.cardToken, keyProvider: provider, now: new Date("2026-10-02T10:00:00Z") })).toMatchObject({ state: "pending_staff" });
  });

  it("recovers from an interrupted registration: a provisioned-but-inactive row is finished, not duplicated", async () => {
    const f = await nfcFixture();
    const bundle = bundleFor(f);
    const { provisionSecureTag } = await import("../src/lib/secure-tap");
    await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid: bundle.uid, keyRef: bundle.keyRef, configVersion: 1, publicRef: bundle.publicRef });
    expect((await tagRows())[0].status).toBe("provisioned");
    expect(await register(f, bundle, { execute: true })).toMatchObject({ status: "registered" });
    const rows = await tagRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
  });

  it.each([
    ["a sample the server cannot verify", (b: RegistrationBundle) => ({ ...b, sampleUrl: b.sampleUrl.replace(/c=[0-9a-f]{16}/, "c=0000000000000000") }), "SAMPLE_DOES_NOT_VERIFY_WITH_SERVER_KEYS"],
    ["a sample for another counter", (b: RegistrationBundle) => ({ ...b, secondCounter: 9 }), "SAMPLE_UID_OR_COUNTER_MISMATCH"],
    ["a sample for another reference", (b: RegistrationBundle) => ({ ...b, publicRef: randomBytes(18).toString("base64url") }), "SAMPLE_URL_DOES_NOT_MATCH_BUNDLE"],
    ["a bundle for another deployment", (b: RegistrationBundle) => ({ ...b, origin: "https://other.example-pilot.test" }), "BUNDLE_ORIGIN_IS_NOT_THIS_DEPLOYMENT"],
    ["a preview bundle", (b: RegistrationBundle) => ({ ...b, origin: "https://preview.getloynara.com" }), "BUNDLE_ORIGIN_IS_NOT_THIS_DEPLOYMENT"],
  ])("refuses %s", async (_name, mutate, expected) => {
    const f = await nfcFixture();
    expect(await code(() => register(f, mutate(bundleFor(f)), { execute: true }))).toBe(expected);
    expect(await tagRows()).toHaveLength(0);
  });

  it("verifies the binding against the database, not the bundle", async () => {
    const f = await nfcFixture(); const other = await nfcFixture();
    expect(await code(() => register(f, bundleFor(f, { locationId: other.location.id })))).toBe("BINDING_DOES_NOT_MATCH_THE_DATABASE");
    expect(await code(() => register(f, bundleFor(f, { tenantId: other.tenant.id })))).toBe("BINDING_DOES_NOT_MATCH_THE_DATABASE");
    expect(await code(() => register(f, bundleFor(f, { programId: other.program.id })))).toBe("BINDING_DOES_NOT_MATCH_THE_DATABASE");
    const off = await nfcFixture({ tapMode: "disabled" });
    expect(await code(() => register(off, bundleFor(off)))).toBe("OWNER_MUST_SET_STAFF_CONFIRMED_FIRST");
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    expect(await code(() => register(f, bundleFor(f), { actorUserId: cashier }))).toBe("ACTOR_IS_NOT_AN_ACTIVE_OWNER_OF_THIS_MERCHANT");
    expect(await code(() => register(f, bundleFor(f), { actorUserId: other.userId }))).toBe("ACTOR_IS_NOT_AN_ACTIVE_OWNER_OF_THIS_MERCHANT");
    expect(await tagRows()).toHaveLength(0);
  });

  it("never reuses a reference or lets a live chip appear under two references", async () => {
    const f = await nfcFixture();
    const first = bundleFor(f);
    await register(f, first, { execute: true });
    expect(await code(() => register(f, bundleFor(f, {}), { execute: true }))).toBe("CHIP_ALREADY_ACTIVE_UNDER_ANOTHER_REFERENCE");
    const second = bundleFor(f, {}, "04de5f1eacc041");
    expect(await code(() => register(f, { ...second, publicRef: first.publicRef, sampleUrl: tapUrl(ORIGIN, first.publicRef, sdmFor({ uid: second.uid, counter: 3, keys: deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: second.keyRef, uid: second.uid }) })) }, { execute: true }))).toBe("REFERENCE_ALREADY_USED_BY_ANOTHER_TAG");
    expect(await tagRows()).toHaveLength(1);
  });

  it("returns an audit with no key material, UID or key reference", async () => {
    const f = await nfcFixture();
    const bundle = bundleFor(f);
    const text = JSON.stringify(await register(f, bundle, { execute: true }));
    for (const secret of [bundle.uid, bundle.keyRef, bundle.sampleUrl, "keyRef", "master"]) expect(text).not.toContain(secret);
  });

  it("the CLI refuses before any database work outside the production deployment", () => {
    const run = (args: string[], e: Record<string, string>) => spawnSync("./node_modules/.bin/tsx", ["scripts/operator-register-tag.ts", ...args], { env: { PATH: process.env.PATH ?? "", ...e } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
    const noTarget = run(["--actor-user-id", "abcdefgh"], { NFC_TAG_BUNDLE: "{}" });
    expect(noTarget.status).toBe(1);
    expect(noTarget.stderr.trim()).toBe("NFC_TAG_REGISTRATION_REFUSED TARGET_REQUIRED");
    const wrongEnv = run(["--target", "loynara-production", "--actor-user-id", "abcdefgh"], { NFC_TAG_BUNDLE: "{}", DATABASE_URL: "postgresql://u:secretpw@localhost:5432/looplocal" });
    expect(wrongEnv.status).toBe(1);
    expect(wrongEnv.stderr.trim()).toMatch(/^NFC_TAG_REGISTRATION_REFUSED (WRONG_ENVIRONMENT_MARKER|BUNDLE_INVALID)$/);
    expect(wrongEnv.stderr + wrongEnv.stdout).not.toContain("secretpw");
  });
});
