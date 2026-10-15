import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, pool } from "@/db";
import { locations, staffAuditEvents, staffInvites, staffRoles, tenants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { acceptStaffInvite, createStaffInvite, listStaff, listStaffAudit, listStaffInvites, revokeStaff } from "./staff";

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

  it("accepts only one concurrent invitation when reactivating an inactive account", async () => {
    const f = await fixture();
    const [secondLocation] = await db.insert(locations).values({ tenantId: f.tenant.id, name: "Second", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
    await db.insert(staffRoles).values({ tenantId: f.tenant.id, userId: f.staffId, role: "cashier", locationId: f.location.id, active: false });
    const invites = await Promise.all([
      createStaffInvite({ actorUserId: f.ownerId, locationId: f.location.id, email: f.staffEmail, role: "cashier" }),
      createStaffInvite({ actorUserId: f.ownerId, locationId: secondLocation.id, email: f.staffEmail, role: "manager" }),
    ]);
    const gate = await pool.connect();
    let pending: Promise<PromiseSettledResult<Awaited<ReturnType<typeof acceptStaffInvite>>>[]> | undefined;
    try {
      await gate.query("BEGIN");
      await gate.query("SELECT user_id FROM staff_roles WHERE user_id = $1 FOR UPDATE", [f.staffId]);
      pending = Promise.allSettled(invites.map(invite => acceptStaffInvite({ userId: f.staffId, token: invite.token })));
      let waiting = 0;
      for (let attempt = 0; attempt < 200 && waiting < 2; attempt++) {
        const result = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid() AND (query ILIKE '%staff_roles%' OR query ILIKE '%user%')");
        waiting = result.rows[0].count;
        if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting, "Both acceptances must be blocked before releasing the role row").toBe(2);
      await gate.query("COMMIT");
      const results = await pending;
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toMatchObject([{ reason: { code: "ALREADY_ASSIGNED" } }]);
      const winner = results.findIndex(result => result.status === "fulfilled");
      const [role] = await db.select().from(staffRoles).where(eq(staffRoles.userId, f.staffId));
      expect(role).toMatchObject({ active: true, role: invites[winner].role, locationId: winner === 0 ? f.location.id : secondLocation.id });
      const stored = await db.select().from(staffInvites);
      expect(stored.filter(invite => invite.acceptedAt)).toHaveLength(1);
      expect((await listStaffAudit(f.ownerId)).filter(event => event.action === "invite_accepted")).toHaveLength(1);
      await expect(acceptStaffInvite({ userId: f.staffId, token: invites[1 - winner].token })).rejects.toMatchObject({ code: "ALREADY_ASSIGNED" });
    } finally {
      await gate.query("ROLLBACK");
      await pending;
      gate.release();
    }
  });

  it("does not let an invitation issued before revocation restore access, while a new invitation still can", async () => {
    const f = await fixture();
    const first = await createStaffInvite({ actorUserId: f.ownerId, locationId: f.location.id, email: f.staffEmail, role: "cashier" });
    const resent = await createStaffInvite({ actorUserId: f.ownerId, locationId: f.location.id, email: f.staffEmail.toUpperCase(), role: "manager" });
    await acceptStaffInvite({ userId: f.staffId, token: first.token });
    await revokeStaff({ actorUserId: f.ownerId, userId: f.staffId });
    await expect(acceptStaffInvite({ userId: f.staffId, token: resent.token })).rejects.toMatchObject({ code: "INVALID_INVITE" });
    expect((await db.select().from(staffRoles).where(eq(staffRoles.userId, f.staffId)))[0]).toMatchObject({ active: false, role: "cashier" });
    expect((await listStaffInvites(f.ownerId)).find(invite => invite.id === resent.id)).toMatchObject({ status: "revoked" });
    const fresh = await createStaffInvite({ actorUserId: f.ownerId, locationId: f.location.id, email: f.staffEmail, role: "cashier" });
    await acceptStaffInvite({ userId: f.staffId, token: fresh.token });
    expect((await db.select().from(staffRoles).where(eq(staffRoles.userId, f.staffId)))[0]).toMatchObject({ active: true, role: "cashier" });
  });

  it("rejects expired, revoked and unauthenticated invitations without assigning a role", async () => {
    const f = await fixture();
    const invite = await createStaffInvite({ actorUserId: f.ownerId, locationId: f.location.id, email: f.staffEmail, role: "manager" });
    await expect(acceptStaffInvite({ userId: randomUUID(), token: invite.token })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(acceptStaffInvite({ userId: f.staffId, token: "invalid" })).rejects.toMatchObject({ code: "INVALID_INVITE" });
    await db.update(staffInvites).set({ expiresAt: new Date(0) });
    await expect(acceptStaffInvite({ userId: f.staffId, token: invite.token })).rejects.toMatchObject({ code: "INVALID_INVITE" });
    await db.update(staffInvites).set({ expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() });
    await expect(acceptStaffInvite({ userId: f.staffId, token: invite.token })).rejects.toMatchObject({ code: "INVALID_INVITE" });
    expect((await db.select().from(staffRoles).where(eq(staffRoles.userId, f.staffId)))).toHaveLength(0);
    expect((await listStaffAudit(f.ownerId)).map(event => event.action)).toEqual(["invite_created"]);
  });

  it("rejects foreign locations and accounts already assigned to another tenant", async () => {
    const a = await fixture();
    const b = await fixture();
    await expect(createStaffInvite({ actorUserId: a.ownerId, locationId: b.location.id, email: a.staffEmail, role: "cashier" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.insert(staffRoles).values({ tenantId: a.tenant.id, userId: a.staffId, role: "cashier", locationId: a.location.id, active: false });
    const invite = await createStaffInvite({ actorUserId: b.ownerId, locationId: b.location.id, email: a.staffEmail, role: "manager" });
    await expect(acceptStaffInvite({ userId: a.staffId, token: invite.token })).rejects.toMatchObject({ code: "ALREADY_ASSIGNED" });
    const [role] = await db.select().from(staffRoles).where(eq(staffRoles.userId, a.staffId));
    expect(role).toMatchObject({ tenantId: a.tenant.id, active: false, role: "cashier", locationId: a.location.id });
    expect((await listStaffAudit(b.ownerId)).map(event => event.action)).toEqual(["invite_created"]);
  });

  it("does not let a cashier invite, revoke the owner, or access the staff list", async () => {
    const f = await fixture();
    await db.insert(staffRoles).values({ tenantId: f.tenant.id, userId: f.staffId, role: "cashier", locationId: f.location.id });
    await expect(createStaffInvite({ actorUserId: f.staffId, locationId: f.location.id, email: "new@example.test", role: "cashier" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listStaff(f.staffId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revokeStaff({ actorUserId: f.ownerId, userId: f.ownerId })).rejects.toMatchObject({ code: "CANNOT_REVOKE_OWNER" });
  });

  it("records successful invite, acceptance and revocation once without storing the invitation token", async () => {
    const f = await fixture();
    const invite = await createStaffInvite({ actorUserId: f.ownerId, locationId: f.location.id, email: f.staffEmail, role: "cashier" });
    await expect(acceptStaffInvite({ userId: f.ownerId, token: invite.token })).rejects.toMatchObject({ code: "INVITE_EMAIL_MISMATCH" });
    await acceptStaffInvite({ userId: f.staffId, token: invite.token });
    await revokeStaff({ actorUserId: f.ownerId, userId: f.staffId });
    await revokeStaff({ actorUserId: f.ownerId, userId: f.staffId });
    const history = await listStaffAudit(f.ownerId);
    expect(history.map(event => event.action)).toEqual(["access_revoked", "invite_accepted", "invite_created"]);
    expect(history).toMatchObject([
      { actorUserId: f.ownerId, subjectUserId: f.staffId, locationId: f.location.id, role: "cashier" },
      { actorUserId: f.staffId, subjectUserId: f.staffId, locationId: f.location.id, role: "cashier" },
      { actorUserId: f.ownerId, subjectUserId: null, locationId: f.location.id, role: "cashier" },
    ]);
    expect(JSON.stringify(history)).not.toContain(invite.token);
    expect(JSON.stringify(history)).not.toContain(f.staffEmail);
    expect((await db.select().from(staffAuditEvents))).toHaveLength(3);
    await expect(pool.query("UPDATE staff_audit_events SET action = 'invite_created' WHERE id = $1", [history[0].id])).rejects.toThrow(/append-only/i);
    await expect(pool.query("DELETE FROM staff_audit_events WHERE id = $1", [history[0].id])).rejects.toThrow(/append-only/i);
  });

  it("allows only an active owner to read audit events from their tenant", async () => {
    const a = await fixture();
    const b = await fixture();
    await createStaffInvite({ actorUserId: a.ownerId, locationId: a.location.id, email: a.staffEmail, role: "cashier" });
    await createStaffInvite({ actorUserId: b.ownerId, locationId: b.location.id, email: b.staffEmail, role: "manager" });
    expect((await listStaffAudit(a.ownerId)).map(event => event.tenantId)).toEqual([a.tenant.id]);
    expect((await listStaffAudit(b.ownerId)).map(event => event.tenantId)).toEqual([b.tenant.id]);
    await expect(listStaffAudit(a.staffId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, a.ownerId));
    await expect(listStaffAudit(a.ownerId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
