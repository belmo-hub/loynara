import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "./auth";
import { POST as onboardRoute } from "@/app/api/merchant/onboard/route";
import { POST as enrollRoute } from "@/app/api/enroll/route";
import { POST as awardRoute } from "@/app/api/cashier/award/route";
import { POST as redeemRoute } from "@/app/api/cashier/redeem/route";
import { createMerchant, getCard, getMerchantRewards, lookupCard } from "./product";
import { acceptStaffInvite, createStaffInvite, revokeStaff } from "./staff";
import { getMerchantAnalytics } from "./merchant-analytics";

const url = process.env.DATABASE_URL;
if (!url || !url.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Owned local synthetic database required");
const origin = "http://localhost:3000";
const envKeys = ["PUBLIC_REGISTRATION_ENABLED", "STAFF_INVITE_SIGNUP_ENABLED"];
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
beforeAll(async () => {
  expect((await pool.query("SHOW data_directory")).rows[0].data_directory).toBe("/private/tmp/loynara-goal-133-pg");
  Object.assign(process.env, { PUBLIC_REGISTRATION_ENABLED: "true", STAFF_INVITE_SIGNUP_ENABLED: "true" });
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
});
afterAll(async () => { for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } await pool.end(); });
function request(path: string, body: unknown, cookie = "") {
  return new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}
async function identity(label: string) {
  const email = `${randomUUID()}@example.test`, password = "synthetic-cohort-local-password-only";
  const result = await auth.api.signUpEmail({ body: { name: label, email, password } });
  const response = await auth.handler(request("/api/auth/sign-in/email", { email, password }));
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  expect(cookie).not.toBe("");
  return { userId: result.user.id, email, cookie };
}
async function fixture(index: number) {
  const owner = await identity(`Cohort owner ${index}`);
  const body = { businessName: `Concurrent purchase merchant ${index}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `Concurrent purchase programme ${index}`, programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: index + 1, rulesText: "Synthetic approved purchase calculation", rewardTitle: "Concurrent selected reward", rewardCost: 3 };
  const response = await onboardRoute(request("/api/merchant/onboard", body, owner.cookie));
  expect(response.status).toBe(201);
  const merchant = await response.json() as Awaited<ReturnType<typeof createMerchant>>;
  const cashier = await identity(`Cohort cashier ${index}`);
  const invitation = await createStaffInvite({ actorUserId: owner.userId, locationId: merchant.locationId, email: cashier.email, role: "cashier" });
  await acceptStaffInvite({ userId: cashier.userId, token: invitation.token });
  const joined = await enrollRoute(request("/api/enroll", { slug: merchant.programSlug, acceptedTerms: true }));
  expect(joined.status).toBe(201);
  const { cardToken } = await joined.json() as { cardToken: string };
  const cookie = joined.headers.getSetCookie().filter(value => !/Max-Age=0/i.test(value)).map(value => value.split(";")[0]).join("; ");
  const member = (await pool.query("SELECT id,scan_code FROM memberships WHERE card_token=$1", [cardToken])).rows[0] as { id: string; scan_code: string };
  return { owner, cashier, merchant, cardToken, cookie, member };
}

it("commits ten overlapping purchase awards without cross-tenant credit and preserves replay, redemption and reporting", async () => {
  const cohort: Awaited<ReturnType<typeof fixture>>[] = [];
  for (let index = 0; index < 10; index++) cohort.push(await fixture(index));
  expect(new Set(cohort.map(f => f.merchant.tenantId)).size).toBe(10);
  const expectedPoints = [4, 9, 14, 19, 24, 29, 34, 39, 44, 49]; // EUR4.99 × approved integer rates1..10, floor.
  const purchases = await Promise.all(cohort.map(async f => {
    const card = await lookupCard({ userId: f.cashier.userId, locationId: f.merchant.locationId, scanCode: f.member.scan_code });
    expect(card).toMatchObject({ earningMode: "purchase", programType: "points", balance: 0 });
    return { membershipId: f.member.id, purchaseAmountMinor: 499, ruleVersionId: card.ruleVersionId, idempotencyKey: "shared-cohort-purchase-key", requestId: randomUUID() };
  }));
  // The same client key is deliberately reused in all ten tenants; each must get its own entry.
  for (const [index, f] of cohort.entries()) {
    const foreign = cohort[(index + 1) % 10];
    expect((await awardRoute(request("/api/cashier/award", purchases[index], foreign.owner.cookie))).status).toBe(404);
    expect((await awardRoute(request("/api/cashier/award", purchases[index]))).status).toBe(401);
    const wrongRule = await awardRoute(request("/api/cashier/award", { ...purchases[index], ruleVersionId: purchases[(index + 1) % 10].ruleVersionId }, f.cashier.cookie));
    expect(wrongRule.status).toBe(400);
    expect(await wrongRule.json()).toMatchObject({ code: "STALE_RULE" });
  }
  const control = new Pool({ connectionString: url, max: 1 });
  const gate = await control.connect();
  let pending: Promise<Response>[] = [];
  let responses: Response[] = [];
  try {
    await gate.query("BEGIN");
    await gate.query("LOCK TABLE ledger_entries IN SHARE MODE");
    pending = cohort.map((f, index) => awardRoute(request("/api/cashier/award", purchases[index], f.cashier.cookie)));
    let waiting = 0;
    for (let attempt = 0; attempt < 500; attempt++) {
      await gate.query("SELECT pg_stat_clear_snapshot()"); // Observer transaction must refresh PostgreSQL activity statistics.
      waiting = (await gate.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE $1", ['%insert into "ledger_entries"%'])).rows[0].n;
      if (waiting === 10) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(10); // Actual PostgreSQL overlap, not merely Promise.all scheduling.
    await gate.query("COMMIT");
    responses = await Promise.all(pending);
  } finally {
    await gate.query("ROLLBACK");
    await Promise.allSettled(pending);
    gate.release(); await control.end();
  }
  const results = await Promise.all(responses.map(async (response, index) => {
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ duplicate: false, balance: expectedPoints[index], creditedQuantity: expectedPoints[index] });
    return result;
  }));
  expect(new Set(results.map(r => r.entryId)).size).toBe(10);
  const retries = await Promise.all(cohort.map((f, index) => awardRoute(request("/api/cashier/award", purchases[index], f.cashier.cookie))));
  for (const [index, response] of retries.entries()) {
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true, entryId: results[index].entryId, balance: expectedPoints[index] });
  }
  await Promise.all(cohort.map(async (f, index) => {
    const foreign = cohort[(index + 1) % 10];
    const [reward] = await getMerchantRewards({ actorUserId: f.owner.userId, programSlug: f.merchant.programSlug });
    const redemption = { membershipId: f.member.id, rewardVersionId: reward.versionId, idempotencyKey: "shared-cohort-redemption-key", requestId: randomUUID() };
    expect((await redeemRoute(request("/api/cashier/redeem", redemption, foreign.owner.cookie))).status).toBe(404);
    for (let replay = 0; replay < 2; replay++) expect((await redeemRoute(request("/api/cashier/redeem", redemption, f.cashier.cookie))).status).toBe(200);
    expect((await getCard(f.cardToken)).balance).toBe(expectedPoints[index] - 3);
    const entries = (await pool.query("SELECT tenant_id,location_id,membership_id,actor_user_id,kind,delta FROM ledger_entries WHERE tenant_id=$1 ORDER BY created_at", [f.merchant.tenantId])).rows;
    expect(entries).toEqual([
      { tenant_id: f.merchant.tenantId, location_id: f.merchant.locationId, membership_id: f.member.id, actor_user_id: f.cashier.userId, kind: "award", delta: expectedPoints[index] },
      { tenant_id: f.merchant.tenantId, location_id: f.merchant.locationId, membership_id: f.member.id, actor_user_id: f.cashier.userId, kind: "redeem", delta: -3 },
    ]);
    const audit = (await pool.query("SELECT tenant_id,rule_version_id,amount_minor,currency,applied_rate,points_awarded,rounding FROM purchase_awards WHERE ledger_entry_id=$1", [results[index].entryId])).rows;
    expect(audit).toEqual([{ tenant_id: f.merchant.tenantId, rule_version_id: purchases[index].ruleVersionId, amount_minor: 499, currency: "EUR", applied_rate: index + 1, points_awarded: expectedPoints[index], rounding: "floor" }]);
    expect(await getMerchantAnalytics(f.owner.userId, { windowDays: 30, asOf: new Date(Date.now() + 1000) })).toMatchObject({ currentActiveCards: 1, qualifyingCheckouts: 1, issued: { pointUnits: expectedPoints[index], stampUnits: 0, awardActions: 1 }, rewards: { redemptions: 1 } });
    await revokeStaff({ actorUserId: f.owner.userId, userId: f.cashier.userId });
    expect((await awardRoute(request("/api/cashier/award", { ...purchases[index], idempotencyKey: randomUUID() }, f.cashier.cookie))).status).toBe(403);
  }));
  expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries")).rows[0].n).toBe(20);
  expect((await pool.query("SELECT count(*)::int AS n FROM purchase_awards")).rows[0].n).toBe(10);
}, 60000);
