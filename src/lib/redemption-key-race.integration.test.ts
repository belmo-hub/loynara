import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "./auth";
import { createMerchant, createReward, currentRewards, enroll } from "./product";
import { POST as awardRoute } from "@/app/api/cashier/award/route";
import { POST as redeemRoute } from "@/app/api/cashier/redeem/route";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./disposable-test-database";

assertLocalTestDatabaseUrl();
const origin = "http://localhost:3000";
const registration = process.env.PUBLIC_REGISTRATION_ENABLED;
beforeEach(async () => { await assertDisposableDatabase(pool); await pool.query('TRUNCATE tenants,"user" CASCADE'); process.env.PUBLIC_REGISTRATION_ENABLED = "true"; });
afterAll(async () => { if (registration === undefined) delete process.env.PUBLIC_REGISTRATION_ENABLED; else process.env.PUBLIC_REGISTRATION_ENABLED = registration; await pool.end(); });
function request(path: string, body: unknown, cookie: string) {
  return new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json", cookie }, body: JSON.stringify(body) });
}
async function fixture() {
  const email = `${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const user = await auth.api.signUpEmail({ body: { name: "Synthetic purchase owner", email, password } });
  const signIn = await auth.handler(request("/api/auth/sign-in/email", { email, password }, ""));
  expect(signIn.status).toBe(200);
  const cookie = signIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const merchant = await createMerchant({ userId: user.user.id, businessName: "Synthetic purchase Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic points card", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3, rulesText: "Three points per euro, floored", rewardTitle: "First reward", rewardCost: 5 });
  await createReward({ actorUserId: user.user.id, programSlug: merchant.programSlug, title: "Second reward", cost: 7 });
  const rewards = await currentRewards(merchant.tenantId, merchant.programId);
  expect(rewards.map(r => r.cost)).toEqual([5, 7]);
  const rule = (await pool.query("SELECT id FROM program_rule_versions WHERE program_id=$1 ORDER BY version DESC LIMIT 1", [merchant.programId])).rows[0].id;
  const members = [];
  for (let i = 0; i < 2; i++) {
    const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const credited = await awardRoute(request("/api/cashier/award", { membershipId: member.id, purchaseAmountMinor: 499, ruleVersionId: rule, idempotencyKey: randomUUID(), requestId: randomUUID() }, cookie));
    expect(credited.status).toBe(200); expect(await credited.json()).toMatchObject({ balance: 14, creditedQuantity: 14 });
    members.push(member);
  }
  return { merchant, cookie, members, rewards };
}

it("concurrent selected-reward requests reusing a key across cards return a definitive conflict with one atomic booking", async () => {
  const f = await fixture();
  const key = randomUUID();
  const inputs = f.members.map((member, i) => ({ membershipId: member.id, rewardVersionId: f.rewards[i].id, idempotencyKey: key, requestId: randomUUID() }));
  const barrier = await pool.connect();
  let calls: Promise<Response>[] = [];
  try {
    await barrier.query("BEGIN");
    await barrier.query("LOCK TABLE ledger_entries IN SHARE MODE");
    calls = inputs.map(input => redeemRoute(request("/api/cashier/redeem", input, f.cookie)));
    // Both actual route transactions pass validation before either can insert.
    await expect.poll(async () => Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%insert into \"ledger_entries\"%' AND pid<>pg_backend_pid()")).rows[0].count)).toBe(2);
    await barrier.query("COMMIT");
    const responses = await Promise.all(calls);
    console.log("synthetic redemption race statuses", responses.map(r => r.status));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = responses.findIndex(r => r.status === 200), loser = 1 - winner;
    expect(await responses[loser].json()).toMatchObject({ code: "KEY_REUSED" });
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.members[winner].id])).rows[0].balance).toBe(14 - [5, 7][winner]);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.members[loser].id])).rows[0].balance).toBe(14);
    expect((await pool.query("SELECT count(*)::int AS n FROM redemptions WHERE tenant_id=$1", [f.merchant.tenantId])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1 AND kind='redeem'", [f.merchant.tenantId])).rows[0].n).toBe(1);
    // A rejected key is definitive: a new key can book this independently approved operation.
    const retry = await redeemRoute(request("/api/cashier/redeem", { ...inputs[loser], idempotencyKey: randomUUID(), requestId: randomUUID() }, f.cookie));
    expect(retry.status).toBe(200); expect(await retry.json()).toMatchObject({ balance: 14 - [5, 7][loser], duplicate: false });
  } finally {
    await barrier.query("ROLLBACK"); barrier.release();
    await Promise.allSettled(calls);
  }
});

it.each(["P0001", "23505"])("post-validation database failure %s rolls back all booking effects and stays a genuine server error", async code => {
  const f = await fixture();
  const name = `test_redemption_${randomUUID().replaceAll("-", "")}`;
  const input = { membershipId: f.members[0].id, rewardVersionId: f.rewards[1].id, idempotencyKey: randomUUID(), requestId: randomUUID() };
  // Fault only this owned synthetic membership after the ledger/balance/redemption writes.
  // An unrelated unique violation must not be mislabeled KEY_REUSED.
  await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.membership_id='${input.membershipId}'::uuid THEN
      RAISE EXCEPTION USING ERRCODE='${code}', CONSTRAINT='synthetic_redemption_failure_uq', MESSAGE='synthetic post-validation failure';
    END IF; RETURN NEW; END $$`);
  try {
    await pool.query(`CREATE TRIGGER ${name} AFTER INSERT ON redemptions FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try {
      const failed = await redeemRoute(request("/api/cashier/redeem", input, f.cookie));
      expect(failed.status).toBe(500); expect(await failed.json()).toEqual({ error: "Internal error" });
      expect((await pool.query("SELECT balance FROM memberships WHERE id=ANY($1::uuid[]) ORDER BY id", [f.members.map(m => m.id)])).rows.map(r => r.balance)).toEqual([14, 14]);
      expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1 AND kind='redeem'", [f.merchant.tenantId])).rows[0].n).toBe(0);
      expect((await pool.query("SELECT count(*)::int AS n FROM redemptions WHERE tenant_id=$1", [f.merchant.tenantId])).rows[0].n).toBe(0);
      expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE tenant_id=$1", [f.merchant.tenantId])).rows[0].n).toBe(0);
    } finally { await pool.query(`DROP TRIGGER ${name} ON redemptions`); }
    const retry = await redeemRoute(request("/api/cashier/redeem", input, f.cookie));
    expect(retry.status).toBe(200); expect(await retry.json()).toMatchObject({ balance: 7, duplicate: false });
    const replay = await redeemRoute(request("/api/cashier/redeem", input, f.cookie));
    expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ balance: 7, duplicate: true });
    expect((await pool.query("SELECT count(*)::int AS n FROM redemptions WHERE tenant_id=$1", [f.merchant.tenantId])).rows[0].n).toBe(1);
  } finally { await pool.query(`DROP FUNCTION ${name}()`); }
});

it("real redemption routes reject anonymous, foreign-origin and foreign-merchant operations without mutations", async () => {
  const f = await fixture(), foreign = await fixture();
  const input = { membershipId: f.members[0].id, rewardVersionId: f.rewards[0].id, idempotencyKey: randomUUID(), requestId: randomUUID() };
  const before = (await pool.query("SELECT id,balance FROM memberships ORDER BY id")).rows;
  const anonymous = await redeemRoute(request("/api/cashier/redeem", input, ""));
  expect(anonymous.status).toBe(401);
  const wrongOrigin = request("/api/cashier/redeem", input, f.cookie);
  wrongOrigin.headers.set("origin", "https://foreign.example.test");
  expect((await redeemRoute(wrongOrigin)).status).toBe(403);
  expect((await redeemRoute(request("/api/cashier/redeem", input, foreign.cookie))).status).toBe(404);
  expect((await redeemRoute(request("/api/cashier/redeem", { ...input, rewardVersionId: foreign.rewards[0].id }, f.cookie))).status).toBe(400);
  expect((await pool.query("SELECT id,balance FROM memberships ORDER BY id")).rows).toEqual(before);
  expect((await pool.query("SELECT count(*)::int AS n FROM redemptions")).rows[0].n).toBe(0);
  expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE kind='redeem'")).rows[0].n).toBe(0);
});
