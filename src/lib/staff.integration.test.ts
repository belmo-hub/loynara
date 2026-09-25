import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, pool } from "@/db";
import { locations, staffInvites, staffRoles, tenants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { acceptStaffInvite, createStaffInvite, listStaff, revokeStaff } from "./staff";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function fixture() {
  const ownerId = randomUUID();
  const staffId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$2,$3,false),($4,$5,$6,false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`, staffId, "Synthetic cashier", `${staffId}@example.test`]);
  const [tenant] = await db.insert(tenants).values({ name: "Synthetic Café", slug: `staff-${ownerId}` }).returning();
  const [location] = await db.insert(locations).values({ tenantId: tenant.id, name: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
  await db.insert(staffRoles).values({ tenantId: tenant.id, userId: ownerId, role: "owner" });
  return { ownerId, staffId, tenant, location, staffEmail: `${staffId}@example.test` };
}

describe("staff invitations and revocation", () => {
  it("accepts an invite once for its intended signed-in email, then revokes checkout access", async () => {
    const f = await fixture();
    const invite = await createStaffInvite({ actorUserId: f.ownerId, locationId: f.location.id, email: f.staffEmail, role: "cashier" });
    expect(JSON.stringify(await db.select().from(staffInvites))).not.toContain(invite.token);
    await expect(acceptStaffInvite({ userId: f.ownerId, token: invite.token })).rejects.toMatchObject({ code: "INVITE_EMAIL_MISMATCH" });
    await acceptStaffInvite({ userId: f.staffId, token: invite.token });
    await expect(acceptStaffInvite({ userId: f.staffId, token: invite.token })).rejects.toMatchObject({ code: "INVITE_USED" });
    const staff = await listStaff(f.ownerId);
    expect(staff).toMatchObject([{ userId: f.ownerId, role: "owner", active: true }, { userId: f.staffId, role: "cashier", active: true }]);
    await revokeStaff({ actorUserId: f.ownerId, userId: f.staffId });
    const [role] = await db.select().from(staffRoles).where(eq(staffRoles.userId, f.staffId));
    expect(role.active).toBe(false);
  });

  it("does not let a cashier invite, revoke the owner, or access the staff list", async () => {
    const f = await fixture();
    await db.insert(staffRoles).values({ tenantId: f.tenant.id, userId: f.staffId, role: "cashier", locationId: f.location.id });
    await expect(createStaffInvite({ actorUserId: f.staffId, locationId: f.location.id, email: "new@example.test", role: "cashier" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listStaff(f.staffId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revokeStaff({ actorUserId: f.ownerId, userId: f.ownerId })).rejects.toMatchObject({ code: "CANNOT_REVOKE_OWNER" });
  });
});
