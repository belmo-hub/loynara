import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { plateActivationCodes, plateLinkEvents, programs, secureTags, staffRoles } from "@/db/schema";
import { POST as activateRoute } from "@/app/api/merchant/plate/activate/route";
import { POST as codesRoute } from "@/app/api/operator/plate-codes/route";
import { auth } from "./auth";
import { nfcFixture } from "./nfc-test-db";
import { operatorOverview } from "./operator";
import { ACTIVATION_FAILED, activatePlate, issuePlateCodes, unlockPlateCode } from "./plate-activation";
import { setPlateLink } from "./plates";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./disposable-test-database";

assertLocalTestDatabaseUrl();
const origin = "http://localhost:3000";
const saved = { ids: process.env.PLATE_OPERATOR_USER_IDS, base: process.env.PUBLIC_BASE_URL, registration: process.env.PUBLIC_REGISTRATION_ENABLED };
let operator: { userId: string; cookie: string };
beforeEach(async () => {
  await assertDisposableDatabase(pool);
  await pool.query('TRUNCATE tenants, "user", secure_tags, plate_link_events, plate_activation_codes, rate_limits CASCADE');
  process.env.PUBLIC_BASE_URL = origin; process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  operator = await identity();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
});
afterAll(async () => {
  for (const [key, value] of [["PLATE_OPERATOR_USER_IDS", saved.ids], ["PUBLIC_BASE_URL", saved.base], ["PUBLIC_REGISTRATION_ENABLED", saved.registration]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

async function identity() {
  const email = randomUUID() + "@example.test", password = "Synthetic-Plate-048-Only!";
  const signed = await auth.api.signUpEmail({ body: { name: "Synthetic person", email, password } });
  const response = await auth.handler(new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }));
  return { userId: signed.user.id, cookie: response.headers.getSetCookie().map(x => x.split(";")[0]).join("; ") };
}
async function plate(label: string) {
  await db.insert(secureTags).values({ publicRef: randomUUID().replaceAll("-", "").slice(0, 24), plateLabel: label, uid: `04${randomUUID().replaceAll("-", "").slice(0, 12)}`, keyRef: "dv1_synthetic", configVersion: 1, status: "unlinked", lastCounter: 0 });
}
const env = () => process.env;
const issue = (...plateLabels: string[]) => issuePlateCodes({ actorUserId: operator.userId, env: env(), plateLabels });
const code = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { return (error as { code?: string }).code ?? "OTHER"; } return "NONE"; };
const post = (route: (request: Request) => Promise<Response>, path: string, body: unknown, cookie = "", headers: Record<string, string> = { Origin: origin }) =>
  route(new Request(origin + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const tag = async (label: string) => (await db.select().from(secureTags).where(eq(secureTags.plateLabel, label)))[0];

it("issues codes only for the operator, for free plates, readable and stored only as a hash", async () => {
  const shop = await nfcFixture();
  await plate("P-001"); await plate("P-002");
  for (const cookie of ["", (await identity()).cookie]) { const res = await post(codesRoute, "/api/operator/plate-codes", { action: "issue", plateLabels: ["P-001"] }, cookie); expect(res.status).toBe(404); expect(await res.text()).toBe(""); }
  expect((await post(codesRoute, "/api/operator/plate-codes", { action: "issue", plateLabels: ["P-001"] }, operator.cookie, {})).status).toBe(404);
  expect(await code(() => issuePlateCodes({ actorUserId: shop.userId, env: env(), plateLabels: ["P-001"] }))).toBe("FORBIDDEN");
  expect(await code(() => issuePlateCodes({ actorUserId: operator.userId, env: {}, plateLabels: ["P-001"] }))).toBe("FORBIDDEN");
  expect(await db.select().from(plateActivationCodes)).toEqual([]);

  const res = await post(codesRoute, "/api/operator/plate-codes", { action: "issue", plateLabels: ["p-001", "P-002"] }, operator.cookie);
  expect(res.status).toBe(200);
  const { codes } = await res.json() as { codes: Array<{ plateLabel: string; code: string }> };
  expect(codes.map(c => c.plateLabel)).toEqual(["P-001", "P-002"]);
  for (const { code: plain } of codes) expect(plain).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  const rows = await db.select().from(plateActivationCodes);
  expect(rows).toHaveLength(2);
  for (const row of rows) { expect(row.codeHash).toMatch(/^scrypt\$/); for (const { code: plain } of codes) expect(row.codeHash).not.toContain(plain.replaceAll("-", "")); }
  expect((await operatorOverview(operator.userId)).plates.map(p => p.code)).toEqual(["open", "open"]);
  // Linked plates get no code.
  await setPlateLink({ actorUserId: operator.userId, env: env(), plateLabel: "P-002", programId: shop.program.id, execute: true });
  expect(await code(() => issue("P-002"))).toBe("PLATE_LINKED");
  expect(await code(() => issue("P-404"))).toBe("NOT_FOUND");
});

it("links the plate to the owner's programme once, audited with the owner as actor, only with „Mit Bestätigung“ on", async () => {
  const shop = await nfcFixture(), off = await nfcFixture({ tapMode: "disabled" }), stranger = await identity();
  await plate("P-001"); await plate("P-002");
  await db.update(programs).set({ tapCooldownSeconds: 60 }).where(eq(programs.id, off.program.id)); // a wait time alone is not „Mit Bestätigung“
  const [{ code: plain }, { code: second }] = await issue("P-001", "P-002");
  expect(await code(() => activatePlate({ userId: off.userId, programId: off.program.id, plateLabel: "P-001", code: plain }))).toBe("STAFF_CONFIRMATION_REQUIRED");
  // Tenant scope: another shop's programme, or an account without the owner role there, links nothing.
  expect(await code(() => activatePlate({ userId: off.userId, programId: shop.program.id, plateLabel: "P-001", code: plain }))).toBe("FORBIDDEN");
  expect(await code(() => activatePlate({ userId: stranger.userId, programId: shop.program.id, plateLabel: "P-001", code: plain }))).toBe("FORBIDDEN");
  expect((await tag("P-001")).status).toBe("unlinked");

  expect(await activatePlate({ userId: shop.userId, programId: shop.program.id, plateLabel: " p-001 ", code: plain.toLowerCase().replaceAll("-", " ") })).toMatchObject({ result: "link", plateLabel: "P-001" });
  expect(await tag("P-001")).toMatchObject({ status: "active", tenantId: shop.tenant.id, locationId: shop.location.id, programId: shop.program.id });
  expect(await db.select().from(plateLinkEvents)).toMatchObject([{ action: "link", actorUserId: shop.userId, plateLabel: "P-001", newProgramId: shop.program.id, oldProgramId: null }]);
  // Used: the same code never works again, not even after an unlink.
  await setPlateLink({ actorUserId: operator.userId, env: env(), plateLabel: "P-001", programId: null, execute: true });
  expect(await code(() => activatePlate({ userId: shop.userId, programId: shop.program.id, plateLabel: "P-001", code: plain }))).toBe("INVALID_ACTIVATION");
  // A plate the operator linked by hand: its box code is spent too.
  await setPlateLink({ actorUserId: operator.userId, env: env(), plateLabel: "P-002", programId: shop.program.id, execute: true });
  await setPlateLink({ actorUserId: operator.userId, env: env(), plateLabel: "P-002", programId: null, execute: true });
  expect(await code(() => activatePlate({ userId: shop.userId, programId: shop.program.id, plateLabel: "P-002", code: second }))).toBe("INVALID_ACTIVATION");
  expect((await operatorOverview(operator.userId)).plates).toMatchObject([{ plateLabel: "P-001", code: "used" }, { plateLabel: "P-002", code: "used" }]);
});

it("gives one generic error for unknown, used, wrong and locked codes, and locks after 5 wrong tries until the operator unlocks", async () => {
  const shop = await nfcFixture();
  await plate("P-001"); await plate("P-002"); await plate("P-003");
  const [{ code: plain }, { code: other }] = await issue("P-001", "P-002");
  const attempt = (plateLabel: string, value: string) => activatePlate({ userId: shop.userId, programId: shop.program.id, plateLabel, code: value });
  const messages = new Set<string>();
  for (const [label, value] of [["P-404", plain], ["not a plate", plain], ["P-003", plain], ["P-001", other]]) {
    await attempt(label, value).catch((error: Error & { code?: string }) => { expect(error.code).toBe("INVALID_ACTIVATION"); messages.add(error.message); });
  }
  expect([...messages]).toEqual([ACTIVATION_FAILED]);
  for (let i = 0; i < 3; i++) expect(await code(() => attempt("P-001", "AAAA-AAAA-AAAA"))).toBe("INVALID_ACTIVATION");
  expect((await db.select().from(plateActivationCodes).where(eq(plateActivationCodes.tagId, (await tag("P-001")).id)))[0]).toMatchObject({ failedAttempts: 4, lockedAt: null });
  expect(await code(() => attempt("P-001", "AAAA-AAAA-AAAA"))).toBe("INVALID_ACTIVATION"); // the fifth
  // Locked: even the right code fails, with the same error, and nothing more is counted.
  expect(await code(() => attempt("P-001", plain))).toBe("INVALID_ACTIVATION");
  expect((await tag("P-001")).status).toBe("unlinked");
  expect((await operatorOverview(operator.userId)).plates.find(p => p.plateLabel === "P-001")?.code).toBe("locked");
  expect(await code(() => unlockPlateCode({ actorUserId: shop.userId, env: env(), plateLabel: "P-001" }))).toBe("FORBIDDEN");
  expect(await unlockPlateCode({ actorUserId: operator.userId, env: env(), plateLabel: "P-001" })).toEqual({ plateLabel: "P-001", result: "unlocked" });
  expect(await attempt("P-001", plain)).toMatchObject({ result: "link" });
  // A reissued code replaces the old one at once.
  const [{ code: fresh }] = await issue("P-002");
  expect(await code(() => attempt("P-002", other))).toBe("INVALID_ACTIVATION");
  expect(await attempt("P-002", fresh)).toMatchObject({ result: "link" });
});

it("rate-limits the owner route per user and per plate, before any code is checked", async () => {
  const shop = await nfcFixture();
  const signedIn = await identity();
  await db.insert(staffRoles).values({ tenantId: shop.tenant.id, userId: signedIn.userId, role: "owner" });
  const owner = signedIn.cookie;
  await plate("P-001");
  const send = (plateLabel: string) => post(activateRoute, "/api/merchant/plate/activate", { programId: shop.program.id, plateLabel, code: "AAAA-AAAA-AAAA" }, owner);
  expect((await send("P-001")).status).toBe(400);
  expect(await (await send("P-404")).json()).toMatchObject({ code: "INVALID_ACTIVATION", error: ACTIVATION_FAILED });
  for (let i = 0; i < 8; i++) await send(`P-${100 + i}`);
  expect((await send("P-001")).status).toBe(429); // 10 per user in 15 minutes
  await pool.query("DELETE FROM rate_limits");
  for (let i = 0; i < 10; i++) await post(activateRoute, "/api/merchant/plate/activate", { programId: shop.program.id, plateLabel: "P-777", code: "AAAA-AAAA-AAAA" }, i < 5 ? owner : (await identity()).cookie);
  expect((await send("P-777")).status).toBe(429); // 10 per plate name in an hour, whoever asks
});
