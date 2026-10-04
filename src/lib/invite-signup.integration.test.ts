import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { staffInvites, staffRoles } from "@/db/schema";
import { auth } from "./auth";
import { createMerchant } from "./product";
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
