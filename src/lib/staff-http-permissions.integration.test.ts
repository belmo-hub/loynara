import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "./auth";
import { createMerchant } from "./product";
import { acceptStaffInvite, createStaffInvite } from "./staff";
import { POST as inviteRoute } from "@/app/api/staff/invite/route";
import { POST as revokeRoute } from "@/app/api/staff/revoke/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");
const previous = { registration: process.env.PUBLIC_REGISTRATION_ENABLED, invite: process.env.STAFF_INVITE_SIGNUP_ENABLED };
const origin = "http://localhost:3000";
const password = "synthetic-staff-http-password-only";
beforeEach(async () => { await pool.query('TRUNCATE tenants, "user" CASCADE'); process.env.PUBLIC_REGISTRATION_ENABLED = "true"; process.env.STAFF_INVITE_SIGNUP_ENABLED = "true"; });
afterAll(async () => {
  for (const [key, value] of [["PUBLIC_REGISTRATION_ENABLED", previous.registration], ["STAFF_INVITE_SIGNUP_ENABLED", previous.invite]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await pool.end();
});
function request(path: string, body: unknown, cookie = "", requestOrigin = origin) {
  return new Request(origin + path, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}
async function identity() {
  const email = randomUUID() + "@example.test";
  const result = await auth.api.signUpEmail({ body: { name: "Synthetic permission identity", email, password } });
  const response = await auth.handler(request("/api/auth/sign-in/email", { email, password }));
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  expect(cookie.length).toBeGreaterThan(0);
  return { userId: result.user.id, email, cookie };
}
async function fixture() {
  const owner = await identity();
  const merchant = await createMerchant({ userId: owner.userId, businessName: "Staff HTTP café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Staff permissions", programType: "stamp", rulesText: "One authorized award", rewardTitle: "Coffee", rewardCost: 5 });
  async function staff(role: "manager" | "cashier") {
    const account = await identity();
    const invite = await createStaffInvite({ actorUserId: owner.userId, locationId: merchant.locationId, email: account.email, role });
    await acceptStaffInvite({ userId: account.userId, token: invite.token });
    return account;
  }
  return { owner, merchant, manager: await staff("manager"), cashier: await staff("cashier") };
}
async function staffState() {
  return Promise.all([pool.query("SELECT * FROM staff_roles ORDER BY user_id").then(r => r.rows), pool.query("SELECT * FROM staff_invites ORDER BY id").then(r => r.rows), pool.query("SELECT * FROM staff_audit_events ORDER BY id").then(r => r.rows)]);
}

it("enforces real-session invitation roles, origin and selected tenant/location without trusting a supplied actor", async () => {
  const f = await fixture(); const foreign = await fixture();
  const body = { locationId: f.merchant.locationId, email: "new-staff@example.test", role: "cashier", actorUserId: f.owner.userId };
  const before = await staffState();
  for (const cookie of [f.manager.cookie, f.cashier.cookie]) expect((await inviteRoute(request("/api/staff/invite", body, cookie))).status).toBe(403);
  expect((await inviteRoute(request("/api/staff/invite", body))).status).toBe(401);
  expect((await inviteRoute(request("/api/staff/invite", body, f.owner.cookie, "https://foreign.example.test"))).status).toBe(403);
  expect((await inviteRoute(request("/api/staff/invite", { ...body, locationId: foreign.merchant.locationId }, f.owner.cookie))).status).toBe(404);
  expect(await staffState()).toEqual(before);
  const response = await inviteRoute(request("/api/staff/invite", { ...body, actorUserId: foreign.owner.userId }, f.owner.cookie));
  expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
  const invitation = await response.json(); expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
  const row = (await pool.query("SELECT tenant_id,location_id,invited_by_user_id FROM staff_invites WHERE invited_email=$1", [body.email])).rows;
  expect(row).toEqual([{ tenant_id: f.merchant.tenantId, location_id: f.merchant.locationId, invited_by_user_id: f.owner.userId }]);
  const audit = (await pool.query("SELECT actor_user_id FROM staff_audit_events WHERE action='invite_created' AND invite_id=(SELECT id FROM staff_invites WHERE invited_email=$1)", [body.email])).rows;
  expect(audit).toEqual([{ actor_user_id: f.owner.userId }]);
});

it("enforces real-session departure permissions and idempotent audit without allowing cross-tenant or owner revocation", async () => {
  const f = await fixture(); const foreign = await fixture();
  const body = { userId: f.cashier.userId, actorUserId: f.owner.userId };
  const before = await staffState();
  for (const cookie of [f.manager.cookie, f.cashier.cookie]) expect((await revokeRoute(request("/api/staff/revoke", body, cookie))).status).toBe(403);
  expect((await revokeRoute(request("/api/staff/revoke", body))).status).toBe(401);
  expect((await revokeRoute(request("/api/staff/revoke", body, f.owner.cookie, "https://foreign.example.test"))).status).toBe(403);
  expect((await revokeRoute(request("/api/staff/revoke", { userId: foreign.cashier.userId }, f.owner.cookie))).status).toBe(404);
  expect((await revokeRoute(request("/api/staff/revoke", { userId: f.owner.userId }, f.owner.cookie))).status).toBe(400);
  expect(await staffState()).toEqual(before);
  for (let replay = 0; replay < 2; replay++) {
    const response = await revokeRoute(request("/api/staff/revoke", { ...body, actorUserId: foreign.owner.userId }, f.owner.cookie));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ userId: f.cashier.userId, active: false });
  }
  expect((await pool.query("SELECT actor_user_id,subject_user_id FROM staff_audit_events WHERE action='access_revoked'")).rows).toEqual([{ actor_user_id: f.owner.userId, subject_user_id: f.cashier.userId }]);
  expect((await auth.api.getSession({ headers: new Headers({ cookie: f.cashier.cookie }) }))?.user.id).toBe(f.cashier.userId);
  const after = await staffState();
  expect((await revokeRoute(request("/api/staff/revoke", { userId: f.manager.userId }, f.cashier.cookie))).status).toBe(403);
  expect((await inviteRoute(request("/api/staff/invite", { locationId: f.merchant.locationId, email: "departed@example.test", role: "cashier" }, f.cashier.cookie))).status).toBe(403);
  expect(await staffState()).toEqual(after);
  expect((await pool.query("SELECT active FROM staff_roles WHERE user_id=$1", [foreign.cashier.userId])).rows).toEqual([{ active: true }]);
});
