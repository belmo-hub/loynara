import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { locations, programs, staffAuditEvents, staffInvites, staffRoles, tenants } from "@/db/schema";
import { POST as shopRoute } from "@/app/api/operator/shop/route";
import { auth } from "./auth";
import { pendingInvite } from "./invite-signup";
import { operatorOverview } from "./operator";
import { createShopWithOwnerInvite, reissueOwnerInvite, revokeOwnerInvite } from "./owner-invites";
import { createMerchant, getMerchantContext, setupDraft } from "./product";
import { acceptStaffInvite, createStaffInvite, inviteTokenHash, listStaffAudit, listStaffInvites, revokeStaffInvite } from "./staff";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./disposable-test-database";

assertLocalTestDatabaseUrl();
const origin = "http://localhost:3000";
const keys = ["PLATE_OPERATOR_USER_IDS", "PUBLIC_BASE_URL", "PUBLIC_REGISTRATION_ENABLED", "STAFF_INVITE_SIGNUP_ENABLED"] as const;
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let operator: { userId: string; cookie: string };
beforeEach(async () => {
  await assertDisposableDatabase(pool);
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
  Object.assign(process.env, { PUBLIC_BASE_URL: origin, PUBLIC_REGISTRATION_ENABLED: "true", STAFF_INVITE_SIGNUP_ENABLED: "true" });
  operator = await identity();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  // Registration is closed in production; accounts below come only through an invitation.
  process.env.PUBLIC_REGISTRATION_ENABLED = "false";
});
afterAll(async () => {
  for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  await pool.end();
});

const PASSWORD = "Synthetic-Owner-047-Only!";
async function identity(email = randomUUID() + "@example.test", token?: string) {
  const signed = await auth.api.signUpEmail({ body: { name: "Synthetic person", email, password: PASSWORD }, headers: new Headers(token ? { "x-loynara-invite": token } : {}) });
  const response = await auth.handler(new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) }));
  return { userId: signed.user.id, cookie: response.headers.getSetCookie().map(x => x.split(";")[0]).join("; ") };
}
const post = (body: unknown, cookie = "", headers: Record<string, string> = { Origin: origin }) =>
  shopRoute(new Request(origin + "/api/operator/shop", { method: "POST", headers: { "Content-Type": "application/json", ...headers, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const shopBody = (ownerEmail = "inhaber@example.test") => ({ action: "create", businessName: "Synthetic Barbier", city: "Kassel", country: "DE", timezone: "Europe/Berlin", ownerEmail });
const env = () => process.env;
const create = (ownerEmail?: string) => createShopWithOwnerInvite({ actorUserId: operator.userId, env: env(), shop: shopBody(ownerEmail) });
const tokenOf = (link: string) => new URL(link).pathname.split("/").pop()!;
const code = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { return (error as { code?: string }).code ?? "OTHER"; } return "NONE"; };
const wizard = (userId: string) => createMerchant({ userId, businessName: "Barbier Nord", locationName: "Nordstadt", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Haarschnittkarte", programType: "stamp", rulesText: "Ein Stempel pro Haarschnitt.", rewardTitle: "Haarschnitt gratis", rewardCost: 10 });
/** An owner who set a shop up alone, the way every shop was made before. */
async function shopOwner() {
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  const { userId, cookie } = await identity();
  process.env.PUBLIC_REGISTRATION_ENABLED = "false";
  return { user: userId, cookie, merchant: await wizard(userId) };
}

it("answers an empty 404 to anonymous visitors, shop owners and cross-origin calls, before the body or the limiter", async () => {
  const owner = await shopOwner();
  const ownerLogin = owner.cookie;
  for (const cookie of ["", ownerLogin]) { const res = await post(shopBody(), cookie); expect(res.status).toBe(404); expect(await res.text()).toBe(""); }
  expect((await post(shopBody(), operator.cookie, {})).status).toBe(404);
  const junk = await shopRoute(new Request(origin + "/api/operator/shop", { method: "POST", headers: { "Content-Type": "text/plain", Origin: origin, cookie: ownerLogin }, body: "garbage" }));
  expect(junk.status).toBe(404); expect(await junk.text()).toBe("");
  expect((await post({ action: "nonsense" }, operator.cookie)).status).toBe(400);
  expect((await post({ ...shopBody(), ownerEmail: "not-an-address" }, operator.cookie)).status).toBe(400);
  expect(await code(() => createShopWithOwnerInvite({ actorUserId: owner.user, env: env(), shop: shopBody() }))).toBe("FORBIDDEN");
  expect(await code(() => createShopWithOwnerInvite({ actorUserId: operator.userId, env: {}, shop: shopBody() }))).toBe("FORBIDDEN");
  expect(await db.select().from(tenants)).toHaveLength(1); // only the owner's own shop
  expect(await db.select().from(staffInvites)).toHaveLength(0);
});

it("creates the shop and an owner invitation that the owner turns into an account, then the assistant finishes the same shop", async () => {
  const res = await post({ ...shopBody("Inhaber@Example.test"), locationName: "Nordstadt" }, operator.cookie);
  expect(res.status).toBe(201);
  const created = await res.json() as { tenantId: string; link: string; email: string; expiresAt: string; token?: string };
  expect(created).not.toHaveProperty("token");
  expect(created.email).toBe("inhaber@example.test");
  expect(created.link).toMatch(/^http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}$/);
  const token = tokenOf(created.link);
  const days = (new Date(created.expiresAt).getTime() - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(6.99); expect(days).toBeLessThanOrEqual(7);
  const [invite] = await db.select().from(staffInvites);
  expect(invite).toMatchObject({ tenantId: created.tenantId, role: "owner", invitedEmail: "inhaber@example.test", invitedByUserId: operator.userId });
  expect(invite.tokenHash).not.toContain(token); // only the hash is stored
  expect((await db.select().from(staffAuditEvents)).map(e => [e.action, e.role, e.actorUserId])).toEqual([["invite_created", "owner", operator.userId]]);
  expect(await db.select().from(locations).where(eq(locations.tenantId, created.tenantId))).toMatchObject([{ name: "Nordstadt", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }]);
  expect(await pendingInvite(token)).toMatchObject({ role: "owner", businessName: "Synthetic Barbier", locationName: "Nordstadt" });
  expect((await operatorOverview(operator.userId)).awaiting).toMatchObject([{ tenantId: created.tenantId, status: "pending", email: "inhaber@example.test" }]);

  // The owner picks the password through the existing invite sign-up; only the invited address works.
  await expect(identity("someone@example.test", token)).rejects.toThrow(/Registration is not enabled/);
  const owner = await identity("inhaber@example.test", token);
  expect(await acceptStaffInvite({ userId: owner.userId, token })).toMatchObject({ tenantId: created.tenantId, role: "owner" });
  expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, owner.userId))).toMatchObject([{ tenantId: created.tenantId, role: "owner", locationId: null, active: true }]);
  expect(await getMerchantContext(owner.userId)).toBeNull(); // the owner app shows the assistant next
  expect(await setupDraft(owner.userId)).toEqual({ businessName: "Synthetic Barbier", locationName: "Nordstadt", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de" });
  expect((await operatorOverview(operator.userId)).awaiting).toMatchObject([{ status: "accepted" }]);

  const done = await wizard(owner.userId);
  expect(done.tenantId).toBe(created.tenantId);
  expect(await db.select().from(tenants)).toMatchObject([{ id: created.tenantId, name: "Barbier Nord" }]);
  expect(await db.select().from(programs)).toMatchObject([{ tenantId: created.tenantId, locationId: done.locationId }]);
  expect(await getMerchantContext(owner.userId)).toMatchObject({ tenantId: created.tenantId, role: "owner", businessName: "Barbier Nord", programSlug: done.programSlug });
  expect(await setupDraft(owner.userId)).toBeNull();
  expect(await wizard(owner.userId)).toMatchObject({ programId: done.programId }); // a retry returns the same shop
  expect((await operatorOverview(operator.userId)).awaiting).toEqual([]);
});

it("is single use, expires after 7 days, can be revoked, and a new one is issued only while the shop has no owner", async () => {
  const first = await create();
  const token = first.token;
  // Revoked: neither sign-up nor acceptance; audited with the operator as actor.
  expect(await code(() => reissueOwnerInvite({ actorUserId: operator.userId, env: env(), tenantId: first.tenantId, ownerEmail: "inhaber@example.test" }))).toBe("OWNER_INVITE_OPEN");
  expect(await revokeOwnerInvite({ actorUserId: operator.userId, env: env(), inviteId: first.inviteId })).toEqual({ inviteId: first.inviteId, status: "revoked" });
  expect(await pendingInvite(token)).toBeNull();
  await expect(identity("inhaber@example.test", token)).rejects.toThrow(/Registration is not enabled/);
  expect((await db.select().from(staffAuditEvents)).map(e => [e.action, e.role, e.actorUserId])).toContainEqual(["access_revoked", "owner", operator.userId]);

  // Expired: the same refusals.
  const second = await reissueOwnerInvite({ actorUserId: operator.userId, env: env(), tenantId: first.tenantId, ownerEmail: "inhaber@example.test" });
  await pool.query("UPDATE staff_invites SET expires_at = now() - interval '1 second' WHERE id = $1", [second.inviteId]);
  await expect(identity("inhaber@example.test", second.token)).rejects.toThrow(/Registration is not enabled/);
  expect((await operatorOverview(operator.userId)).awaiting).toMatchObject([{ status: "expired" }]);

  // Used once: a second acceptance, or another account with the same link, gets nothing.
  const third = await reissueOwnerInvite({ actorUserId: operator.userId, env: env(), tenantId: first.tenantId, ownerEmail: "inhaber@example.test" });
  const owner = await identity("inhaber@example.test", third.token);
  expect(await code(() => acceptStaffInvite({ userId: owner.userId, token: second.token }))).toBe("INVALID_INVITE");
  await acceptStaffInvite({ userId: owner.userId, token: third.token });
  expect(await code(() => acceptStaffInvite({ userId: owner.userId, token: third.token }))).toBe("INVITE_USED");
  expect(await pendingInvite(third.token)).toBeNull();
  expect(await code(() => revokeOwnerInvite({ actorUserId: operator.userId, env: env(), inviteId: third.inviteId }))).toBe("INVITE_USED");
  expect(await code(() => reissueOwnerInvite({ actorUserId: operator.userId, env: env(), tenantId: first.tenantId, ownerEmail: "zweite@example.test" }))).toBe("SHOP_HAS_OWNER");
  expect(await db.select().from(staffRoles)).toHaveLength(1);
});

it("refuses a second owner even if a second owner invitation got past issuing", async () => {
  const shop = await create();
  const first = await identity("inhaber@example.test", shop.token);
  await acceptStaffInvite({ userId: first.userId, token: shop.token });
  // Not reachable through issuing (it refuses once the shop has an owner): written directly, as defence in depth.
  const token = randomBytes(32).toString("base64url");
  await db.insert(staffInvites).values({ tenantId: shop.tenantId, locationId: shop.locationId, invitedEmail: "zweite@example.test", role: "owner", tokenHash: inviteTokenHash(token), invitedByUserId: operator.userId, expiresAt: new Date(Date.now() + 86_400_000) });
  const second = await identity("zweite@example.test", token);
  expect(await code(() => acceptStaffInvite({ userId: second.userId, token }))).toBe("INVALID_INVITE");
  expect(await db.select().from(staffRoles).where(eq(staffRoles.tenantId, shop.tenantId))).toMatchObject([{ userId: first.userId, role: "owner" }]);
});

it("keeps owner invitations apart from other shops and from staff invitations", async () => {
  const other = await shopOwner();
  const shop = await create();
  // An account that already belongs to a shop cannot become this shop's owner.
  const invited = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [invited, "Synthetic owner", "inhaber@example.test"]);
  await db.insert(staffRoles).values({ tenantId: other.merchant.tenantId, userId: invited, role: "cashier", locationId: other.merchant.locationId, active: false });
  expect(await code(() => acceptStaffInvite({ userId: invited, token: shop.token }))).toBe("ALREADY_ASSIGNED");
  await db.delete(staffRoles).where(eq(staffRoles.userId, invited));
  // Another shop's owner sees and revokes nothing of it, and the owner flow stays operator-only.
  expect(await listStaffInvites(other.user)).toEqual([]);
  expect(await code(() => revokeStaffInvite({ actorUserId: other.user, inviteId: shop.inviteId }))).toBe("NOT_FOUND");
  expect(await code(() => revokeOwnerInvite({ actorUserId: other.user, env: env(), inviteId: shop.inviteId }))).toBe("FORBIDDEN");
  expect(await code(() => reissueOwnerInvite({ actorUserId: operator.userId, env: env(), tenantId: other.merchant.tenantId, ownerEmail: "x@example.test" }))).toBe("SHOP_HAS_OWNER");
  // A staff invitation cannot be revoked through the owner path, and still works as before.
  const staff = await createStaffInvite({ actorUserId: other.user, email: "kasse@example.test", role: "cashier", locationId: other.merchant.locationId });
  expect(await code(() => revokeOwnerInvite({ actorUserId: operator.userId, env: env(), inviteId: staff.id }))).toBe("NOT_FOUND");
  expect(await listStaffInvites(other.user)).toMatchObject([{ role: "cashier", status: "pending" }]);
  await acceptStaffInvite({ userId: invited, token: shop.token });
  expect(await code(() => revokeStaffInvite({ actorUserId: invited, inviteId: shop.inviteId }))).toBe("NOT_FOUND");
  // The new owner's Team page lists no owner invitation, while the audit shows who created it.
  expect(await listStaffInvites(invited)).toEqual([]);
  expect((await listStaffAudit(invited)).map(e => [e.action, e.role])).toEqual(expect.arrayContaining([["invite_created", "owner"], ["invite_accepted", "owner"]]));
});
