import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { db, pool } from "@/db";
import { ledgerEntries, membershipContacts, plateLinkEvents, secureTags } from "@/db/schema";
import { auth } from "./auth";
import { nfcFixture } from "./nfc-test-db";
import { operatorOverview } from "./operator";
import { POST as plateRoute } from "@/app/api/operator/plate/route";
import { POST as programmeRoute } from "@/app/api/operator/programme/route";
import { earliestEndDate } from "./operator-date";
import { getCard } from "./product";
import { requestCancellation } from "./programme-end";
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

const postProgramme = (body: unknown, cookie = "", headers: Record<string, string> = { Origin: origin }) =>
  programmeRoute(new Request(origin + "/api/operator/programme", { method: "POST", headers: { "Content-Type": "application/json", ...headers, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));

it("keeps the end-date route operator-only: an empty 404 for anonymous, shop owners and junk, before anything is read", async () => {
  const operator = await identity(), owner = await identity(), f = await nfcFixture();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  const body = { programId: f.program.id, endDate: "2026-12-31", execute: true };
  for (const cookie of ["", owner.cookie]) { const res = await postProgramme(body, cookie); expect(res.status).toBe(404); expect(await res.text()).toBe(""); }
  expect((await postProgramme({ nonsense: 1 }, owner.cookie)).status).toBe(404);
  expect((await postProgramme(body, operator.cookie, {})).status).toBe(404); // no same-origin header
  expect((await postProgramme({ nonsense: 1 }, operator.cookie)).status).toBe(400);
  expect((await pool.query("SELECT cancellation_end_date FROM programs WHERE id = $1", [f.program.id])).rows[0].cancellation_end_date).toBeNull();
});

it("lists owner-requested and operator-scheduled cancellations, dry run changes nothing, execute confirms and moves the card's date", async () => {
  const later = (days: number) => new Date(Date.parse(earliestEndDate(new Date()) + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
  const d1 = later(10), d2 = later(20), d3 = later(30);
  const operator = await identity(), asked = await nfcFixture(), planned = await nfcFixture();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  await requestCancellation({ actorUserId: asked.userId, programSlug: asked.program.slug, now: new Date("2026-10-10T10:00:00Z") });
  const view = () => operatorOverview(operator.userId, { PLATE_OPERATOR_USER_IDS: operator.userId });
  const row = async (id: string) => (await view()).rows.find(r => r.programId === id)!;
  expect(await row(asked.program.id)).toMatchObject({ endDate: "2026-10-31", confirmed: false });
  expect((await row(asked.program.id)).requestedDays).toBeGreaterThanOrEqual(0);
  expect(await row(planned.program.id)).toMatchObject({ endDate: null, confirmed: false, requestedDays: null });

  // Owner-requested: the dry run shows from → to and writes nothing; execute confirms.
  const dry = await postProgramme({ programId: asked.program.id, endDate: d1, execute: false }, operator.cookie);
  expect(await dry.json()).toMatchObject({ result: "would_schedule", end: "2026-10-31", endDate: d1 });
  expect(await row(asked.program.id)).toMatchObject({ endDate: "2026-10-31", confirmed: false });
  expect((await getCard(asked.member.cardToken)).endsOn).toBeUndefined();
  expect((await postProgramme({ programId: asked.program.id, endDate: d1, execute: true }, operator.cookie)).status).toBe(200);
  expect(await row(asked.program.id)).toMatchObject({ endDate: d1, confirmed: true });
  expect((await getCard(asked.member.cardToken)).endsOn).toBe(d1);
  await postProgramme({ programId: asked.program.id, endDate: d2, execute: true }, operator.cookie);
  expect((await getCard(asked.member.cardToken)).endsOn).toBe(d2); // moving the date moves the card

  // Operator-scheduled, with no owner request: confirmed, and requested_at stays null.
  expect((await postProgramme({ programId: planned.program.id, endDate: d3, execute: true }, operator.cookie)).status).toBe(200);
  expect(await row(planned.program.id)).toMatchObject({ endDate: d3, confirmed: true, requestedDays: null });
  expect((await pool.query("SELECT cancellation_requested_at FROM programs WHERE id = $1", [planned.program.id])).rows[0].cancellation_requested_at).toBeNull();
  expect((await getCard(planned.member.cardToken)).endsOn).toBe(d3);
  expect((await postProgramme({ programId: planned.program.id, endDate: "15.12.2026", execute: true }, operator.cookie)).status).toBe(400);
  expect(JSON.stringify(await view())).not.toContain(asked.member.cardToken);
});

it("refuses an end date before tomorrow (Berlin) with a pointer to the console and an impossible day with a message; tomorrow is accepted", async () => {
  const operator = await identity(), f = await nfcFixture();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  const tomorrow = earliestEndDate(new Date());
  const shift = (days: number) => new Date(Date.parse(tomorrow + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
  for (const endDate of [shift(-2), shift(-1)]) for (const execute of [false, true]) {
    const res = await postProgramme({ programId: f.program.id, endDate, execute }, operator.cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "END_DATE_TOO_EARLY", error: expect.stringContaining("Konsole") });
  }
  for (const execute of [false, true]) { // an impossible day is refused with a message, not a 500 from the date cast
    const res = await postProgramme({ programId: f.program.id, endDate: "2027-02-30", execute }, operator.cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_END_DATE", error: expect.stringContaining("gibt es nicht") });
  }
  expect((await pool.query("SELECT cancellation_end_date FROM programs WHERE id = $1", [f.program.id])).rows[0].cancellation_end_date).toBeNull();
  expect((await postProgramme({ programId: f.program.id, endDate: tomorrow, execute: true }, operator.cookie)).status).toBe(200);
  expect((await getCard(f.member.cardToken)).endsOn).toBe(tomorrow);
});
