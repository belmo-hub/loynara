import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "./auth";
import { GET as me } from "@/app/api/me/route";
import { POST as onboard } from "@/app/api/merchant/onboard/route";
import { GET as readiness } from "@/app/api/merchant/readiness/route";
import { POST as invite } from "@/app/api/staff/invite/route";
import { POST as accept } from "@/app/api/staff/accept/route";
import { POST as enroll } from "@/app/api/enroll/route";
import { GET as card } from "@/app/api/card/[token]/route";
import { POST as award } from "@/app/api/cashier/award/route";
import { GET as lookup } from "@/app/api/cashier/lookup/route";
import { POST as redeem } from "@/app/api/cashier/redeem/route";
import { POST as reissue } from "@/app/api/merchant/customers/[membershipId]/reissue/route";

const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/looplocal_test") throw new Error("Owned synthetic local test database required");
const origin = "http://localhost:3000", previousRegistration = process.env.PUBLIC_REGISTRATION_ENABLED;
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
});
afterAll(async () => { if (previousRegistration === undefined) delete process.env.PUBLIC_REGISTRATION_ENABLED; else process.env.PUBLIC_REGISTRATION_ENABLED = previousRegistration; await pool.end(); });
function request(path: string, cookie = "", body?: object) {
  return new Request(origin + path, { method: body ? "POST" : "GET", headers: { origin, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function identity() {
  const email = randomUUID() + "@example.test", password = "Synthetic-Handoff-095-Only!";
  const account = await auth.api.signUpEmail({ body: { name: "Synthetic handoff", email, password } });
  const signed = await auth.handler(request("/api/auth/sign-in/email", "", { email, password }));
  expect(signed.status).toBe(200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  expect(cookie).not.toBe("");
  return { id: account.user.id, email, cookie };
}
async function json(response: Response, status = 200) { expect(response.status).toBe(status); return response.json(); }
const getCard = (token: string) => card(request(`/api/card/${token}`), { params: Promise.resolve({ token }) });
const recover = (id: string, cookie: string, body: object) => reissue(request(`/api/merchant/customers/${id}/reissue`, cookie, body), { params: Promise.resolve({ membershipId: id }) });

it("rehearses the documented authenticated onboarding, cashier and same-membership support handoff with scoped authoritative reconciliation", async () => {
  const owner = await identity(), foreign = await identity(), cashier = await identity();
  expect(await json(await me(request("/api/me", owner.cookie)))).toMatchObject({ userId: owner.id, tenantId: null });
  const setup = { businessName: "Synthetic Handoff Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic card", programType: "stamp", rulesText: "One synthetic stamp", rewardTitle: "Synthetic coffee", rewardCost: 2 };
  const merchant = await json(await onboard(request("/api/merchant/onboard", owner.cookie, setup)), 201);
  const other = await json(await onboard(request("/api/merchant/onboard", foreign.cookie, { ...setup, businessName: "Synthetic foreign café" })), 201);
  expect(await json(await me(request("/api/me", owner.cookie)))).toMatchObject({ userId: owner.id, tenantId: merchant.tenantId, locationId: merchant.locationId, programId: merchant.programId, role: "owner" });
  expect(await json(await readiness(request("/api/merchant/readiness", owner.cookie)))).toMatchObject({ locationId: merchant.locationId, requiredDone: 1, requiredTotal: 3 });
  const invitation = await json(await invite(request("/api/staff/invite", owner.cookie, { email: cashier.email, role: "cashier", locationId: merchant.locationId })), 201);
  await json(await accept(request("/api/staff/accept", cashier.cookie, { token: invitation.token })));
  expect(await json(await me(request("/api/me", cashier.cookie)))).toMatchObject({ tenantId: merchant.tenantId, locationId: merchant.locationId, role: "cashier" });
  const joined = await json(await enroll(request("/api/enroll", "", { slug: merchant.programSlug, acceptedTerms: true })), 201);
  const initial = await json(await getCard(joined.cardToken));
  const opened = await json(await lookup(request(`/api/cashier/lookup?code=${initial.scanCode}`, cashier.cookie)));
  const membershipId = opened.membershipId;
  expect(membershipId).toMatch(/^[0-9a-f-]{36}$/);
  const awardInput = { membershipId, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() };
  await json(await award(request("/api/cashier/award", cashier.cookie, awardInput)));
  await json(await award(request("/api/cashier/award", cashier.cookie, awardInput)));
  const checked = await json(await lookup(request(`/api/cashier/lookup?code=${initial.scanCode}`, cashier.cookie)));
  await json(await redeem(request("/api/cashier/redeem", cashier.cookie, { membershipId: membershipId, rewardVersionId: checked.rewards[0].id, idempotencyKey: randomUUID(), requestId: randomUUID() })));
  const before = await json(await getCard(joined.cardToken));
  const ledgerBefore = (await pool.query("SELECT id,delta,kind FROM ledger_entries WHERE membership_id=$1 ORDER BY id", [membershipId])).rows;
  expect(ledgerBefore.map(row => row.kind).sort()).toEqual(["award", "redeem"]);
  const recovery = { reason: "Synthetic entitlement rehearsal only", verificationMethod: "other_check", entitlementConfirmed: true, idempotencyKey: randomUUID() };
  expect((await recover(membershipId, "", recovery)).status).toBe(401);
  expect((await recover(membershipId, cashier.cookie, recovery)).status).toBe(403);
  expect((await recover(membershipId, foreign.cookie, recovery)).status).toBe(404);
  expect((await recover(membershipId, owner.cookie, { ...recovery, entitlementConfirmed: false })).status).toBe(400);
  expect((await pool.query("SELECT count(*)::int AS count FROM card_security_events WHERE membership_id=$1 AND action='card_reissued_by_staff'", [membershipId])).rows[0].count).toBe(0);
  const recovered = await json(await recover(membershipId, owner.cookie, recovery));
  expect(await json(await recover(membershipId, owner.cookie, recovery))).toEqual(recovered);
  expect(recovered.membershipId).toBe(membershipId);
  expect(recovered.cardUrl).not.toContain(joined.cardToken);
  expect((await getCard(joined.cardToken)).status).toBe(404);
  expect((await lookup(request(`/api/cashier/lookup?code=${initial.scanCode}`, cashier.cookie))).status).toBe(404);
  const restored = await json(await getCard(new URL(recovered.cardUrl).pathname.split("/").pop()!));
  expect(restored).toMatchObject({ cardLocator: initial.cardLocator, balance: before.balance, activity: before.activity });
  expect((await pool.query("SELECT id,delta,kind FROM ledger_entries WHERE membership_id=$1 ORDER BY id", [membershipId])).rows).toEqual(ledgerBefore);
  expect((await pool.query("SELECT actor_user_id,verification_method FROM card_security_events WHERE membership_id=$1 AND action='card_reissued_by_staff'", [membershipId])).rows).toEqual([{ actor_user_id: owner.id, verification_method: "other_check" }]);
  const ready = await json(await readiness(request("/api/merchant/readiness", owner.cookie)));
  expect(ready).toMatchObject({ locationId: merchant.locationId, requiredDone: 3, requiredTotal: 3 });
  expect(Object.fromEntries(ready.steps.map((step: { id: string; status: string }) => [step.id, step.status]))).toMatchObject({ first_award: "done", first_redemption: "done", team: "done", legal: "external", access: "external" });
  expect(await json(await readiness(request("/api/merchant/readiness", foreign.cookie)))).toMatchObject({ locationId: other.locationId, requiredDone: 1 });
  expect((await readiness(request("/api/merchant/readiness", cashier.cookie))).status).toBe(403);
  expect((await pool.query("SELECT count(*)::int AS count FROM memberships WHERE tenant_id=$1", [merchant.tenantId])).rows[0].count).toBe(1);
  expect((await pool.query("SELECT count(*)::int AS count FROM consent_events WHERE granted=true")).rows[0].count).toBe(0);
  expect((await pool.query("SELECT count(*)::int AS count FROM outbox_jobs")).rows[0].count).toBe(0);
});
