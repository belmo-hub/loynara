import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { locations, memberships, programs, secureTags, staffRoles, tapRequests, tenants } from "@/db/schema";
import { DomainError, awardTapInTransaction, awardInTransaction } from "./loyalty";
import { verifySdm } from "./secure-tap-crypto";

export type TapKeys = { metaReadKey: Buffer; fileReadKey: Buffer };
export interface TapKeyProvider { getKeys(ref: string): Promise<TapKeys> }
export type TapMode = "disabled" | "automatic_fixed" | "staff_confirmed";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const uidPattern = /^[a-f0-9]{14}$/;
const publicRefPattern = /^[A-Za-z0-9_-]{24}$/;
export function tapCookieName(programId: string) { return `loynara_member_${programId.replaceAll("-", "")}`; }
export function tapCookieHeader(programId: string, cardToken: string, origin: string) {
  return `${tapCookieName(programId)}=${cardToken}; Path=/api/tap; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(process.env.PUBLIC_BASE_URL ?? origin).protocol === "https:" ? "; Secure" : ""}`;
}
export function tapCardToken(request: Request, programId: string): string | undefined {
  const match = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${tapCookieName(programId)}=`));
  const token = match?.slice(tapCookieName(programId).length + 1);
  return token && /^card_[A-Za-z0-9_-]{32,80}$/.test(token) ? token : undefined;
}
export async function bindTapCard(token: string): Promise<string> {
  if (!/^card_[A-Za-z0-9_-]{32,80}$/.test(token)) throw new DomainError("NOT_FOUND", "Card not found");
  const [member] = await db.select({ programId: memberships.programId }).from(memberships).where(and(eq(memberships.cardToken, token), isNull(memberships.closedAt)));
  if (!member) throw new DomainError("NOT_FOUND", "Card not found");
  return member.programId;
}

// Only the synthetic local adapter is supplied in this pass. An approved
// production secret manager must implement TapKeyProvider before enablement.
export const localTapKeyProvider: TapKeyProvider = {
  async getKeys(ref) {
    if (process.env.NODE_ENV === "production" || !process.env.TAP_SYNTHETIC_KEY_FILE || !/^[A-Za-z0-9_-]{1,80}$/.test(ref)) throw new DomainError("TAP_KEY_UNAVAILABLE", "Tap unavailable");
    const path = process.env.TAP_SYNTHETIC_KEY_FILE;
    const info = await stat(path);
    if ((info.mode & 0o077) !== 0) throw new DomainError("TAP_KEY_UNAVAILABLE", "Tap unavailable");
    const document = JSON.parse(await readFile(path, "utf8")) as Record<string, { metaReadKey?: string; fileReadKey?: string }>;
    const entry = document[ref];
    if (!entry || !/^[a-fA-F0-9]{32}$/.test(entry.metaReadKey ?? "") || !/^[a-fA-F0-9]{32}$/.test(entry.fileReadKey ?? "")) throw new DomainError("TAP_KEY_UNAVAILABLE", "Tap unavailable");
    return { metaReadKey: Buffer.from(entry.metaReadKey!, "hex"), fileReadKey: Buffer.from(entry.fileReadKey!, "hex") };
  },
};

async function owner(tx: Transaction, actorUserId: string, tenantId: string) {
  const [role] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, tenantId), eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
  if (!role) throw new DomainError("FORBIDDEN", "Owner access required");
}

export async function setTapPolicy(input: { actorUserId: string; programId: string; mode: TapMode; cooldownSeconds: number | null }) {
  if (!["disabled", "automatic_fixed", "staff_confirmed"].includes(input.mode) || (input.mode !== "disabled" && (!Number.isInteger(input.cooldownSeconds) || input.cooldownSeconds === null || input.cooldownSeconds < 1 || input.cooldownSeconds > 86400))) throw new DomainError("INVALID_TAP_POLICY", "An approved cooldown is required");
  return db.transaction(async tx => {
    const [program] = await tx.select().from(programs).where(eq(programs.id, input.programId)).for("update");
    if (!program) throw new DomainError("NOT_FOUND", "Programme not found");
    await owner(tx, input.actorUserId, program.tenantId);
    if (input.mode !== "disabled" && (program.type !== "stamp" || program.earningMode !== "manual")) throw new DomainError("INVALID_TAP_POLICY", "Tap supports fixed stamps only");
    await tx.update(programs).set({ tapMode: input.mode, tapCooldownSeconds: input.mode === "disabled" ? null : input.cooldownSeconds }).where(eq(programs.id, program.id));
    return { mode: input.mode, cooldownSeconds: input.mode === "disabled" ? null : input.cooldownSeconds };
  });
}

export async function provisionSecureTag(input: { actorUserId: string; programId: string; uid: string; keyRef: string; configVersion: number; replacesTagId?: string }) {
  if (!uidPattern.test(input.uid) || !/^[A-Za-z0-9_-]{1,80}$/.test(input.keyRef) || !Number.isInteger(input.configVersion) || input.configVersion < 1) throw new DomainError("INVALID_TAG", "Invalid provisioning metadata");
  return db.transaction(async tx => {
    const [program] = await tx.select().from(programs).where(eq(programs.id, input.programId)).for("update");
    if (!program || program.type !== "stamp" || program.earningMode !== "manual") throw new DomainError("INVALID_TAG", "Fixed-stamp programme required");
    await owner(tx, input.actorUserId, program.tenantId);
    if (input.replacesTagId) {
      const [old] = await tx.select().from(secureTags).where(and(eq(secureTags.id, input.replacesTagId), eq(secureTags.tenantId, program.tenantId), eq(secureTags.programId, program.id))).for("update");
      if (!old || old.status !== "active") throw new DomainError("INVALID_TAG", "Active tag to replace not found");
      await tx.update(secureTags).set({ status: "replaced", revokedAt: new Date() }).where(eq(secureTags.id, old.id));
    }
    const [tag] = await tx.insert(secureTags).values({ publicRef: randomBytes(18).toString("base64url"), tenantId: program.tenantId, locationId: program.locationId, programId: program.id, uid: input.uid, keyRef: input.keyRef, configVersion: input.configVersion, replacesTagId: input.replacesTagId, provisionedAt: new Date() }).returning();
    return { id: tag.id, publicRef: tag.publicRef, status: tag.status };
  });
}

export async function activateSecureTag(input: { actorUserId: string; tagId: string }) {
  return db.transaction(async tx => {
    const [tag] = await tx.select().from(secureTags).where(eq(secureTags.id, input.tagId)).for("update");
    if (!tag || tag.status !== "provisioned") throw new DomainError("NOT_FOUND", "Provisioned tag not found");
    await owner(tx, input.actorUserId, tag.tenantId);
    const [program] = await tx.select().from(programs).where(and(eq(programs.id, tag.programId), eq(programs.tenantId, tag.tenantId)));
    if (!program || program.status !== "active" || program.tapMode === "disabled") throw new DomainError("TAP_DISABLED", "Tap is disabled");
    await tx.update(secureTags).set({ status: "active", activatedAt: new Date() }).where(eq(secureTags.id, tag.id));
    return { id: tag.id, status: "active" as const };
  });
}

export async function revokeSecureTag(input: { actorUserId: string; tagId: string }) {
  return db.transaction(async tx => {
    const [tag] = await tx.select().from(secureTags).where(eq(secureTags.id, input.tagId)).for("update");
    if (!tag) throw new DomainError("NOT_FOUND", "Tag not found");
    await owner(tx, input.actorUserId, tag.tenantId);
    if (tag.status === "active" || tag.status === "provisioned") await tx.update(secureTags).set({ status: "revoked", revokedAt: new Date() }).where(eq(secureTags.id, tag.id));
    return { id: tag.id, status: "revoked" as const };
  });
}

export async function replaceSecureTag(input: { actorUserId: string; tagId: string; uid: string; keyRef: string; configVersion: number }) {
  const [old] = await db.select().from(secureTags).where(eq(secureTags.id, input.tagId));
  if (!old) throw new DomainError("NOT_FOUND", "Tag not found");
  return provisionSecureTag({ actorUserId: input.actorUserId, programId: old.programId, uid: input.uid, keyRef: input.keyRef, configVersion: input.configVersion, replacesTagId: old.id });
}

type TapInput = { tagRef: string; fields: { encrypted: string; mac: string }; cardToken?: string; keyProvider?: TapKeyProvider; now?: Date };
type TapResult = { state: "awarded" | "already_processed" | "cooldown" | "pending_staff" | "needs_enrollment" | "disabled"; merchantName: string; locationName: string; programName: string; programSlug: string; balance?: number; requestId?: string };

async function verifiedContext(tx: Transaction, input: TapInput) {
  if (!publicRefPattern.test(input.tagRef)) throw new DomainError("NOT_FOUND", "Tap unavailable");
  const [tag] = await tx.select().from(secureTags).where(eq(secureTags.publicRef, input.tagRef)).for("update");
  if (!tag || tag.status !== "active") throw new DomainError("NOT_FOUND", "Tap unavailable");
  const keys = await (input.keyProvider ?? localTapKeyProvider).getKeys(tag.keyRef);
  let decoded: { uid: string; counter: number };
  try { decoded = verifySdm(input.fields, keys); }
  catch { throw new DomainError("INVALID_TAP", "Tap could not be verified"); }
  if (decoded.uid !== tag.uid || decoded.counter < 1) throw new DomainError("INVALID_TAP", "Tap could not be verified");
  const [row] = await tx.select({ program: programs, location: locations, tenant: tenants }).from(programs)
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, programs.tenantId))
    .where(and(eq(programs.id, tag.programId), eq(programs.tenantId, tag.tenantId), eq(programs.locationId, tag.locationId)));
  if (!row || row.program.status !== "active" || row.program.type !== "stamp" || row.program.earningMode !== "manual") throw new DomainError("NOT_FOUND", "Tap unavailable");
  return { tag, counter: decoded.counter, ...row };
}

export async function previewSecureTap(input: TapInput) {
  return db.transaction(async tx => {
    const { tag, program, location, tenant } = await verifiedContext(tx, input);
    const [member] = input.cardToken ? await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.cardToken, input.cardToken), eq(memberships.tenantId, tag.tenantId), eq(memberships.programId, tag.programId), isNull(memberships.closedAt))) : [];
    return { merchantName: tenant.name, locationName: location.name, programName: program.name, programSlug: program.slug, brandColor: location.brandColor, mode: program.tapMode, hasMembership: Boolean(member), cardPath: member ? `/card/${input.cardToken}` : undefined };
  });
}

export async function processSecureTap(input: TapInput): Promise<TapResult> {
  const now = input.now ?? new Date();
  return db.transaction(async tx => {
    const { tag, counter, program, location, tenant } = await verifiedContext(tx, input);
    const base = { merchantName: tenant.name, locationName: location.name, programName: program.name, programSlug: program.slug };
    if (program.tapMode === "disabled" || !program.tapCooldownSeconds) return { ...base, state: "disabled" };
    const [member] = input.cardToken ? await tx.select().from(memberships).where(and(eq(memberships.cardToken, input.cardToken), eq(memberships.tenantId, tag.tenantId), eq(memberships.programId, tag.programId))).for("update") : [];
    if (!member || member.closedAt) return { ...base, state: "needs_enrollment" };
    if (counter <= tag.lastCounter) {
      const [old] = await tx.select().from(tapRequests).where(and(eq(tapRequests.tagId, tag.id), eq(tapRequests.counter, counter)));
      if (old?.membershipId === member.id && old.status === "awarded") return { ...base, state: "already_processed", balance: member.balance };
      if (old?.membershipId === member.id && old.status === "cooldown") return { ...base, state: "cooldown", balance: member.balance };
      if (old?.membershipId === member.id && old.status === "pending_staff") return { ...base, state: "pending_staff", balance: member.balance, requestId: old.id };
      throw new DomainError("REPLAYED_TAP", "Tap already used");
    }
    const [pending] = await tx.select().from(tapRequests).where(and(eq(tapRequests.tenantId, tag.tenantId), eq(tapRequests.locationId, tag.locationId), eq(tapRequests.programId, tag.programId), eq(tapRequests.membershipId, member.id), eq(tapRequests.status, "pending_staff"))).orderBy(desc(tapRequests.createdAt)).limit(1);
    if (pending && pending.expiresAt > now) return { ...base, state: "pending_staff", balance: member.balance, requestId: pending.id };
    const [recent] = await tx.select({ createdAt: tapRequests.createdAt }).from(tapRequests).where(and(eq(tapRequests.tenantId, tag.tenantId), eq(tapRequests.programId, tag.programId), eq(tapRequests.membershipId, member.id), inArray(tapRequests.status, ["awarded", "confirmed"]))).orderBy(desc(tapRequests.createdAt)).limit(1);
    const onCooldown = Boolean(recent && now.getTime() - recent.createdAt.getTime() < program.tapCooldownSeconds * 1000);
    if (onCooldown || program.tapMode === "staff_confirmed") {
      const status = onCooldown ? "cooldown" : "pending_staff";
      const [request] = await tx.insert(tapRequests).values({ tagId: tag.id, counter, tenantId: tag.tenantId, locationId: tag.locationId, programId: tag.programId, membershipId: member.id, status, expiresAt: new Date(now.getTime() + 5 * 60_000), createdAt: now }).returning();
      await tx.update(secureTags).set({ lastCounter: counter }).where(eq(secureTags.id, tag.id));
      return { ...base, state: status, balance: member.balance, requestId: status === "pending_staff" ? request.id : undefined };
    }
    const booked = await awardTapInTransaction(tx, { locationId: tag.locationId, membershipId: member.id, tagId: tag.id, counter });
    await tx.insert(tapRequests).values({ tagId: tag.id, counter, tenantId: tag.tenantId, locationId: tag.locationId, programId: tag.programId, membershipId: member.id, status: "awarded", ledgerEntryId: booked.entryId, expiresAt: new Date(now.getTime() + 5 * 60_000), createdAt: now });
    await tx.update(secureTags).set({ lastCounter: counter }).where(eq(secureTags.id, tag.id));
    return { ...base, state: "awarded", balance: booked.balance };
  });
}

export async function tapProgramId(ref: string): Promise<string> {
  if (!publicRefPattern.test(ref)) throw new DomainError("NOT_FOUND", "Tap unavailable");
  const [tag] = await db.select({ programId: secureTags.programId }).from(secureTags).where(and(eq(secureTags.publicRef, ref), eq(secureTags.status, "active")));
  if (!tag) throw new DomainError("NOT_FOUND", "Tap unavailable");
  return tag.programId;
}

export async function pendingTapRequests(input: { userId: string; locationId: string; now?: Date }) {
  const [role] = await db.select().from(staffRoles).where(and(eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
  if (!role || (role.role !== "owner" && role.locationId !== input.locationId)) throw new DomainError("FORBIDDEN", "Checkout access required");
  const now = input.now ?? new Date();
  return db.select({ id: tapRequests.id, createdAt: tapRequests.createdAt, expiresAt: tapRequests.expiresAt, balance: memberships.balance, scanCode: memberships.scanCode }).from(tapRequests)
    .innerJoin(memberships, and(eq(memberships.id, tapRequests.membershipId), eq(memberships.tenantId, tapRequests.tenantId)))
    .where(and(eq(tapRequests.tenantId, role.tenantId), eq(tapRequests.locationId, input.locationId), eq(tapRequests.status, "pending_staff"), gt(tapRequests.expiresAt, now), isNull(memberships.closedAt)))
    .orderBy(desc(tapRequests.createdAt)).limit(20);
}

export async function confirmTapRequest(input: { userId: string; locationId: string; requestId: string; now?: Date }) {
  return db.transaction(async tx => {
    const [request] = await tx.select().from(tapRequests).where(eq(tapRequests.id, input.requestId)).for("update");
    if (!request || request.locationId !== input.locationId) throw new DomainError("NOT_FOUND", "Pending tap not found");
    const [staff] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, request.tenantId), eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
    if (!staff || (staff.role !== "owner" && staff.locationId !== request.locationId)) throw new DomainError("FORBIDDEN", "Checkout access required");
    if (request.status === "confirmed") return { state: "already_processed" as const, entryId: request.ledgerEntryId };
    if (request.status !== "pending_staff" || request.expiresAt <= (input.now ?? new Date()) || !request.membershipId) throw new DomainError("TAP_EXPIRED", "Pending tap expired");
    const [tag] = await tx.select().from(secureTags).where(eq(secureTags.id, request.tagId));
    if (!tag || tag.status !== "active") throw new DomainError("TAP_EXPIRED", "Tag is no longer active");
    const [program] = await tx.select().from(programs).where(and(eq(programs.id, request.programId), eq(programs.tenantId, request.tenantId)));
    if (!program || program.tapMode !== "staff_confirmed" || program.type !== "stamp" || program.status !== "active") throw new DomainError("TAP_EXPIRED", "Tap programme changed");
    await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.id, request.membershipId)).for("update");
    const [recent] = await tx.select({ createdAt: tapRequests.createdAt }).from(tapRequests).where(and(eq(tapRequests.tenantId, request.tenantId), eq(tapRequests.programId, request.programId), eq(tapRequests.membershipId, request.membershipId), inArray(tapRequests.status, ["awarded", "confirmed"]))).orderBy(desc(tapRequests.createdAt)).limit(1);
    if (recent && (input.now ?? new Date()).getTime() - recent.createdAt.getTime() < (program.tapCooldownSeconds ?? 0) * 1000) throw new DomainError("TAP_COOLDOWN", "This card is still within its tap cooldown");
    const booked = await awardInTransaction(tx, { userId: input.userId, locationId: request.locationId, membershipId: request.membershipId, quantity: 1, idempotencyKey: `tap:${request.tagId}:${request.counter}`, requestId: request.id });
    await tx.update(tapRequests).set({ status: "confirmed", ledgerEntryId: booked.entryId }).where(eq(tapRequests.id, request.id));
    return { state: "confirmed" as const, balance: booked.balance, entryId: booked.entryId };
  });
}
