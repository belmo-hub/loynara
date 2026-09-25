import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ledgerEntries, memberships, offlineAwardEvents, offlineAwardLeases, programs, purchaseAwards, staffRoles } from "@/db/schema";
import { awardInTransaction, DomainError } from "./loyalty";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const LEASE_MINUTES = 30;
const MAX_EVENTS_PER_LEASE = 20;
const CLOCK_SKEW_MS = 30_000;
const awardSchema = z.union([
  z.object({ quantity: z.number().int().min(1).max(1000) }).strict(),
  z.object({ purchaseAmountMinor: z.number().int().min(1).max(1_000_000), ruleVersionId: z.uuid() }).strict(),
]);
export type OfflineAward = z.infer<typeof awardSchema>;
const prepareSchema = z.object({ userId: z.string().min(1), locationId: z.uuid(), membershipId: z.uuid(), deviceId: z.uuid(), now: z.date().optional() }).strict();
const eventSchema = z.object({ userId: z.string().min(1), leaseId: z.uuid(), deviceId: z.uuid(), eventId: z.uuid(), eventAt: z.date(), award: awardSchema, now: z.date().optional() }).strict();

function deviceHash(deviceId: string) { return createHash("sha256").update(deviceId).digest("hex"); }
function sameAward(a: OfflineAward, b: OfflineAward) {
  return "quantity" in a ? "quantity" in b && a.quantity === b.quantity : "purchaseAmountMinor" in b && a.purchaseAmountMinor === b.purchaseAmountMinor && a.ruleVersionId === b.ruleVersionId;
}

export async function prepareOfflineAward(raw: z.input<typeof prepareSchema>): Promise<{ leaseId: string; expiresAt: Date }> {
  const input = prepareSchema.parse(raw);
  const now = input.now ?? new Date((await db.execute<{ now: string }>(sql`select clock_timestamp() as now`)).rows[0].now);
  const [member] = await db.select().from(memberships).where(eq(memberships.id, input.membershipId));
  if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
  const [program] = await db.select().from(programs).where(and(eq(programs.id, member.programId), eq(programs.tenantId, member.tenantId)));
  if (!program || program.locationId !== input.locationId || program.status !== "active") throw new DomainError("NOT_FOUND", "Card not found at this location");
  const [staff] = await db.select().from(staffRoles).where(and(eq(staffRoles.tenantId, member.tenantId), eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
  if (!staff || (staff.role !== "owner" && staff.locationId !== input.locationId)) throw new DomainError("FORBIDDEN", "No checkout access");
  const hash = deviceHash(input.deviceId);
  const [existing] = await db.select().from(offlineAwardLeases).where(and(eq(offlineAwardLeases.actorUserId, input.userId), eq(offlineAwardLeases.membershipId, input.membershipId), eq(offlineAwardLeases.deviceHash, hash), sql`${offlineAwardLeases.expiresAt} > ${now}`)).limit(1);
  if (existing) return { leaseId: existing.id, expiresAt: existing.expiresAt };
  const expiresAt = new Date(now.getTime() + LEASE_MINUTES * 60_000);
  const [lease] = await db.insert(offlineAwardLeases).values({ tenantId: member.tenantId, locationId: input.locationId, membershipId: member.id, actorUserId: input.userId, deviceHash: hash, createdAt: now, expiresAt }).returning();
  return { leaseId: lease.id, expiresAt };
}

type SyncResult = { status: "accepted" | "rejected"; reason?: string; balance?: number; entryId?: string; duplicate?: boolean };

export async function syncOfflineAward(raw: z.input<typeof eventSchema>): Promise<SyncResult> {
  const input = eventSchema.parse(raw);
  return db.transaction(async tx => {
  // Event IDs are global, including across tenants. Serialize reuse before
  // either lease can post a ledger entry or an outcome row.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.eventId}::text, 0))`);
  const [lease] = await tx.select().from(offlineAwardLeases).where(eq(offlineAwardLeases.id, input.leaseId)).for("update");
  if (!lease || lease.actorUserId !== input.userId) return { status: "rejected", reason: "INVALID_LEASE" };
  if (lease.deviceHash !== deviceHash(input.deviceId)) return { status: "rejected", reason: "WRONG_DEVICE" };
  const now = input.now ?? new Date((await tx.execute<{ now: string }>(sql`select clock_timestamp() as now`)).rows[0].now);

  const [prior] = await tx.select().from(offlineAwardEvents).where(eq(offlineAwardEvents.id, input.eventId));
  if (prior) {
    if (prior.leaseId !== lease.id || prior.actorUserId !== input.userId || prior.eventAt.getTime() !== input.eventAt.getTime() || !sameAward(prior.awardPayload, input.award)) throw new DomainError("KEY_REUSED", "Offline event ID was used for another award");
    const [member] = await tx.select({ balance: memberships.balance }).from(memberships).where(eq(memberships.id, lease.membershipId));
    return { status: prior.status as SyncResult["status"], reason: prior.reason ?? undefined, entryId: prior.ledgerEntryId ?? undefined, balance: prior.status === "accepted" ? member?.balance : undefined, duplicate: true };
  }

  const idempotencyKey = `offline:${input.eventId}`;
  const [alreadyAwarded] = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, lease.tenantId), eq(ledgerEntries.idempotencyKey, idempotencyKey)));
  if (alreadyAwarded) {
    if (alreadyAwarded.kind !== "award" || alreadyAwarded.source !== "staff_offline" || alreadyAwarded.actorUserId !== input.userId || alreadyAwarded.membershipId !== lease.membershipId || alreadyAwarded.locationId !== lease.locationId || alreadyAwarded.deviceAt?.getTime() !== input.eventAt.getTime()) throw new DomainError("KEY_REUSED", "Offline event ID was used for another award");
    const [purchase] = await tx.select().from(purchaseAwards).where(eq(purchaseAwards.ledgerEntryId, alreadyAwarded.id));
    if ("quantity" in input.award ? Boolean(purchase) || alreadyAwarded.delta !== input.award.quantity : !purchase || purchase.amountMinor !== input.award.purchaseAmountMinor || purchase.ruleVersionId !== input.award.ruleVersionId) throw new DomainError("KEY_REUSED", "Offline event ID was used for another award");
    await saveEvent(tx, lease, input, "accepted", null, alreadyAwarded.id, now);
    const [member] = await tx.select({ balance: memberships.balance }).from(memberships).where(eq(memberships.id, lease.membershipId));
    return { status: "accepted", balance: member?.balance, entryId: alreadyAwarded.id, duplicate: true };
  }

  let reason: string | null = null;
  if (now > lease.expiresAt) reason = "LEASE_EXPIRED";
  else if (input.eventAt.getTime() < lease.createdAt.getTime() - CLOCK_SKEW_MS || input.eventAt > lease.expiresAt || input.eventAt.getTime() > now.getTime() + 120_000) reason = "EVENT_OUTSIDE_LEASE";
  const [staff] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, lease.tenantId), eq(staffRoles.userId, input.userId)));
  if (!reason && (!staff || !staff.active || (staff.role !== "owner" && staff.locationId !== lease.locationId))) reason = "STAFF_REVOKED";
  const [member] = await tx.select().from(memberships).where(and(eq(memberships.id, lease.membershipId), eq(memberships.tenantId, lease.tenantId)));
  if (!reason && (!member || member.closedAt)) reason = "CARD_CLOSED";
  const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(offlineAwardEvents).where(eq(offlineAwardEvents.leaseId, lease.id));
  if (!reason && count.total >= MAX_EVENTS_PER_LEASE) reason = "LEASE_LIMIT";
  if (reason) {
    await saveEvent(tx, lease, input, "rejected", reason, null, now);
    return { status: "rejected", reason };
  }

  try {
    // A validation error after ledger work must roll back that work while the
    // outer transaction can still record a reviewed rejection.
    const booked = await tx.transaction(inner => awardInTransaction(inner, { userId: input.userId, locationId: lease.locationId, membershipId: lease.membershipId, ...input.award, idempotencyKey, requestId: input.eventId, deviceAt: input.eventAt, source: "staff_offline" }));
    await saveEvent(tx, lease, input, "accepted", null, booked.entryId, now);
    return { status: "accepted", balance: booked.balance, entryId: booked.entryId, duplicate: booked.duplicate };
  } catch (error) {
    if (!(error instanceof DomainError) || error.code === "KEY_REUSED") throw error;
    await saveEvent(tx, lease, input, "rejected", error.code, null, now);
    return { status: "rejected", reason: error.code };
  }
  });
}

async function saveEvent(tx: Transaction, lease: typeof offlineAwardLeases.$inferSelect, input: z.output<typeof eventSchema>, status: "accepted" | "rejected", reason: string | null, ledgerEntryId: string | null, now: Date) {
  await tx.insert(offlineAwardEvents).values({ id: input.eventId, leaseId: lease.id, tenantId: lease.tenantId, locationId: lease.locationId, membershipId: lease.membershipId, actorUserId: input.userId, awardPayload: input.award, eventAt: input.eventAt, status, reason, ledgerEntryId, processedAt: now }).onConflictDoNothing({ target: offlineAwardEvents.id });
}
