import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { locations, plateLinkEvents, programs, secureTags, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";

/**
 * Plates: NFC tags provisioned without a shop and linked to one later, on the server, by the operator only.
 * There is no web route for any write here: the operator runs scripts/operator-plate.ts in the private Railway console,
 * and the actor must be on PLATE_OPERATOR_USER_IDS. Moving a plate moves no history: awards, requests and cards keep
 * the tenant they were made under.
 */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Env = Record<string, string | undefined>;

export function normalizePlateLabel(raw: string | undefined): string {
  const label = (raw ?? "").trim().toUpperCase();
  if (!/^[A-Z]{1,4}-[0-9]{1,6}$/.test(label)) throw new DomainError("INVALID_PLATE", "Plate label must look like P-007");
  return label;
}

/** The allowlist is read on the server per call; absent means nobody may link. */
export async function assertPlateOperator(tx: Pick<Transaction, "execute">, actorUserId: string, env: Env) {
  const allowed = (env.PLATE_OPERATOR_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
  if (!allowed.includes(actorUserId)) throw new DomainError("FORBIDDEN", "Plate operator access required");
  const found = await tx.execute(sql`SELECT id FROM "user" WHERE id = ${actorUserId}`);
  if (found.rows.length !== 1) throw new DomainError("FORBIDDEN", "Plate operator access required");
}

async function shopOf(tx: Transaction, programId: string | null) {
  if (!programId) return null;
  const [row] = await tx.select({ tenantId: programs.tenantId, locationId: programs.locationId, programId: programs.id, merchant: tenants.name, location: locations.name, programme: programs.name, status: programs.status, tapMode: programs.tapMode, cooldownSeconds: programs.tapCooldownSeconds })
    .from(programs).innerJoin(tenants, eq(tenants.id, programs.tenantId))
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .where(eq(programs.id, programId));
  return row ?? null;
}
const describe = (shop: Awaited<ReturnType<typeof shopOf>>) => shop && { tenantId: shop.tenantId, locationId: shop.locationId, programId: shop.programId, merchant: shop.merchant, location: shop.location, programme: shop.programme };

/** Records a plate chip that was just provisioned without a shop. Taps on it award nothing until it is linked. */
export async function registerUnlinkedPlate(input: { actorUserId: string; env: Env; plateLabel: string; uid: string; keyRef: string; configVersion: number; publicRef: string; initialCounter: number }) {
  const plateLabel = normalizePlateLabel(input.plateLabel);
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const now = new Date();
    const [tag] = await tx.insert(secureTags).values({ publicRef: input.publicRef, plateLabel, uid: input.uid, keyRef: input.keyRef, configVersion: input.configVersion, status: "unlinked", lastCounter: input.initialCounter, provisionedAt: now, activatedAt: now }).returning({ id: secureTags.id });
    return tag;
  });
}

export async function plateStatus(input: { actorUserId: string; env: Env; plateLabel: string }) {
  const plateLabel = normalizePlateLabel(input.plateLabel);
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const [tag] = await tx.select().from(secureTags).where(eq(secureTags.plateLabel, plateLabel));
    if (!tag) throw new DomainError("NOT_FOUND", "Plate not found");
    return { plateLabel, status: tag.status, everTapped: tag.lastCounter > 0, shop: describe(await shopOf(tx, tag.programId)) };
  });
}

/**
 * Links an unlinked plate, or relinks a linked one, to a programme that has staff confirmation („Mit Bestätigung“) on,
 * the same rule as provisioning. Dry run unless `execute`. Unlink when `programId` is null.
 */
export async function setPlateLink(input: { actorUserId: string; env: Env; plateLabel: string; programId: string | null; execute: boolean }) {
  const plateLabel = normalizePlateLabel(input.plateLabel);
  if (input.programId !== null && !/^[0-9a-f-]{36}$/i.test(input.programId)) throw new DomainError("NOT_FOUND", "Programme not found");
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    // Programme before tag, the order every tap and confirmation takes.
    if (input.programId) await tx.select({ id: programs.id }).from(programs).where(eq(programs.id, input.programId)).for("share");
    const target = await shopOf(tx, input.programId);
    if (input.programId && !target) throw new DomainError("NOT_FOUND", "Programme not found");
    if (target && (target.status !== "active" || target.tapMode !== "staff_confirmed" || !target.cooldownSeconds)) throw new DomainError("STAFF_CONFIRMATION_REQUIRED", "The shop must switch on NFC „Mit Bestätigung“ first");
    const [tag] = await tx.select().from(secureTags).where(eq(secureTags.plateLabel, plateLabel)).for("update");
    if (!tag) throw new DomainError("NOT_FOUND", "Plate not found");
    if (tag.status !== "unlinked" && tag.status !== "active") throw new DomainError("PLATE_RETIRED", "This plate was revoked or replaced");
    const current = await shopOf(tx, tag.programId);
    if ((current?.programId ?? null) === input.programId) return { result: "unchanged" as const, plateLabel, from: describe(current), to: describe(target) };
    const action = !current ? "link" as const : target ? "relink" as const : "unlink" as const;
    if (!input.execute) return { result: `would_${action}` as const, plateLabel, from: describe(current), to: describe(target) };
    await tx.update(secureTags).set(target
      ? { tenantId: target.tenantId, locationId: target.locationId, programId: target.programId, status: "active", activatedAt: new Date() }
      : { tenantId: null, locationId: null, programId: null, status: "unlinked" }).where(eq(secureTags.id, tag.id));
    await tx.insert(plateLinkEvents).values({ tagId: tag.id, plateLabel, action, actorUserId: input.actorUserId,
      oldTenantId: current?.tenantId, oldLocationId: current?.locationId, oldProgramId: current?.programId,
      newTenantId: target?.tenantId, newLocationId: target?.locationId, newProgramId: target?.programId });
    return { result: action, plateLabel, from: describe(current), to: describe(target) };
  });
}

/**
 * Retires an unlinked plate for good (lost, broken, or never to be used): taps keep verifying the chip and book nothing,
 * and no link can bring it back. A linked plate is unlinked first. Dry run unless `execute`.
 */
export async function revokeUnlinkedPlate(input: { actorUserId: string; env: Env; plateLabel: string; execute: boolean }) {
  const plateLabel = normalizePlateLabel(input.plateLabel);
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const [tag] = await tx.select().from(secureTags).where(eq(secureTags.plateLabel, plateLabel)).for("update");
    if (!tag) throw new DomainError("NOT_FOUND", "Plate not found");
    if (tag.status === "revoked" && !tag.programId) return { result: "unchanged" as const, plateLabel };
    if (tag.status === "active") throw new DomainError("PLATE_LINKED", "Unlink the plate first");
    if (tag.status !== "unlinked") throw new DomainError("PLATE_RETIRED", "This plate was revoked or replaced");
    if (!input.execute) return { result: "would_revoke" as const, plateLabel };
    await tx.update(secureTags).set({ status: "revoked", revokedAt: new Date() }).where(eq(secureTags.id, tag.id));
    await tx.insert(plateLinkEvents).values({ tagId: tag.id, plateLabel, action: "revoke", actorUserId: input.actorUserId });
    return { result: "revoke" as const, plateLabel };
  });
}

/**
 * Unlinks every plate still linked to a programme that is ending, with one audit row each (the caller names the actor,
 * the system actor for the end-date job). Runs inside the caller's transaction, which already holds the programme lock.
 */
export async function unlinkProgrammePlates(tx: Transaction, programId: string, actorUserId: string) {
  const tags = await tx.select().from(secureTags).where(and(eq(secureTags.programId, programId), eq(secureTags.status, "active"), isNotNull(secureTags.plateLabel))).for("update");
  for (const tag of tags) {
    await tx.update(secureTags).set({ tenantId: null, locationId: null, programId: null, status: "unlinked" }).where(eq(secureTags.id, tag.id));
    await tx.insert(plateLinkEvents).values({ tagId: tag.id, plateLabel: tag.plateLabel!, action: "unlink", actorUserId,
      oldTenantId: tag.tenantId, oldLocationId: tag.locationId, oldProgramId: programId });
  }
  return tags.length;
}

/** Where the plate's QR sticker leads: the linked shop's public join page, or null while it is not linked. */
export async function plateJoinPath(rawLabel: string): Promise<string | null> {
  let label: string;
  try { label = normalizePlateLabel(rawLabel); } catch { return null; }
  const [row] = await db.select({ slug: programs.slug, status: programs.status }).from(secureTags)
    .innerJoin(programs, and(eq(programs.id, secureTags.programId), eq(programs.tenantId, secureTags.tenantId)))
    .where(and(eq(secureTags.plateLabel, label), eq(secureTags.status, "active")));
  return row?.status === "active" ? `/join/${encodeURIComponent(row.slug)}` : null;
}
