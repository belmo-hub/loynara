import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { locations, programs, staffAuditEvents, staffInvites, staffRoles, subscriptions, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { assertPlateOperator } from "./plates";
import { slugOf } from "./product";
import { inviteTokenHash } from "./staff";

/**
 * A shop the operator creates at the counter (ENG-047): tenant, first location and a one-time owner invitation. The
 * invitation is an ordinary staff_invites row with role owner, so the owner opens /invite/<token>, creates the account
 * with a password of their own through the existing invite sign-up, and the setup assistant follows. The operator sees
 * the link once and never a password. Every function runs the /operator gate first.
 */
type Env = Record<string, string | undefined>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const DAYS = 7;
const shortText = z.string().trim().min(2).max(180);
const shopInput = z.object({
  businessName: shortText,
  locationName: shortText.optional(),
  city: z.string().trim().min(2).max(120),
  country: z.enum(["DE", "MA"]),
  timezone: z.string().min(3).max(80),
  ownerEmail: z.email().max(320),
});

/** Issues the invitation inside the caller's transaction, which holds the tenant row lock. */
async function issue(tx: Transaction, tenantId: string, locationId: string, email: string, actorUserId: string) {
  const [owner] = await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, tenantId), eq(staffRoles.role, "owner"))).limit(1);
  if (owner) throw new DomainError("SHOP_HAS_OWNER", "Dieses Geschäft hat schon eine Inhaberin oder einen Inhaber.");
  const [open] = await tx.select({ id: staffInvites.id }).from(staffInvites)
    .where(and(eq(staffInvites.tenantId, tenantId), eq(staffInvites.role, "owner"), isNull(staffInvites.acceptedAt), isNull(staffInvites.revokedAt), sql`${staffInvites.expiresAt} > now()`)).limit(1);
  if (open) throw new DomainError("OWNER_INVITE_OPEN", "Es gibt schon eine gültige Einladung. Widerrufe sie zuerst.");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000);
  const [invite] = await tx.insert(staffInvites).values({ tenantId, locationId, invitedEmail: email, role: "owner", tokenHash: inviteTokenHash(token), invitedByUserId: actorUserId, expiresAt }).returning({ id: staffInvites.id });
  await tx.insert(staffAuditEvents).values({ tenantId, action: "invite_created", actorUserId, inviteId: invite.id, locationId, role: "owner" });
  return { inviteId: invite.id, token, expiresAt, email };
}

export async function createShopWithOwnerInvite({ actorUserId, env, shop }: { actorUserId: string; env: Env; shop: unknown }) {
  const input = shopInput.parse(shop);
  try { new Intl.DateTimeFormat("de", { timeZone: input.timezone }); } catch { throw new DomainError("INVALID_TIMEZONE", "Unknown timezone"); }
  return db.transaction(async tx => {
    await assertPlateOperator(tx, actorUserId, env);
    const suffix = randomBytes(5).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "");
    const [tenant] = await tx.insert(tenants).values({ name: input.businessName, slug: `${slugOf(input.businessName)}-${suffix}`, currency: input.country === "DE" ? "EUR" : "MAD", locale: input.country === "DE" ? "de" : "fr" }).returning({ id: tenants.id });
    const [location] = await tx.insert(locations).values({ tenantId: tenant.id, name: input.locationName ?? input.businessName, city: input.city, country: input.country, timezone: input.timezone }).returning({ id: locations.id });
    return { tenantId: tenant.id, locationId: location.id, ...await issue(tx, tenant.id, location.id, input.ownerEmail.toLowerCase(), actorUserId) };
  });
}

/** A new invitation for a shop that still has no owner, after the last one expired or was revoked. */
export async function reissueOwnerInvite(raw: { actorUserId: string; env: Env; tenantId: string; ownerEmail: string }) {
  const input = z.object({ tenantId: z.uuid(), ownerEmail: z.email().max(320) }).parse(raw);
  return db.transaction(async tx => {
    await assertPlateOperator(tx, raw.actorUserId, raw.env);
    const [tenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, input.tenantId)).for("update");
    const [location] = tenant ? await tx.select({ id: locations.id }).from(locations).where(eq(locations.tenantId, tenant.id)).orderBy(asc(locations.createdAt), asc(locations.id)).limit(1) : [];
    if (!tenant || !location) throw new DomainError("NOT_FOUND", "Geschäft nicht gefunden.");
    return { tenantId: tenant.id, locationId: location.id, ...await issue(tx, tenant.id, location.id, input.ownerEmail.toLowerCase(), raw.actorUserId) };
  });
}

/** Revokes an owner invitation nobody has used yet; audited with the same action as an owner revoking a staff invitation. */
export async function revokeOwnerInvite(raw: { actorUserId: string; env: Env; inviteId: string }) {
  const inviteId = z.uuid().parse(raw.inviteId);
  return db.transaction(async tx => {
    await assertPlateOperator(tx, raw.actorUserId, raw.env);
    // The same row lock acceptance takes, so a revocation and an acceptance cannot both win.
    const [invite] = await tx.select().from(staffInvites).where(and(eq(staffInvites.id, inviteId), eq(staffInvites.role, "owner"))).for("update");
    if (!invite) throw new DomainError("NOT_FOUND", "Einladung nicht gefunden.");
    if (invite.acceptedAt) throw new DomainError("INVITE_USED", "Die Einladung wurde bereits angenommen.");
    if (invite.revokedAt) return { inviteId, status: "revoked" as const };
    await tx.update(staffInvites).set({ revokedAt: new Date() }).where(eq(staffInvites.id, inviteId));
    await tx.insert(staffAuditEvents).values({ tenantId: invite.tenantId, action: "access_revoked", actorUserId: raw.actorUserId, inviteId, locationId: invite.locationId, role: "owner" });
    return { inviteId, status: "revoked" as const };
  });
}

/** Shops the operator created that have no programme or subscription yet, with their newest owner invitation. Runs inside operatorOverview's gate. */
export async function shopsAwaitingOwner(tx: Transaction) {
  const rows = await tx.select({ tenantId: tenants.id, tenant: tenants.name, location: locations.name, city: locations.city, createdAt: tenants.createdAt,
    inviteId: staffInvites.id, email: staffInvites.invitedEmail, expiresAt: staffInvites.expiresAt, acceptedAt: staffInvites.acceptedAt, revokedAt: staffInvites.revokedAt })
    .from(tenants).innerJoin(locations, eq(locations.tenantId, tenants.id))
    .innerJoin(staffInvites, and(eq(staffInvites.tenantId, tenants.id), eq(staffInvites.role, "owner")))
    .where(sql`not exists (select 1 from ${programs} where ${programs.tenantId} = ${tenants.id}) and not exists (select 1 from ${subscriptions} where ${subscriptions.tenantId} = ${tenants.id})`)
    .orderBy(desc(tenants.createdAt), desc(staffInvites.createdAt));
  const now = new Date();
  const seen = new Set<string>();
  return rows.filter(row => !seen.has(row.tenantId) && seen.add(row.tenantId)).map(({ acceptedAt, revokedAt, ...row }) => ({ ...row,
    status: acceptedAt ? "accepted" as const : revokedAt ? "revoked" as const : row.expiresAt <= now ? "expired" as const : "pending" as const }));
}
