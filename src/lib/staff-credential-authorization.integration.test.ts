import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, staffRoles } from "@/db/schema";
import { auth } from "./auth";
import { createMerchant, enroll } from "./product";
import { acceptStaffInvite, createStaffInvite, revokeStaff } from "./staff";
import { POST as cashierAward } from "@/app/api/cashier/award/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Credential tests require looplocal_test");
const previousRegistration = process.env.PUBLIC_REGISTRATION_ENABLED;
const previousInvite = process.env.STAFF_INVITE_SIGNUP_ENABLED;
const origin = "http://localhost:3000";
const initialPassword = "synthetic-original-password-only";
const changedPassword = "synthetic-changed-password-only";
beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tenants, "user" CASCADE');
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  process.env.STAFF_INVITE_SIGNUP_ENABLED = "true";
});
afterAll(async () => {
  for (const [key, value] of [["PUBLIC_REGISTRATION_ENABLED", previousRegistration], ["STAFF_INVITE_SIGNUP_ENABLED", previousInvite]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});
function request(path: string, body: unknown, cookie = "", extra: Record<string, string> = {}) {
  return new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body) });
}
async function login(email: string, password: string) {
  const response = await auth.handler(request("/api/auth/sign-in/email", { email, password }));
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  expect(Boolean(cookie)).toBe(true);
  return cookie;
}
it("keeps revoked cashier authorization denied through an old session and a real password change with fresh login", async () => {
  const ownerEmail = randomUUID() + "@example.test";
  const owner = await auth.api.signUpEmail({ body: { name: "Synthetic owner", email: ownerEmail, password: initialPassword } });
  const merchant = await createMerchant({ userId: owner.user.id, businessName: "Synthetic credential café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Test card", programType: "stamp", rulesText: "One stamp per checkout.", rewardTitle: "Coffee", rewardCost: 8 });
  process.env.PUBLIC_REGISTRATION_ENABLED = "false";
  async function cashier() {
    const email = randomUUID() + "@example.test";
    const invite = await createStaffInvite({ actorUserId: owner.user.id, locationId: merchant.locationId, email, role: "cashier" });
    const created = await auth.api.signUpEmail({ body: { name: "Synthetic cashier", email, password: initialPassword }, headers: new Headers({ "x-loynara-invite": invite.token }) });
    await acceptStaffInvite({ userId: created.user.id, token: invite.token });
    return { email, userId: created.user.id, cookie: await login(email, initialPassword) };
  }
  const departed = await cashier();
  const unaffected = await cashier();
  const ownerCookie = await login(ownerEmail, initialPassword);
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  const awardRequest = (cookie: string) => cashierAward(request("/api/cashier/award", { membershipId: card.id, quantity: 1, requestId: randomUUID(), idempotencyKey: randomUUID() }, cookie));
  expect((await awardRequest(departed.cookie)).status).toBe(200);
  await revokeStaff({ actorUserId: owner.user.id, userId: departed.userId });
  const before = await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, card.id));
  const changed = await auth.handler(request("/api/auth/change-password", { currentPassword: initialPassword, newPassword: changedPassword, revokeOtherSessions: false }, departed.cookie));
  expect(changed.status).toBe(200);
  // The old session remains authenticated under the existing password-change contract.
  expect((await auth.api.getSession({ headers: new Headers({ cookie: departed.cookie }) }))?.user.id).toBe(departed.userId);
  expect((await awardRequest(departed.cookie)).status).toBe(403);
  const fresh = await login(departed.email, changedPassword);
  expect((await awardRequest(fresh)).status).toBe(403);
  expect((await auth.handler(request("/api/auth/sign-in/email", { email: departed.email, password: initialPassword }))).status).toBe(401);
  const [role] = await db.select().from(staffRoles).where(eq(staffRoles.userId, departed.userId));
  expect(role.active).toBe(false);
  expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, card.id))).toEqual(before);
  const [unchanged] = await db.select().from(memberships).where(eq(memberships.id, card.id));
  expect(unchanged.balance).toBe(1);
  expect((await awardRequest(unaffected.cookie)).status).toBe(200);
  expect((await awardRequest(ownerCookie)).status).toBe(200);
  const [final] = await db.select().from(memberships).where(eq(memberships.id, card.id));
  expect(final.balance).toBe(3);
});
