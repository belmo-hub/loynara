import { recoveryVerificationRequired } from "./recovery-policy";
import { cookieValue, customerCookieAttributes, issueCustomerSession, readCustomerSession } from "./customer-session";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { and, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { locations, memberships, programs, secureTags, staffRoles, tapRequests, tenants } from "@/db/schema";
import { DomainError, awardTapInTransaction, awardInTransaction } from "./loyalty";
import { verifySdm } from "./secure-tap-crypto";
import { AUTOMATIC_TAP_REFUSAL, automaticTapAllowed, isProductionDeployment } from "./pilot-policy";
import { formatCardLocator } from "./card-locator";
import { enqueueTapPush } from "./staff-push";
import { derivedProviderFromEnv, type TapKeyContext, type TapKeyProvider, type TapKeys } from "./nfc-keys";

export type { TapKeyProvider, TapKeys };
export type TapMode = "disabled" | "automatic_fixed" | "staff_confirmed";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const uidPattern = /^[a-f0-9]{14}$/;
const publicRefPattern = /^[A-Za-z0-9_-]{24}$/;
export function tapCookieName(programId: string) { return `loynara_member_${programId.replaceAll("-", "")}`; }
export function tapCookieHeader(programId: string, cardToken: string, origin: string, shared = false) {
  return `${tapCookieName(programId)}=${issueCustomerSession(programId, cardToken, shared)}; ${customerCookieAttributes(origin, "/api/tap")}`;
}
export function tapMemberSession(request: Request, programId: string) {
  return readCustomerSession(cookieValue(request, tapCookieName(programId)), programId);
}
export function tapCardToken(request: Request, programId: string): string | undefined {
  return tapMemberSession(request, programId)?.token;
}
export async function bindTapCard(token: string): Promise<string> {
  if (!/^card_[A-Za-z0-9_-]{32,80}$/.test(token)) throw new DomainError("NOT_FOUND", "Card not found");
  const [member] = await db.select({ programId: memberships.programId }).from(memberships).where(and(eq(memberships.cardToken, token), isNull(memberships.closedAt)));
  if (!member) throw new DomainError("NOT_FOUND", "Card not found");
  return member.programId;
}

// Synthetic file keys are for development, preview and device-test processes only. They are refused on the real
// production deployment, which is identified by the canonical production marker (the preview and device-test web
// processes also run NODE_ENV=production, so NODE_ENV cannot make this distinction). Production verifies taps with
// the derived provider (lib/nfc-keys) once the owner has approved where its master secret lives.
export const localTapKeyProvider: TapKeyProvider = {
  async getKeys(ref) {
    if (isProductionDeployment() || !process.env.TAP_SYNTHETIC_KEY_FILE || !/^[A-Za-z0-9_-]{1,80}$/.test(ref)) throw new DomainError("TAP_KEY_UNAVAILABLE", "Tap unavailable");
    const path = process.env.TAP_SYNTHETIC_KEY_FILE;
    const info = await stat(path);
    if ((info.mode & 0o077) !== 0) throw new DomainError("TAP_KEY_UNAVAILABLE", "Tap unavailable");
    const document = JSON.parse(await readFile(path, "utf8")) as Record<string, { metaReadKey?: string; fileReadKey?: string }>;
    const entry = document[ref];
    if (!entry || !/^[a-fA-F0-9]{32}$/.test(entry.metaReadKey ?? "") || !/^[a-fA-F0-9]{32}$/.test(entry.fileReadKey ?? "")) throw new DomainError("TAP_KEY_UNAVAILABLE", "Tap unavailable");
    return { metaReadKey: Buffer.from(entry.metaReadKey!, "hex"), fileReadKey: Buffer.from(entry.fileReadKey!, "hex") };
  },
};

/** The provider this deployment verifies taps with. Production: derived keys only. Elsewhere: derived if configured, else the synthetic file. */
export function defaultTapKeyProvider(): TapKeyProvider {
  const derived = derivedProviderFromEnv();
  if (isProductionDeployment()) {
    if (!derived) throw new DomainError("TAP_KEY_UNAVAILABLE", "Tap unavailable");
    return derived;
  }
  return derived ?? localTapKeyProvider;
}

async function owner(tx: Transaction, actorUserId: string, tenantId: string) {
  const [role] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, tenantId), eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
  if (!role) throw new DomainError("FORBIDDEN", "Owner access required");
}

export async function setTapPolicy(input: { actorUserId: string; programId: string; mode: TapMode; cooldownSeconds: number | null }) {
  if (input.mode === "automatic_fixed" && !automaticTapAllowed()) throw new DomainError("TAP_AUTOMATIC_NOT_ALLOWED", AUTOMATIC_TAP_REFUSAL);
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

export type PreparedTagPolicy = { tenantId: string; locationId: string; programId: string; mode: "staff_confirmed"; cooldownSeconds: number };
function assertPreparedPolicy(program: typeof programs.$inferSelect, policy?: PreparedTagPolicy): void {
  if (policy && (program.id !== policy.programId || program.tenantId !== policy.tenantId || program.locationId !== policy.locationId || program.status !== "active" || program.type !== "stamp" || program.earningMode !== "manual" || program.tapMode !== policy.mode || program.tapCooldownSeconds !== policy.cooldownSeconds)) throw new DomainError("PREPARED_POLICY_MISMATCH", "Approved tag policy changed");
}
export async function provisionSecureTag(input: { actorUserId: string; programId: string; uid: string; keyRef: string; configVersion: number; replacesTagId?: string; expectedPolicy?: PreparedTagPolicy; /** The reference already written on the chip; generated when omitted. */ publicRef?: string }) {
  if (input.publicRef !== undefined && !publicRefPattern.test(input.publicRef)) throw new DomainError("INVALID_TAG", "Invalid tag reference");
  if (!uidPattern.test(input.uid) || !/^[A-Za-z0-9_-]{1,80}$/.test(input.keyRef) || !Number.isInteger(input.configVersion) || input.configVersion < 1) throw new DomainError("INVALID_TAG", "Invalid provisioning metadata");
  return db.transaction(async tx => {
    const [program] = await tx.select().from(programs).where(eq(programs.id, input.programId)).for("update");
    if (!program || program.type !== "stamp" || program.earningMode !== "manual") throw new DomainError("INVALID_TAG", "Fixed-stamp programme required");
    await owner(tx, input.actorUserId, program.tenantId);
    assertPreparedPolicy(program, input.expectedPolicy);
    if (input.replacesTagId) {
      const [old] = await tx.select().from(secureTags).where(and(eq(secureTags.id, input.replacesTagId), eq(secureTags.tenantId, program.tenantId), eq(secureTags.programId, program.id))).for("update");
      if (!old || old.status !== "active") throw new DomainError("INVALID_TAG", "Active tag to replace not found");
      await tx.update(secureTags).set({ status: "replaced", revokedAt: new Date() }).where(eq(secureTags.id, old.id));
    }
    const [tag] = await tx.insert(secureTags).values({ publicRef: input.publicRef ?? randomBytes(18).toString("base64url"), tenantId: program.tenantId, locationId: program.locationId, programId: program.id, uid: input.uid, keyRef: input.keyRef, configVersion: input.configVersion, replacesTagId: input.replacesTagId, provisionedAt: new Date() }).returning();
    return { id: tag.id, publicRef: tag.publicRef, status: tag.status };
  });
}

export async function activateSecureTag(input: { actorUserId: string; tagId: string; expectedPolicy?: PreparedTagPolicy; expectedTag?: { uid: string; keyRef: string; publicRef: string }; /** Highest counter already seen (verification reads made during provisioning), so those URLs can never be replayed. */ initialCounter?: number }) {
  return db.transaction(async tx => {
    const [tag] = await tx.select().from(secureTags).where(eq(secureTags.id, input.tagId)).for("update");
    if (!tag || tag.status !== "provisioned") throw new DomainError("NOT_FOUND", "Provisioned tag not found");
    await owner(tx, input.actorUserId, tag.tenantId);
    if (input.expectedTag && (tag.uid !== input.expectedTag.uid || tag.keyRef !== input.expectedTag.keyRef || tag.publicRef !== input.expectedTag.publicRef)) throw new DomainError("PREPARED_POLICY_MISMATCH", "Approved tag binding changed");
    const query = tx.select().from(programs).where(and(eq(programs.id, tag.programId), eq(programs.tenantId, tag.tenantId)));
    const [program] = input.expectedPolicy ? await query.for("update") : await query;
    if (!program || program.status !== "active" || program.tapMode === "disabled") throw new DomainError("TAP_DISABLED", "Tap is disabled");
    assertPreparedPolicy(program, input.expectedPolicy);
    if (input.expectedPolicy && tag.locationId !== input.expectedPolicy.locationId) throw new DomainError("PREPARED_POLICY_MISMATCH", "Approved location changed");
    await tx.update(secureTags).set({ status: "active", activatedAt: new Date(), ...(input.initialCounter ? { lastCounter: Math.max(tag.lastCounter, input.initialCounter) } : {}) }).where(eq(secureTags.id, tag.id));
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
export type TapResult = { state: "awarded" | "already_processed" | "confirmed" | "cooldown" | "pending_staff" | "expired" | "cancelled" | "needs_enrollment" | "disabled"; expiresAt?: Date; merchantName: string; locationName: string; programName: string; programSlug: string; balance?: number; requestId?: string; statusRef?: string;
  /** The card number, so the guest can tell the cashier which waiting request is theirs. Never a credential. */
  cardLocator?: string;
  /** Server-internal: the wake-up job created with a new pending request, sent right after commit. Never sent to the browser. */
  pushJobId?: string };

async function verifiedContext(tx: Transaction, input: TapInput) {
  if (!publicRefPattern.test(input.tagRef)) throw new DomainError("NOT_FOUND", "Tap unavailable");
  const [tag] = await tx.select().from(secureTags).where(eq(secureTags.publicRef, input.tagRef)).for("update");
  if (!tag || tag.status !== "active") throw new DomainError("NOT_FOUND", "Tap unavailable");
  const keys = await (input.keyProvider ?? defaultTapKeyProvider()).getKeys(tag.keyRef, { uid: tag.uid } satisfies TapKeyContext);
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
    const [member] = input.cardToken ? await tx.select({ id: memberships.id, cardLocator: memberships.cardLocator }).from(memberships).where(and(eq(memberships.cardToken, input.cardToken), eq(memberships.tenantId, tag.tenantId), eq(memberships.programId, tag.programId), isNull(memberships.closedAt))) : [];
    return { merchantName: tenant.name, locationName: location.name, programName: program.name, programSlug: program.slug, brandColor: location.brandColor, mode: program.tapMode, hasMembership: Boolean(member), recoveryEmailRequired: member ? await recoveryVerificationRequired(tx, tag.tenantId, member.id) : false, cardLocator: member ? formatCardLocator(member.cardLocator) : undefined, cardPath: member ? `/card/${input.cardToken}` : undefined };
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
    if (await recoveryVerificationRequired(tx, member.tenantId, member.id)) throw new DomainError("RECOVERY_EMAIL_REQUIRED", "Bestätige zuerst die Wiederherstellungs-E-Mail deiner Karte. Danach geht diese Berührung weiter.");
    const cardLocator = formatCardLocator(member.cardLocator);
    // Pending requests can be shared by two tags of one programme. Poll using the request's own tag binding.
    const statusRefFor = async (requestTagId: string) => {
      if (requestTagId === tag.id) return tag.publicRef;
      const [boundTag] = await tx.select({ publicRef: secureTags.publicRef }).from(secureTags).where(and(eq(secureTags.id, requestTagId), eq(secureTags.tenantId, tag.tenantId), eq(secureTags.programId, tag.programId)));
      if (!boundTag) throw new DomainError("NOT_FOUND", "Tap unavailable");
      return boundTag.publicRef;
    };
    // What a request means to the guest who tapped, reported without booking anything.
    const reportOf = async (request: typeof tapRequests.$inferSelect): Promise<TapResult> => {
      if (request.status === "awarded") return { ...base, state: "already_processed", balance: member.balance, cardLocator };
      if (request.status === "confirmed") return { ...base, state: "confirmed", balance: member.balance, cardLocator };
      if (request.status === "cooldown") return { ...base, state: "cooldown", balance: member.balance };
      if (request.status === "cancelled") return { ...base, state: "cancelled", balance: member.balance };
      if (request.status === "pending_staff" && request.expiresAt > now) return { ...base, state: "pending_staff", balance: member.balance, requestId: request.id, expiresAt: request.expiresAt, cardLocator, statusRef: await statusRefFor(request.tagId) };
      return { ...base, state: "expired", balance: member.balance };
    };
    if (counter <= tag.lastCounter) {
      const [old] = await tx.select().from(tapRequests).where(and(eq(tapRequests.tagId, tag.id), eq(tapRequests.counter, counter)));
      // The same tap seen again (reload, retry, polling) reports where that request stands. It never books anything.
      if (old?.membershipId === member.id) return reportOf(old);
      if (!old) {
        // A tap that arrived while this card already had a waiting request was attached to that request: its counter was
        // used up then, without a row of its own. Seen again (the guest's page polling, or a saved link much later), it
        // reports the card's latest request and can never open a new one.
        const [latest] = await tx.select().from(tapRequests).where(and(eq(tapRequests.tenantId, tag.tenantId), eq(tapRequests.programId, tag.programId), eq(tapRequests.membershipId, member.id), lte(tapRequests.createdAt, now))).orderBy(desc(tapRequests.createdAt)).limit(1);
        if (latest) return reportOf(latest);
      }
      throw new DomainError("REPLAYED_TAP", "Tap already used");
    }
    const [pending] = await tx.select().from(tapRequests).where(and(eq(tapRequests.tenantId, tag.tenantId), eq(tapRequests.locationId, tag.locationId), eq(tapRequests.programId, tag.programId), eq(tapRequests.membershipId, member.id), eq(tapRequests.status, "pending_staff"))).orderBy(desc(tapRequests.createdAt)).limit(1);
    if (pending && pending.expiresAt > now) {
      // Attach this tap to the waiting request and use up its counter, so the same link cannot open a new request later.
      await tx.update(secureTags).set({ lastCounter: counter }).where(eq(secureTags.id, tag.id));
      return { ...base, state: "pending_staff", balance: member.balance, requestId: pending.id, expiresAt: pending.expiresAt, cardLocator, statusRef: await statusRefFor(pending.tagId) };
    }
    const [recent] = await tx.select({ createdAt: tapRequests.createdAt }).from(tapRequests).where(and(eq(tapRequests.tenantId, tag.tenantId), eq(tapRequests.programId, tag.programId), eq(tapRequests.membershipId, member.id), inArray(tapRequests.status, ["awarded", "confirmed"]))).orderBy(desc(tapRequests.createdAt)).limit(1);
    const onCooldown = Boolean(recent && now.getTime() - recent.createdAt.getTime() < program.tapCooldownSeconds * 1000);
    if (onCooldown || program.tapMode === "staff_confirmed" || !automaticTapAllowed()) { // pilot policy: never award automatically on the production deployment
      const status = onCooldown ? "cooldown" : "pending_staff";
      const [request] = await tx.insert(tapRequests).values({ tagId: tag.id, counter, tenantId: tag.tenantId, locationId: tag.locationId, programId: tag.programId, membershipId: member.id, status, expiresAt: new Date(now.getTime() + 5 * 60_000), createdAt: now }).returning();
      await tx.update(secureTags).set({ lastCounter: counter }).where(eq(secureTags.id, tag.id));
      if (status !== "pending_staff") return { ...base, state: status, balance: member.balance };
      // Wake the location's cashier phones. Queued in this transaction, so it exists exactly when the request does.
      const pushJobId = await enqueueTapPush(tx, { tenantId: tag.tenantId, tapRequestId: request.id }) ?? undefined;
      return { ...base, state: status, balance: member.balance, requestId: request.id, expiresAt: request.expiresAt, cardLocator, statusRef: tag.publicRef, pushJobId };
    }
    const booked = await awardTapInTransaction(tx, { locationId: tag.locationId, membershipId: member.id, tagId: tag.id, counter });
    await tx.insert(tapRequests).values({ tagId: tag.id, counter, tenantId: tag.tenantId, locationId: tag.locationId, programId: tag.programId, membershipId: member.id, status: "awarded", ledgerEntryId: booked.entryId, expiresAt: new Date(now.getTime() + 5 * 60_000), createdAt: now });
    await tx.update(secureTags).set({ lastCounter: counter }).where(eq(secureTags.id, tag.id));
    return { ...base, state: "awarded", balance: booked.balance, cardLocator };
  });
}

export async function tapProgramId(ref: string): Promise<string> {
  if (!publicRefPattern.test(ref)) throw new DomainError("NOT_FOUND", "Tap unavailable");
  const [tag] = await db.select({ programId: secureTags.programId }).from(secureTags).where(and(eq(secureTags.publicRef, ref), eq(secureTags.status, "active")));
  if (!tag) throw new DomainError("NOT_FOUND", "Tap unavailable");
  return tag.programId;
}

/** Read the exact waiting request for its card. This path never verifies a new tap, consumes a counter, or books. */
export async function secureTapStatus(input: { tagRef: string; requestId: string; cardToken?: string; now?: Date }): Promise<Pick<TapResult, "state" | "balance" | "cardLocator" | "requestId" | "expiresAt" | "statusRef">> {
  if (!publicRefPattern.test(input.tagRef) || !/^[a-f0-9-]{36}$/.test(input.requestId) || !input.cardToken || !/^card_[A-Za-z0-9_-]{32,80}$/.test(input.cardToken)) throw new DomainError("NOT_FOUND", "Tap unavailable");
  const [row] = await db.select({ request: tapRequests, balance: memberships.balance, locator: memberships.cardLocator, tagStatus: secureTags.status, programStatus: programs.status, tapMode: programs.tapMode }).from(tapRequests)
    .innerJoin(secureTags, and(eq(secureTags.id, tapRequests.tagId), eq(secureTags.tenantId, tapRequests.tenantId), eq(secureTags.programId, tapRequests.programId), eq(secureTags.locationId, tapRequests.locationId)))
    .innerJoin(memberships, and(eq(memberships.id, tapRequests.membershipId), eq(memberships.tenantId, tapRequests.tenantId), eq(memberships.programId, tapRequests.programId)))
    .innerJoin(programs, and(eq(programs.id, tapRequests.programId), eq(programs.tenantId, tapRequests.tenantId), eq(programs.locationId, tapRequests.locationId)))
    .where(and(eq(tapRequests.id, input.requestId), eq(secureTags.publicRef, input.tagRef), eq(memberships.cardToken, input.cardToken), isNull(memberships.closedAt)));
  if (!row) throw new DomainError("NOT_FOUND", "Tap unavailable");
  const { request, balance } = row;
  const cardLocator = formatCardLocator(row.locator);
  if (request.status === "confirmed") return { state: "confirmed", balance, cardLocator };
  if (request.status === "awarded") return { state: "already_processed", balance, cardLocator };
  if (request.status === "cancelled") return { state: "cancelled", balance };
  if (request.status === "cooldown") return { state: "cooldown", balance };
  if (request.status === "pending_staff" && request.expiresAt > (input.now ?? new Date()) && row.tagStatus === "active" && row.programStatus === "active" && row.tapMode === "staff_confirmed") return { state: "pending_staff", balance, cardLocator, requestId: request.id, expiresAt: request.expiresAt, statusRef: input.tagRef };
  return { state: "expired", balance };
}

export async function pendingTapRequests(input: { userId: string; locationId: string; now?: Date }) {
  const [role] = await db.select().from(staffRoles).where(and(eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
  if (!role || (role.role !== "owner" && role.locationId !== input.locationId)) throw new DomainError("FORBIDDEN", "Checkout access required");
  const now = input.now ?? new Date();
  // The card number only: the scan code is a credential and never leaves the server here.
  const rows = await db.select({ id: tapRequests.id, createdAt: tapRequests.createdAt, expiresAt: tapRequests.expiresAt, balance: memberships.balance, locator: memberships.cardLocator }).from(tapRequests)
    .innerJoin(memberships, and(eq(memberships.id, tapRequests.membershipId), eq(memberships.tenantId, tapRequests.tenantId)))
    .where(and(eq(tapRequests.tenantId, role.tenantId), eq(tapRequests.locationId, input.locationId), eq(tapRequests.status, "pending_staff"), gt(tapRequests.expiresAt, now), isNull(memberships.closedAt)))
    .orderBy(desc(tapRequests.createdAt)).limit(20);
  // Remaining and elapsed time are computed here, so a cashier phone with a wrong clock still shows the right countdown.
  return rows.map(({ locator, ...row }) => ({ ...row, cardLocator: formatCardLocator(locator), expiresInMs: Math.max(0, row.expiresAt.getTime() - now.getTime()), ageMs: Math.max(0, now.getTime() - row.createdAt.getTime()) }));
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
    // Waiting for the membership lock can cross the expiry boundary. Decide again immediately before booking.
    if (request.expiresAt <= (input.now ?? new Date())) throw new DomainError("TAP_EXPIRED", "Pending tap expired");
    const booked = await awardInTransaction(tx, { userId: input.userId, locationId: request.locationId, membershipId: request.membershipId, quantity: 1, idempotencyKey: `tap:${request.tagId}:${request.counter}`, requestId: request.id });
    await tx.update(tapRequests).set({ status: "confirmed", ledgerEntryId: booked.entryId }).where(eq(tapRequests.id, request.id));
    return { state: "confirmed" as const, balance: booked.balance, entryId: booked.entryId };
  });
}

/** A cashier declines a pending request (wrong card, customer left). It books nothing and cannot undo a confirmed award. */
export async function cancelTapRequest(input: { userId: string; locationId: string; requestId: string }) {
  return db.transaction(async tx => {
    const [request] = await tx.select().from(tapRequests).where(eq(tapRequests.id, input.requestId)).for("update");
    if (!request || request.locationId !== input.locationId) throw new DomainError("NOT_FOUND", "Pending tap not found");
    const [staff] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, request.tenantId), eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
    if (!staff || (staff.role !== "owner" && staff.locationId !== request.locationId)) throw new DomainError("FORBIDDEN", "Checkout access required");
    if (request.status === "cancelled") return { state: "cancelled" as const };
    if (request.status === "confirmed" || request.status === "awarded") throw new DomainError("TAP_ALREADY_CONFIRMED", "This tap was already confirmed");
    if (request.status !== "pending_staff") throw new DomainError("TAP_EXPIRED", "Pending tap expired");
    await tx.update(tapRequests).set({ status: "cancelled" }).where(eq(tapRequests.id, request.id));
    return { state: "cancelled" as const };
  });
}

/** Owner view of one programme's tags. Non-secret fields only: no key reference, no UID, no key material. */
export async function programTagStatus(input: { actorUserId: string; programId: string }) {
  const [program] = await db.select().from(programs).where(eq(programs.id, input.programId));
  if (!program) throw new DomainError("NOT_FOUND", "Programme not found");
  await db.transaction(async tx => owner(tx, input.actorUserId, program.tenantId));
  const tags = await db.select({ id: secureTags.id, status: secureTags.status, activatedAt: secureTags.activatedAt, revokedAt: secureTags.revokedAt, lastCounter: secureTags.lastCounter })
    .from(secureTags).where(and(eq(secureTags.tenantId, program.tenantId), eq(secureTags.programId, program.id))).orderBy(desc(secureTags.createdAt)).limit(20);
  return { mode: program.tapMode, cooldownSeconds: program.tapCooldownSeconds, tags: tags.map(tag => ({ id: tag.id, status: tag.status, activatedAt: tag.activatedAt, revokedAt: tag.revokedAt, everTapped: tag.lastCounter > 0 })) };
}
