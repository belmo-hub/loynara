import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "@/db";
import { locations, staffAuditEvents, staffInvites, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";

const inviteInput = z.object({ actorUserId: z.string().min(1), locationId: z.uuid(), email: z.email(), role: z.enum(["manager", "cashier"]) });
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const inviteTokenHash = hash;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function ownerRole(actorUserId: string, tx: Transaction | typeof db = db) {
  const [owner] = await tx.select().from(staffRoles).where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
  return owner;
}

export async function createStaffInvite(raw: z.input<typeof inviteInput>) {
  const input = inviteInput.parse(raw);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.transaction(async tx => {
    const owner = await ownerRole(input.actorUserId, tx);
    const [location] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.id, input.locationId), eq(locations.tenantId, owner.tenantId)));
    if (!location) throw new DomainError("NOT_FOUND", "Location not found");
    const [invite] = await tx.insert(staffInvites).values({ tenantId: owner.tenantId, locationId: location.id, invitedEmail: input.email.toLowerCase(), role: input.role, tokenHash: hash(token), invitedByUserId: input.actorUserId, expiresAt }).returning({ id: staffInvites.id });
    await tx.insert(staffAuditEvents).values({ tenantId: owner.tenantId, action: "invite_created", actorUserId: input.actorUserId, inviteId: invite.id, locationId: location.id, role: input.role });
  });
  return { token, expiresAt, email: input.email.toLowerCase(), role: input.role };
}

export async function acceptStaffInvite(input: { userId: string; token: string }) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(input.token)) throw new DomainError("INVALID_INVITE", "Invalid invitation");
  const result = await pool.query<{ email: string }>('SELECT email FROM "user" WHERE id = $1', [input.userId]);
  const email = result.rows[0]?.email.toLowerCase();
  if (!email) throw new DomainError("UNAUTHENTICATED", "Sign in required");
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(staffInvites).where(eq(staffInvites.tokenHash, hash(input.token))).for("update");
    if (!invite || invite.revokedAt || invite.expiresAt <= new Date()) throw new DomainError("INVALID_INVITE", "Invitation is invalid or expired");
    if (invite.acceptedAt) throw new DomainError("INVITE_USED", "Invitation already accepted");
    if (invite.invitedEmail !== email) throw new DomainError("INVITE_EMAIL_MISMATCH", "Sign in with the invited email address");
    const assigned = await tx.select().from(staffRoles).where(eq(staffRoles.userId, input.userId));
    if (assigned.some((role) => role.tenantId !== invite.tenantId)) throw new DomainError("ALREADY_ASSIGNED", "Account already belongs to another merchant");
    if (assigned.some((role) => role.active)) throw new DomainError("ALREADY_ASSIGNED", "Account already has an active merchant role");
    const [prior] = assigned;
    if (prior) await tx.update(staffRoles).set({ role: invite.role, locationId: invite.locationId, active: true }).where(and(eq(staffRoles.userId, input.userId), eq(staffRoles.tenantId, invite.tenantId)));
    else {
      const inserted = await tx.insert(staffRoles).values({ tenantId: invite.tenantId, userId: input.userId, role: invite.role, locationId: invite.locationId })
        .onConflictDoNothing({ target: staffRoles.userId }).returning({ userId: staffRoles.userId });
      if (!inserted.length) throw new DomainError("ALREADY_ASSIGNED", "Account already belongs to another merchant");
    }
    await tx.update(staffInvites).set({ acceptedAt: new Date() }).where(eq(staffInvites.id, invite.id));
    await tx.insert(staffAuditEvents).values({ tenantId: invite.tenantId, action: "invite_accepted", actorUserId: input.userId, subjectUserId: input.userId, inviteId: invite.id, locationId: invite.locationId, role: invite.role });
    return { tenantId: invite.tenantId, locationId: invite.locationId, role: invite.role };
  });
}

export async function listStaff(actorUserId: string) {
  const owner = await ownerRole(actorUserId);
  const roles = await db.select().from(staffRoles).where(eq(staffRoles.tenantId, owner.tenantId));
  const result = await pool.query<{ id: string; email: string }>('SELECT id, email FROM "user" WHERE id = ANY($1::text[])', [roles.map((role) => role.userId)]);
  const emails = new Map(result.rows.map((row) => [row.id, row.email]));
  return roles.map((role) => ({ userId: role.userId, email: emails.get(role.userId), role: role.role, locationId: role.locationId, active: role.active })).sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
}

export async function listStaffAudit(actorUserId: string) {
  const owner = await ownerRole(actorUserId);
  return db.select().from(staffAuditEvents).where(eq(staffAuditEvents.tenantId, owner.tenantId))
    .orderBy(desc(staffAuditEvents.createdAt), desc(staffAuditEvents.id)).limit(50);
}

export async function revokeStaff(input: { actorUserId: string; userId: string }) {
  return db.transaction(async tx => {
    const owner = await ownerRole(input.actorUserId, tx);
    const [target] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, owner.tenantId), eq(staffRoles.userId, input.userId))).for("update");
    if (!target) throw new DomainError("NOT_FOUND", "Staff member not found");
    if (target.role === "owner") throw new DomainError("CANNOT_REVOKE_OWNER", "Owner role cannot be revoked here");
    if (!target.active) return { userId: input.userId, active: false };
    await tx.update(staffRoles).set({ active: false }).where(and(eq(staffRoles.tenantId, owner.tenantId), eq(staffRoles.userId, input.userId)));
    await tx.insert(staffAuditEvents).values({ tenantId: owner.tenantId, action: "access_revoked", actorUserId: input.actorUserId, subjectUserId: input.userId, locationId: target.locationId, role: target.role });
    return { userId: input.userId, active: false };
  });
}
