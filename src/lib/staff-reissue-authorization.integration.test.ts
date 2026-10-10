import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "./auth";
import { createMerchant, enroll, getCard } from "./product";
import { award } from "./loyalty";
import { acceptStaffInvite, createStaffInvite, revokeStaff } from "./staff";
import { issueWalletPass } from "./wallet/issue";
import { POST as reissueRoute } from "@/app/api/merchant/customers/[membershipId]/reissue/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Synthetic PostgreSQL required");
const original = { registration: process.env.PUBLIC_REGISTRATION_ENABLED, invites: process.env.STAFF_INVITE_SIGNUP_ENABLED };
const origin = "http://localhost:3000";
const password = "synthetic-reissue-test-password-only";
beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tenants, "user", rate_limits CASCADE');
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  process.env.STAFF_INVITE_SIGNUP_ENABLED = "true";
});
afterEach(() => {
  for (const [name, value] of [["PUBLIC_REGISTRATION_ENABLED", original.registration], ["STAFF_INVITE_SIGNUP_ENABLED", original.invites]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
afterAll(async () => { await pool.end(); });
function request(path: string, body: unknown, cookie = "") {
  return new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json", cookie }, body: JSON.stringify(body) });
}
async function login(email: string) {
  const response = await auth.handler(request("/api/auth/sign-in/email", { email, password }));
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
async function fixture() {
  const email = `${randomUUID()}@example.test`;
  const owner = await auth.api.signUpEmail({ body: { name: "Synthetic owner", email, password } });
  const merchant = await createMerchant({ userId: owner.user.id, businessName: "Synthetic reissue café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Test card", programType: "stamp", rulesText: "One stamp per checkout.", rewardTitle: "Coffee", rewardCost: 8 });
  process.env.PUBLIC_REGISTRATION_ENABLED = "false";
  const managerEmail = `${randomUUID()}@example.test`;
  const invite = await createStaffInvite({ actorUserId: owner.user.id, locationId: merchant.locationId, email: managerEmail, role: "manager" });
  const manager = await auth.api.signUpEmail({ body: { name: "Synthetic manager", email: managerEmail, password }, headers: new Headers({ "x-loynara-invite": invite.token }) });
  await acceptStaffInvite({ userId: manager.user.id, token: invite.token });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  await award({ userId: owner.user.id, locationId: merchant.locationId, membershipId: card.id, quantity: 2, requestId: randomUUID(), idempotencyKey: randomUUID() });
  const pass = await issueWalletPass(card.cardToken, "apple", id => id);
  // Synthetic provider state, no issuance/network send: exercise the real reissue revocation queue.
  await pool.query("UPDATE wallet_passes SET status='active' WHERE id=$1", [pass.id]);
  return { ownerId: owner.user.id, ownerCookie: await login(email), managerId: manager.user.id, managerCookie: await login(managerEmail), merchant, card, pass };
}
const body = () => ({ reason: "Synthetic lost phone, entitlement checked", verificationMethod: "card_link", entitlementConfirmed: true, idempotencyKey: randomUUID() });
function reissue(f: Awaited<ReturnType<typeof fixture>>, cookie = f.managerCookie, payload = body()) {
  return reissueRoute(request(`/api/merchant/customers/${f.card.id}/reissue`, payload, cookie), { params: Promise.resolve({ membershipId: f.card.id }) });
}
async function waitForLockOrCompletion(fragment: string, completed: () => boolean = () => false) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rowCount } = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE $1", [`%${fragment}%`]);
    if (rowCount || completed()) return;
    await new Promise(done => setTimeout(done, 10));
  }
  throw new Error(`No observed PostgreSQL wait or completion: ${fragment}`);
}

it("commits authenticated reissue before concurrent revocation returns, then denies the same session", async () => {
  const f = await fixture();
  const ledger = (await pool.query("SELECT * FROM ledger_entries WHERE membership_id=$1 ORDER BY id", [f.card.id])).rows;
  const gate = await pool.connect(); const order: string[] = [];
  let operation: Promise<Response> | undefined; let departure: ReturnType<typeof revokeStaff> | undefined;
  const payload = body();
  let committedAtDeparture: Record<string, unknown> | undefined;
  try {
    await gate.query("BEGIN"); await gate.query("LOCK TABLE memberships IN SHARE MODE");
    operation = reissue(f, f.managerCookie, payload).then(value => { order.push("reissue"); return value; }); void operation.catch(() => undefined);
    await waitForLockOrCompletion('update "memberships"');
    departure = revokeStaff({ actorUserId: f.ownerId, userId: f.managerId }).then(async value => {
      order.push("revocation");
      committedAtDeparture = (await pool.query("SELECT card_token,scan_code,balance FROM memberships WHERE id=$1", [f.card.id])).rows[0];
      return value;
    }); void departure.catch(() => undefined);
    await waitForLockOrCompletion("staff_roles", () => order.includes("revocation"));
    expect(order).toEqual([]);
    await gate.query("COMMIT");
    expect((await operation).status).toBe(200); expect(await departure).toMatchObject({ active: false });
    const current = (await pool.query("SELECT card_token,scan_code,balance FROM memberships WHERE id=$1", [f.card.id])).rows[0];
    // Durable visibility when supported revocation returns establishes database ordering; HTTP callback timing does not.
    expect(committedAtDeparture).toEqual(current);
    expect(current.balance).toBe(2); expect(current.card_token).not.toBe(f.card.cardToken); expect(current.scan_code).not.toBe(f.card.scanCode);
    expect((await reissue(f, f.managerCookie, payload)).status).toBe(403);
    expect((await auth.api.getSession({ headers: new Headers({ cookie: f.managerCookie }) }))?.user.id).toBe(f.managerId);
    expect((await pool.query("SELECT * FROM ledger_entries WHERE membership_id=$1 ORDER BY id", [f.card.id])).rows).toEqual(ledger);
    expect((await pool.query("SELECT count(*)::int AS n FROM card_security_events WHERE membership_id=$1 AND action='card_reissued_by_staff'", [f.card.id])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT status,revoke_reason FROM wallet_passes WHERE id=$1", [f.pass.id])).rows[0]).toEqual({ status: "revocation_pending", revoke_reason: "reissued" });
    expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind='wallet.refresh' AND payload->>'membershipId'=$1", [f.card.id])).rows[0].n).toBe(1);
    await expect(getCard(f.card.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await reissue(f, f.ownerCookie)).status).toBe(200);
  } finally { await gate.query("ROLLBACK"); gate.release(); await Promise.allSettled([operation, departure]); }
}, 20000);

it("denies authenticated reissue when revocation owns the role first without rotating credentials or Wallet jobs", async () => {
  const f = await fixture();
  const before = (await pool.query("SELECT * FROM memberships WHERE id=$1", [f.card.id])).rows;
  const passBefore = (await pool.query("SELECT * FROM wallet_passes WHERE id=$1", [f.pass.id])).rows;
  const jobsBefore = (await pool.query("SELECT * FROM outbox_jobs ORDER BY id")).rows;
  const gate = await pool.connect(); let departure: ReturnType<typeof revokeStaff> | undefined; let operation: Promise<Response> | undefined;
  let completed = false;
  try {
    await gate.query("BEGIN"); await gate.query("LOCK TABLE staff_audit_events IN SHARE MODE");
    departure = revokeStaff({ actorUserId: f.ownerId, userId: f.managerId }); void departure.catch(() => undefined);
    await waitForLockOrCompletion('insert into "staff_audit_events"');
    operation = reissue(f).then(value => { completed = true; return value; }); void operation.catch(() => undefined);
    await waitForLockOrCompletion("staff_roles", () => completed);
    await gate.query("COMMIT");
    expect(await departure).toMatchObject({ active: false }); expect((await operation).status).toBe(403);
    expect((await pool.query("SELECT * FROM memberships WHERE id=$1", [f.card.id])).rows).toEqual(before);
    expect((await pool.query("SELECT * FROM wallet_passes WHERE id=$1", [f.pass.id])).rows).toEqual(passBefore);
    expect((await pool.query("SELECT * FROM outbox_jobs ORDER BY id")).rows).toEqual(jobsBefore);
    expect((await pool.query("SELECT count(*)::int AS n FROM card_security_events WHERE membership_id=$1", [f.card.id])).rows[0].n).toBe(0);
    expect((await getCard(f.card.cardToken)).balance).toBe(2);
    expect((await reissue(f)).status).toBe(403);
  } finally { await gate.query("ROLLBACK"); gate.release(); await Promise.allSettled([operation, departure]); }
}, 20000);


it("keeps identity-before-role ordering when onboarding races an authenticated manager reissue", async () => {
  const f = await fixture(); const gate = await pool.connect();
  let onboarding: Promise<unknown> | undefined; let operation: Promise<Response> | undefined;
  const waits = async (count: number) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%user%'");
      if (rows[0].n >= count) return;
      await new Promise(done => setTimeout(done, 10));
    }
    throw new Error("Expected identity lock waits");
  };
  try {
    await gate.query("BEGIN"); await gate.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [f.managerId]);
    onboarding = createMerchant({ userId: f.managerId, businessName: "Synthetic attempted duplicate", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Test card", programType: "stamp", rulesText: "One stamp per checkout.", rewardTitle: "Coffee", rewardCost: 8 }).then(value => ({ value }), error => ({ error }));
    await waits(1);
    operation = reissue(f); void operation.catch(() => undefined);
    await waits(2);
    await gate.query("COMMIT");
    expect(await onboarding).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect((await operation).status).toBe(200);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.card.id])).rows[0].balance).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS n FROM card_security_events WHERE membership_id=$1", [f.card.id])).rows[0].n).toBe(1);
  } finally { await gate.query("ROLLBACK"); gate.release(); await Promise.allSettled([onboarding, operation]); }
}, 20000);
