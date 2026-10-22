import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { plateActivationCodes, plateActivationFailures, plateLinkEvents, programs, secureTags, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";
import { assertPlateOperator, normalizePlateLabel, shopOf } from "./plates";

/**
 * Activation codes for mailed plates (ENG-048). The operator issues one per unlinked plate and prints it on the card
 * in the plate's box; the signed-in owner enters plate name and code in the owner app, which links the plate to the
 * owner's current location and programme. Only a salted scrypt hash is stored. Every failure, whatever its cause
 * (no such plate, no code, wrong, used, locked, plate already linked), is one generic error. Wrong codes count per
 * account and plate, so nobody can lock someone else's plate by guessing its name.
 */
type Env = Record<string, string | undefined>;
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L: read off a printed card without doubt
const LENGTH = 12; // 31^12 ≈ 2^59
export const MAX_FAILED_ATTEMPTS = 5;
export const ACTIVATION_FAILED = "Plattenname oder Code stimmt nicht, oder die Platte ist nach zu vielen Versuchen gesperrt. Prüfe die Karte aus der Box; hilft das nicht, melde dich beim Loynara-Support.";
const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

/** Printed as XXXX-XXXX-XXXX; typed in any case, with or without spaces and dashes. */
export function normalizeCode(raw: string) {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}
async function hashCode(code: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(code, salt, 32)).toString("base64url")}`;
}
// Unknown plates are checked against this too, so every attempt costs the same.
const DUMMY = `scrypt$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(32).toString("base64url")}`;
async function codeMatches(code: string, stored: string) {
  const [, salt, hash] = stored.split("$");
  const actual = await derive(code, Buffer.from(salt, "base64url"), 32);
  return timingSafeEqual(actual, Buffer.from(hash, "base64url"));
}

/**
 * Issues (or replaces) the code of each unlinked plate in the batch. Returns the plaintext codes once, for printing;
 * they are not logged and cannot be shown again (issue a new one instead). A replaced code stops working at once.
 */
export async function issuePlateCodes(input: { actorUserId: string; env: Env; plateLabels: string[] }) {
  const labels = [...new Set(input.plateLabels.map(normalizePlateLabel))];
  if (labels.length < 1 || labels.length > 200) throw new DomainError("INVALID_INPUT", "Between 1 and 200 plates");
  await db.transaction(tx => assertPlateOperator(tx, input.actorUserId, input.env));
  // Hashing is slow on purpose, so it happens before the transaction that locks the plates.
  const issued = await Promise.all(labels.map(async plateLabel => {
    const code = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    return { plateLabel, code: code.match(/.{4}/g)!.join("-"), codeHash: await hashCode(code) };
  }));
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const tags = await tx.select({ id: secureTags.id, plateLabel: secureTags.plateLabel, status: secureTags.status }).from(secureTags).where(inArray(secureTags.plateLabel, labels)).for("update");
    for (const { plateLabel, codeHash } of issued) {
      const tag = tags.find(t => t.plateLabel === plateLabel);
      if (!tag) throw new DomainError("NOT_FOUND", `Plate ${plateLabel} not found`);
      if (tag.status !== "unlinked") throw new DomainError("PLATE_LINKED", `Plate ${plateLabel} is not free`);
      const row = { codeHash, usedAt: null, issuedByUserId: input.actorUserId, issuedAt: new Date() };
      await tx.insert(plateActivationCodes).values({ tagId: tag.id, ...row }).onConflictDoUpdate({ target: plateActivationCodes.tagId, set: row });
      // Wrong tries were against the old code.
      await tx.delete(plateActivationFailures).where(eq(plateActivationFailures.tagId, tag.id));
    }
    return issued.map(({ plateLabel, code }) => ({ plateLabel, code }));
  });
}

/** Releases every account locked out of this plate after too many wrong codes. The code stays the same. */
export async function unlockPlateCode(input: { actorUserId: string; env: Env; plateLabel: string }) {
  const plateLabel = normalizePlateLabel(input.plateLabel);
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const [tag] = await tx.select({ id: secureTags.id }).from(secureTags).where(eq(secureTags.plateLabel, plateLabel));
    const [entry] = tag ? await tx.select({ tagId: plateActivationCodes.tagId }).from(plateActivationCodes).where(eq(plateActivationCodes.tagId, tag.id)) : [];
    if (!entry) throw new DomainError("NOT_FOUND", "No code for this plate");
    await tx.delete(plateActivationFailures).where(eq(plateActivationFailures.tagId, entry.tagId));
    return { plateLabel, result: "unlocked" as const };
  });
}

/**
 * The owner's activation: links an unlinked plate to the owner's programme, which must have „Mit Bestätigung“ on
 * (the same rule as the operator's link). One transaction; a wrong code is counted even though the call fails.
 */
export async function activatePlate(input: { userId: string; programId: string; plateLabel: string; code: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.programId)) throw new DomainError("NOT_FOUND", "Programme not found");
  let plateLabel: string | null;
  try { plateLabel = normalizePlateLabel(input.plateLabel); } catch { plateLabel = null; }
  const code = normalizeCode(input.code);
  const outcome = await db.transaction(async tx => {
    // Programme before tag, the order every tap and confirmation takes.
    await tx.select({ id: programs.id }).from(programs).where(eq(programs.id, input.programId)).for("share");
    const target = await shopOf(tx, input.programId);
    if (!target) throw new DomainError("NOT_FOUND", "Programme not found");
    const [owner] = await tx.select({ userId: staffRoles.userId }).from(staffRoles)
      .where(and(eq(staffRoles.userId, input.userId), eq(staffRoles.tenantId, target.tenantId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
    if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
    if (target.status !== "active" || target.tapMode !== "staff_confirmed" || !target.cooldownSeconds) throw new DomainError("STAFF_CONFIRMATION_REQUIRED", "Schalte zuerst NFC „Mit Bestätigung“ ein.");
    const [tag] = plateLabel ? await tx.select().from(secureTags).where(eq(secureTags.plateLabel, plateLabel)).for("update") : [];
    const [entry] = tag ? await tx.select().from(plateActivationCodes).where(eq(plateActivationCodes.tagId, tag.id)).for("update") : [];
    const [strikes] = tag ? await tx.select().from(plateActivationFailures).where(and(eq(plateActivationFailures.tagId, tag.id), eq(plateActivationFailures.userId, input.userId))).for("update") : [];
    const matches = await codeMatches(code, entry?.codeHash ?? DUMMY);
    if (!tag || !entry || entry.usedAt || strikes?.lockedAt || tag.status !== "unlinked") return "failed" as const;
    if (!matches) {
      const row = { failedAttempts: (strikes?.failedAttempts ?? 0) + 1, lockedAt: (strikes?.failedAttempts ?? 0) + 1 >= MAX_FAILED_ATTEMPTS ? new Date() : null };
      await tx.insert(plateActivationFailures).values({ tagId: tag.id, userId: input.userId, ...row }).onConflictDoUpdate({ target: [plateActivationFailures.tagId, plateActivationFailures.userId], set: row });
      return "failed" as const;
    }
    await tx.update(secureTags).set({ tenantId: target.tenantId, locationId: target.locationId, programId: target.programId, status: "active", activatedAt: new Date() }).where(eq(secureTags.id, tag.id));
    await tx.update(plateActivationCodes).set({ usedAt: new Date() }).where(eq(plateActivationCodes.tagId, tag.id));
    await tx.insert(plateLinkEvents).values({ tagId: tag.id, plateLabel: tag.plateLabel!, action: "link", actorUserId: input.userId, newTenantId: target.tenantId, newLocationId: target.locationId, newProgramId: target.programId });
    return { plateLabel: tag.plateLabel!, location: target.location, programme: target.programme };
  });
  if (outcome === "failed") throw new DomainError("INVALID_ACTIVATION", ACTIVATION_FAILED);
  return { result: "link" as const, ...outcome };
}
