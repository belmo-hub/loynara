import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { db, pool } from "@/db";
import { ledgerEntries, membershipContacts, plateLinkEvents, secureTags } from "@/db/schema";
import { auth } from "./auth";
import { nfcFixture } from "./nfc-test-db";
import { operatorOverview } from "./operator";
import { POST as plateRoute } from "@/app/api/operator/plate/route";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./disposable-test-database";

assertLocalTestDatabaseUrl();
const origin = "http://localhost:3000";
const saved = { ids: process.env.PLATE_OPERATOR_USER_IDS, base: process.env.PUBLIC_BASE_URL, registration: process.env.PUBLIC_REGISTRATION_ENABLED };
beforeEach(async () => { await assertDisposableDatabase(pool); await pool.query('TRUNCATE tenants, "user", secure_tags, plate_link_events CASCADE'); process.env.PUBLIC_BASE_URL = origin; process.env.PUBLIC_REGISTRATION_ENABLED = "true"; });
afterAll(async () => {
  if (saved.ids === undefined) delete process.env.PLATE_OPERATOR_USER_IDS; else process.env.PLATE_OPERATOR_USER_IDS = saved.ids;
  if (saved.base === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = saved.base;
  if (saved.registration === undefined) delete process.env.PUBLIC_REGISTRATION_ENABLED; else process.env.PUBLIC_REGISTRATION_ENABLED = saved.registration;
  await pool.end();
});

async function identity() {
  const email = randomUUID() + "@example.test", password = "Synthetic-Operator-093-Only!";
  const signed = await auth.api.signUpEmail({ body: { name: "Synthetic person", email, password } });
  const response = await auth.handler(new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }));
  return { userId: signed.user.id, cookie: response.headers.getSetCookie().map(x => x.split(";")[0]).join("; ") };
}
async function plate(label: string) {
  await db.insert(secureTags).values({ publicRef: randomUUID().replaceAll("-", "").slice(0, 24), plateLabel: label, uid: "04de5f1eacc041", keyRef: "dv1_synthetic", configVersion: 1, status: "unlinked", lastCounter: 3 });
}
const post = (body: unknown, cookie = "", headers: Record<string, string> = { Origin: origin }) =>
  plateRoute(new Request(origin + "/api/operator/plate", { method: "POST", headers: { "Content-Type": "application/json", ...headers, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const events = async () => (await db.select().from(plateLinkEvents)).map(e => e.action);

it("answers a plain 404 to anonymous visitors and shop owners, and serves only the operator", async () => {
  const operator = await identity(), f = await nfcFixture(), owner = await identity();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  await plate("P-001");
  const body = { plateLabel: "P-001", programId: f.program.id, execute: true };
  for (const cookie of ["", owner.cookie]) { const res = await post(body, cookie); expect(res.status).toBe(404); expect(await res.text()).toBe(""); }
  expect((await post(body, operator.cookie, {})).status).toBe(404); // no same-origin header
  // Garbage from a non-operator is the same empty 404, never a 400.
  const junk = await plateRoute(new Request(origin + "/api/operator/plate", { method: "POST", headers: { "Content-Type": "text/plain", Origin: origin, cookie: owner.cookie }, body: "garbage" }));
  expect(junk.status).toBe(404); expect(await junk.text()).toBe("");
  expect((await post({ nonsense: 1 }, owner.cookie)).status).toBe(404);
  expect((await post({ nonsense: 1 }, operator.cookie)).status).toBe(400);
  await expect(operatorOverview(owner.userId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await events()).toEqual([]);
  delete process.env.PLATE_OPERATOR_USER_IDS; // absent list: nobody, not even the former operator
  expect((await post(body, operator.cookie)).status).toBe(404);
  expect(await operatorOverview(operator.userId, { PLATE_OPERATOR_USER_IDS: operator.userId })).toMatchObject({ plates: [{ plateLabel: "P-001", status: "unlinked" }] });
});

it("links, relinks and unlinks through the API, each with a dry run first and an audit row", async () => {
  const operator = await identity(), a = await nfcFixture(), b = await nfcFixture();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  await plate("P-002");
  const step = async (programId: string | null) => {
    const dry = await post({ plateLabel: "p-002", programId, execute: false }, operator.cookie);
    expect(dry.status).toBe(200);
    const before = (await events()).length;
    const done = await post({ plateLabel: "P-002", programId, execute: true }, operator.cookie);
    expect(done.status).toBe(200);
    expect((await events()).length).toBe(before + 1);
    return { dry: await dry.json(), done: await done.json() };
  };
  expect((await step(a.program.id)).done).toMatchObject({ result: "link", from: null, to: { programId: a.program.id } });
  expect((await step(b.program.id)).dry).toMatchObject({ result: "would_relink", from: { programId: a.program.id }, to: { programId: b.program.id } });
  expect((await step(null)).done).toMatchObject({ result: "unlink", to: null });
  expect(await events()).toEqual(["link", "relink", "unlink"]);
  expect((await post({ plateLabel: "P-002", programId: "x" }, operator.cookie)).status).toBe(400);
});

it("shows counts and dates, never customer data", async () => {
  const operator = await identity(), f = await nfcFixture();
  const email = "private.customer@example.test";
  await db.insert(membershipContacts).values({ tenantId: f.tenant.id, membershipId: f.member.id, email });
  await db.insert(ledgerEntries).values({ tenantId: f.tenant.id, locationId: f.location.id, membershipId: f.member.id, delta: 1, kind: "award", source: "staff_online", actorUserId: f.userId, requestId: randomUUID(), idempotencyKey: randomUUID() });
  const view = await operatorOverview(operator.userId, { PLATE_OPERATOR_USER_IDS: operator.userId });
  expect(view.rows).toHaveLength(1);
  expect(view.rows[0]).toMatchObject({ tenant: "Tap Test Café", cards: 1, weeklyReport: true });
  expect(view.rows[0].lastAward).toBeTruthy();
  const text = JSON.stringify(view);
  for (const secret of [email, f.member.scanCode, f.member.cardToken, f.member.cardLocator, f.userId]) expect(text).not.toContain(secret);
});
