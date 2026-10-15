import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "./auth";
import { createMerchant, enroll } from "./product";
import { acceptStaffInvite, createStaffInvite, revokeStaff } from "./staff";
import { POST as awardRoute } from "@/app/api/cashier/award/route";
import { POST as reverseRoute } from "@/app/api/transactions/reverse/route";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/looplocal_test") throw new Error("Dedicated synthetic local PostgreSQL required");
const origin = "http://localhost:3000";
const registration = process.env.PUBLIC_REGISTRATION_ENABLED;
beforeEach(async () => { await pool.query('TRUNCATE tenants,"user" CASCADE'); process.env.PUBLIC_REGISTRATION_ENABLED = "true"; });
afterAll(async () => { if (registration === undefined) delete process.env.PUBLIC_REGISTRATION_ENABLED; else process.env.PUBLIC_REGISTRATION_ENABLED = registration; await pool.end(); });
function request(path: string, body: unknown, cookie: string, requestOrigin = origin) {
  return new Request(origin + path, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json", cookie }, body: JSON.stringify(body) });
}
async function identity() {
  const email = `${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const user = await auth.api.signUpEmail({ body: { name: "Synthetic financial identity", email, password } });
  const signIn = await auth.handler(request("/api/auth/sign-in/email", { email, password }, ""));
  expect(signIn.status).toBe(200);
  const cookie = signIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return { userId: user.user.id, email, cookie };
}
async function fixture() {
  const owner = await identity();
  const merchant = await createMerchant({ userId: owner.userId, businessName: "Synthetic transaction Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic purchase points", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3, rulesText: "Three points per euro, floored", rewardTitle: "Reward", rewardCost: 5 });
  const rule = (await pool.query("SELECT id FROM program_rule_versions WHERE program_id=$1 ORDER BY version DESC LIMIT 1", [merchant.programId])).rows[0].id as string;
  const members = [await enroll({ slug: merchant.programSlug, acceptedTerms: true }), await enroll({ slug: merchant.programSlug, acceptedTerms: true })];
  return { owner, merchant, rule, members };
}
async function operation(kind: "award" | "reversal", f: Awaited<ReturnType<typeof fixture>>, index: number, key: string) {
  const award = { membershipId: f.members[index].id, purchaseAmountMinor: 499, ruleVersionId: f.rule, idempotencyKey: key, requestId: randomUUID() };
  if (kind === "award") return { route: awardRoute, path: "/api/cashier/award", input: award };
  const credited = await awardRoute(request("/api/cashier/award", { ...award, idempotencyKey: randomUUID() }, f.owner.cookie));
  expect(credited.status).toBe(200);
  const result = await credited.json(); expect(result).toMatchObject({ balance: 14, creditedQuantity: 14 });
  return { route: reverseRoute, path: "/api/transactions/reverse", input: { locationId: f.merchant.locationId, entryId: result.entryId, reason: "Synthetic original purchase correction", idempotencyKey: key } };
}

it.each(["award", "reversal"] as const)("concurrent %s requests reusing a tenant key across cards return a definitive conflict with one atomic booking", async kind => {
  const f = await fixture(), key = randomUUID();
  const ops = [await operation(kind, f, 0, key), await operation(kind, f, 1, key)];
  const barrier = await pool.connect(); let calls: Promise<Response>[] = [];
  try {
    await barrier.query("BEGIN"); await barrier.query("LOCK TABLE ledger_entries IN SHARE MODE");
    calls = ops.map(op => op.route(request(op.path, op.input, f.owner.cookie)));
    // Both real transactions pass validation before either ledger insertion can proceed.
    await expect.poll(async () => Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%insert into \"ledger_entries\"%' AND pid<>pg_backend_pid()")).rows[0].count)).toBe(2);
    await barrier.query("COMMIT");
    const responses = await Promise.all(calls);
    console.log("synthetic financial race", kind, responses.map(r => r.status));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = responses.findIndex(r => r.status === 200), loser = 1 - winner;
    expect(await responses[loser].json()).toMatchObject({ code: "KEY_REUSED" });
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.members[winner].id])).rows[0].balance).toBe(kind === "award" ? 14 : 0);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.members[loser].id])).rows[0].balance).toBe(kind === "award" ? 0 : 14);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1 AND idempotency_key=$2", [f.merchant.tenantId, key])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1 AND kind=$2", [f.merchant.tenantId, kind])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM purchase_awards WHERE tenant_id=$1", [f.merchant.tenantId])).rows[0].n).toBe(kind === "award" ? 1 : 2);
    const conflict = await ops[loser].route(request(ops[loser].path, ops[loser].input, f.owner.cookie));
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: "KEY_REUSED" });
    const retry = await ops[loser].route(request(ops[loser].path, { ...ops[loser].input, idempotencyKey: randomUUID() }, f.owner.cookie));
    expect(retry.status).toBe(200); expect(await retry.json()).toMatchObject({ balance: kind === "award" ? 14 : 0, duplicate: false });
    const replay = await ops[winner].route(request(ops[winner].path, ops[winner].input, f.owner.cookie));
    expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ balance: kind === "award" ? 14 : 0, duplicate: true });
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1 AND kind=$2", [f.merchant.tenantId, kind])).rows[0].n).toBe(2);
  } finally { await barrier.query("ROLLBACK"); barrier.release(); await Promise.allSettled(calls); }
});

async function financialState() {
  return Promise.all([
    pool.query("SELECT id,balance FROM memberships ORDER BY id").then(r => r.rows),
    pool.query("SELECT * FROM ledger_entries ORDER BY id").then(r => r.rows),
    pool.query("SELECT * FROM purchase_awards ORDER BY ledger_entry_id").then(r => r.rows),
    pool.query("SELECT * FROM redemptions ORDER BY id").then(r => r.rows),
    pool.query("SELECT * FROM outbox_jobs ORDER BY id").then(r => r.rows),
  ]);
}

it.each([
  ["award", "P0001"], ["award", "23505"], ["reversal", "P0001"], ["reversal", "23505"],
] as const)("%s preserves unrelated late SQL failure %s and atomic rollback before a legitimate same-key retry", async (kind, code) => {
  const f = await fixture(), op = await operation(kind, f, 0, randomUUID());
  const before = await financialState(), name = `test_financial_${randomUUID().replaceAll("-", "")}`;
  // Fault this owned membership only, after its ledger/purchase/balance writes.
  await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.id='${f.members[0].id}'::uuid THEN
      RAISE EXCEPTION USING ERRCODE='${code}', CONSTRAINT='synthetic_balance_failure_uq', MESSAGE='synthetic post-validation failure';
    END IF; RETURN NEW; END $$`);
  try {
    await pool.query(`CREATE TRIGGER ${name} AFTER UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try {
      const failed = await op.route(request(op.path, op.input, f.owner.cookie));
      expect(failed.status).toBe(500); expect(await failed.json()).toEqual({ error: "Internal error" });
      expect(await financialState()).toEqual(before);
    } finally { await pool.query(`DROP TRIGGER ${name} ON memberships`); }
    const retry = await op.route(request(op.path, op.input, f.owner.cookie));
    expect(retry.status).toBe(200); expect(await retry.json()).toMatchObject({ balance: kind === "award" ? 14 : 0, duplicate: false });
    const after = await financialState();
    const replay = await op.route(request(op.path, op.input, f.owner.cookie));
    expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ balance: kind === "award" ? 14 : 0, duplicate: true });
    expect(await financialState()).toEqual(after);
  } finally { await pool.query(`DROP FUNCTION ${name}()`); }
});

it.each(["award", "reversal"] as const)("%s denies anonymous, foreign-origin, unauthorized, foreign-tenant and revoked-staff requests without financial mutations", async kind => {
  const f = await fixture(), foreign = await fixture(), outsider = await identity(), cashier = await identity();
  const invite = await createStaffInvite({ actorUserId: f.owner.userId, locationId: f.merchant.locationId, email: cashier.email, role: "cashier" });
  await acceptStaffInvite({ userId: cashier.userId, token: invite.token });
  const op = await operation(kind, f, 0, randomUUID());
  if (kind === "reversal") expect((await op.route(request(op.path, op.input, cashier.cookie))).status).toBe(403);
  await revokeStaff({ actorUserId: f.owner.userId, userId: cashier.userId });
  expect((await auth.api.getSession({ headers: new Headers({ cookie: cashier.cookie }) }))?.user.id).toBe(cashier.userId);
  const before = await financialState();
  expect((await op.route(request(op.path, op.input, ""))).status).toBe(401);
  expect((await op.route(request(op.path, op.input, f.owner.cookie, "https://foreign.example.test"))).status).toBe(403);
  expect((await op.route(request(op.path, op.input, outsider.cookie))).status).toBe(403);
  expect((await op.route(request(op.path, op.input, foreign.owner.cookie))).status).toBe(404);
  expect((await op.route(request(op.path, op.input, cashier.cookie))).status).toBe(403);
  expect(await financialState()).toEqual(before);
});

it.each(["award", "reversal"] as const)("%s keeps the key namespace isolated between authorized tenants", async kind => {
  const own = await fixture(), foreign = await fixture(), key = randomUUID();
  const ops = [await operation(kind, own, 0, key), await operation(kind, foreign, 0, key)];
  const responses = await Promise.all(ops.map((op, i) => op.route(request(op.path, op.input, [own, foreign][i].owner.cookie))));
  for (const response of responses) {
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ balance: kind === "award" ? 14 : 0, duplicate: false });
  }
  expect((await pool.query("SELECT tenant_id FROM ledger_entries WHERE idempotency_key=$1 ORDER BY tenant_id", [key])).rows.map(r => r.tenant_id)).toEqual([own.merchant.tenantId, foreign.merchant.tenantId].sort());
});

it("invalid reversal reason and absent original remain rejected without changing financial history", async () => {
  const f = await fixture(), op = await operation("reversal", f, 0, randomUUID());
  const before = await financialState();
  expect((await reverseRoute(request(op.path, { ...op.input, reason: "short" }, f.owner.cookie))).status).toBe(400);
  expect((await reverseRoute(request(op.path, { ...op.input, entryId: randomUUID() }, f.owner.cookie))).status).toBe(404);
  expect(await financialState()).toEqual(before);
});
