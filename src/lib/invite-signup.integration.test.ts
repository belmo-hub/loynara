import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { staffAuditEvents, staffInvites, staffRoles } from "@/db/schema";
import { auth } from "./auth";
import { inviteAllowsSignUp, inviteSignUpEnabled, pendingInvite } from "./invite-signup";
import { createMerchant, getMerchantContext } from "./product";
import { createAdditionalLocation } from "./locations";
import { acceptStaffInvite, createStaffInvite } from "./staff";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const previous = { registration: process.env.PUBLIC_REGISTRATION_ENABLED, invite: process.env.STAFF_INVITE_SIGNUP_ENABLED };
beforeEach(async () => {
  process.env.PUBLIC_REGISTRATION_ENABLED = "false";
  process.env.STAFF_INVITE_SIGNUP_ENABLED = "true";
  await pool.query('TRUNCATE TABLE tenants, "user" CASCADE');
});
afterAll(async () => {
  for (const [key, value] of [["PUBLIC_REGISTRATION_ENABLED", previous.registration], ["STAFF_INVITE_SIGNUP_ENABLED", previous.invite]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

async function invited(email = "kasse@example.test") {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Synthetic owner", `${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Synthetic Invite Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
  const invite = await createStaffInvite({ actorUserId: owner, email, role: "cashier", locationId: merchant.locationId });
  return { owner, merchant, invite };
}
const signUp = (email: string, token?: string) => auth.api.signUpEmail({
  body: { name: "Synthetic cashier", email, password: "synthetic-password-long-enough" },
  headers: new Headers(token ? { "x-loynara-invite": token } : {}),
});

describe("invite-gated staff sign-up", () => {
  it("creates an account only for the invited address with the invitation token, then accepts the role", async () => {
    const { merchant, invite } = await invited();
    await expect(signUp("kasse@example.test")).rejects.toThrow(/Registration is not enabled/);
    await expect(signUp("kasse@example.test", "x".repeat(43))).rejects.toThrow(/Registration is not enabled/);
    await expect(signUp("someone-else@example.test", invite.token)).rejects.toThrow(/Registration is not enabled/);

    const created = await signUp("Kasse@Example.test", invite.token);
    expect(created.user.email).toBe("kasse@example.test");
    expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, created.user.id))).toHaveLength(0);
    expect(await acceptStaffInvite({ userId: created.user.id, token: invite.token })).toMatchObject({ role: "cashier", locationId: merchant.locationId });

    // An accepted invitation cannot open registration again, not even for another address.
    await expect(signUp("second@example.test", invite.token)).rejects.toThrow(/Registration is not enabled/);
  });

  it("stays closed when the flag is off, and for revoked or expired invitations", async () => {
    const { invite } = await invited();
    process.env.STAFF_INVITE_SIGNUP_ENABLED = "false";
    await expect(signUp("kasse@example.test", invite.token)).rejects.toThrow(/Registration is not enabled/);
    process.env.STAFF_INVITE_SIGNUP_ENABLED = "true";

    await db.update(staffInvites).set({ revokedAt: new Date() }).where(eq(staffInvites.invitedEmail, "kasse@example.test"));
    await expect(signUp("kasse@example.test", invite.token)).rejects.toThrow(/Registration is not enabled/);

    const other = await invited("later@example.test");
    await db.update(staffInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(staffInvites.invitedEmail, "later@example.test"));
    await expect(signUp("later@example.test", other.invite.token)).rejects.toThrow(/Registration is not enabled/);
  });
});

describe("invitation lifecycle", () => {
  it("is off unless explicitly enabled, and only the literal string true enables it", () => {
    expect(inviteSignUpEnabled({})).toBe(false);
    for (const value of ["", "false", "TRUE", "1", "yes", " true"]) expect(inviteSignUpEnabled({ STAFF_INVITE_SIGNUP_ENABLED: value }), value).toBe(false);
    expect(inviteSignUpEnabled({ STAFF_INVITE_SIGNUP_ENABLED: "true" })).toBe(true);
  });

  it("ignores malformed tokens and non-string emails, and stores only a hash of the token", async () => {
    const { invite, owner } = await invited();
    for (const token of [undefined, null, "", "short", "x".repeat(39), "x".repeat(61), `${invite.token} `, `${invite.token}!`]) expect(await inviteAllowsSignUp(token, "kasse@example.test"), String(token)).toBe(false);
    for (const email of [undefined, null, 42, ["kasse@example.test"], { email: "kasse@example.test" }]) expect(await inviteAllowsSignUp(invite.token, email)).toBe(false);
    expect(await pendingInvite("x".repeat(43))).toBeNull();
    const rows = await pool.query("SELECT token_hash FROM staff_invites");
    expect(rows.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows[0].token_hash).not.toContain(invite.token);
    for (const table of ["staff_invites", "staff_audit_events"]) expect(JSON.stringify((await pool.query(`SELECT * FROM ${table}`)).rows)).not.toContain(invite.token);
    void owner;
  });

  it("assigns exactly the invited role and location, and a second sign-up for the same address is refused", async () => {
    const { owner, merchant } = await invited();
    const second = await createAdditionalLocation(owner, { name: "Second counter", city: "Bonn", country: "DE", timezone: "Europe/Berlin", programName: "Bonn card", programType: "stamp", rulesText: "Ein Stempel pro Kassenvorgang.", rewardTitle: "Testkaffee", rewardCost: 4 });
    const managerInvite = await createStaffInvite({ actorUserId: owner, email: "leitung@example.test", role: "manager", locationId: second.locationId });
    const created = await signUp("leitung@example.test", managerInvite.token);
    await acceptStaffInvite({ userId: created.user.id, token: managerInvite.token });
    expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, created.user.id))).toMatchObject([{ role: "manager", locationId: second.locationId, tenantId: merchant.tenantId, active: true }]);
    expect(await getMerchantContext(created.user.id)).toMatchObject({ role: "manager", locationId: second.locationId });
    // Same address again: the invitation no longer admits anyone, and the account cannot be created twice.
    await expect(signUp("leitung@example.test", managerInvite.token)).rejects.toThrow(/Registration is not enabled/);
    const audit = await db.select().from(staffAuditEvents).where(eq(staffAuditEvents.subjectUserId, created.user.id));
    expect(audit).toMatchObject([{ action: "invite_accepted", role: "manager", locationId: second.locationId, actorUserId: created.user.id }]);
  });

  it("accepts an invitation once, even when two requests arrive together", async () => {
    const { invite } = await invited();
    const created = await signUp("kasse@example.test", invite.token);
    const outcomes = await Promise.allSettled([1, 2, 3, 4].map(() => acceptStaffInvite({ userId: created.user.id, token: invite.token })));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ code: "INVITE_USED" });
    expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, created.user.id))).toHaveLength(1);
    expect((await db.select().from(staffAuditEvents).where(eq(staffAuditEvents.action, "invite_accepted")))).toHaveLength(1);
  });

  it("lets an existing account holder accept, but only with the invited address and no other active role", async () => {
    const { owner, invite, merchant } = await invited("bestehend@example.test");
    // The invited address already has an account: no new sign-up is possible (or needed).
    const existing = await auth.api.signUpEmail({ body: { name: "Existing", email: "bestehend@example.test", password: "synthetic-password-long-enough" } }).catch(() => null);
    expect(existing).toBeNull(); // registration is closed without an invitation header
    process.env.PUBLIC_REGISTRATION_ENABLED = "true";
    const account = await auth.api.signUpEmail({ body: { name: "Existing", email: "bestehend@example.test", password: "synthetic-password-long-enough" } });
    process.env.PUBLIC_REGISTRATION_ENABLED = "false";
    await expect(signUp("bestehend@example.test", invite.token)).rejects.toThrow(/already exists|exists/i);
    // Wrong person: another account cannot use the token.
    process.env.PUBLIC_REGISTRATION_ENABLED = "true";
    const stranger = await auth.api.signUpEmail({ body: { name: "Stranger", email: "fremd@example.test", password: "synthetic-password-long-enough" } });
    process.env.PUBLIC_REGISTRATION_ENABLED = "false";
    await expect(acceptStaffInvite({ userId: stranger.user.id, token: invite.token })).rejects.toMatchObject({ code: "INVITE_EMAIL_MISMATCH" });
    // An account that already works for a merchant cannot be moved by an invitation.
    const busyOwner = await createStaffInvite({ actorUserId: owner, email: "bestehend@example.test", role: "cashier", locationId: merchant.locationId });
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, userId: account.user.id, role: "cashier", locationId: merchant.locationId });
    await expect(acceptStaffInvite({ userId: account.user.id, token: busyOwner.token })).rejects.toMatchObject({ code: "ALREADY_ASSIGNED" });
    // Before any role exists the matching account accepts normally.
    await db.delete(staffRoles).where(eq(staffRoles.userId, account.user.id));
    expect(await acceptStaffInvite({ userId: account.user.id, token: invite.token })).toMatchObject({ role: "cashier", locationId: merchant.locationId });
  });

  it("does not let a revoked or expired invitation be accepted by an account that already exists", async () => {
    const { invite } = await invited();
    const created = await signUp("kasse@example.test", invite.token);
    await db.update(staffInvites).set({ revokedAt: new Date() }).where(eq(staffInvites.invitedEmail, "kasse@example.test"));
    await expect(acceptStaffInvite({ userId: created.user.id, token: invite.token })).rejects.toMatchObject({ code: "INVALID_INVITE" });
    await db.update(staffInvites).set({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) }).where(eq(staffInvites.invitedEmail, "kasse@example.test"));
    await expect(acceptStaffInvite({ userId: created.user.id, token: invite.token })).rejects.toMatchObject({ code: "INVALID_INVITE" });
    expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, created.user.id))).toHaveLength(0);
  });
});
