import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, memberships, outboxJobs, programRuleVersions, programs, purchaseAwards, redemptions, rewardVersions, rewards, staffRoles, tenants } from "@/db/schema";
import { PointsError, purchasePoints } from "./points";

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export type AwardInput = {
  userId: string;
  locationId: string;
  membershipId: string;
  quantity?: number;
  purchaseAmountMinor?: number;
  ruleVersionId?: string;
  idempotencyKey: string;
  requestId: string;
  deviceAt?: Date;
  reason?: string;
  source?: "staff_online" | "synthetic_seed";
};

export async function award(input: AwardInput): Promise<{ balance: number; duplicate: boolean; entryId: string; creditedQuantity: number }> {
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 100) throw new DomainError("INVALID_KEY", "Invalid idempotency key");

  return db.transaction(async (tx) => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.id, input.membershipId)).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    const [program] = await tx.select().from(programs).where(and(eq(programs.id, member.programId), eq(programs.tenantId, member.tenantId)));
    if (!program || program.locationId !== input.locationId || program.status !== "active") throw new DomainError("NOT_FOUND", "Card not found at this location");
    const [staff] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, member.tenantId), eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
    if (!staff || (staff.role !== "owner" && staff.locationId !== input.locationId)) throw new DomainError("FORBIDDEN", "No checkout access");
    const purchaseMode = program.type === "points" && program.earningMode === "purchase";
    const [existing] = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, member.tenantId), eq(ledgerEntries.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (existing.membershipId !== member.id || existing.kind !== "award") throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      const [purchase] = await tx.select().from(purchaseAwards).where(eq(purchaseAwards.ledgerEntryId, existing.id));
      if (purchase) {
        if (purchase.amountMinor !== input.purchaseAmountMinor || purchase.ruleVersionId !== input.ruleVersionId || purchase.pointsAwarded !== existing.delta || input.quantity !== undefined) throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      } else if (purchase || existing.delta !== input.quantity || input.purchaseAmountMinor !== undefined || input.ruleVersionId !== undefined) throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      return { balance: member.balance, duplicate: true, entryId: existing.id, creditedQuantity: existing.delta };
    }

    let quantity: number;
    let ruleVersionId: string | undefined;
    if (purchaseMode) {
      if (input.quantity !== undefined || input.purchaseAmountMinor === undefined || !input.ruleVersionId) throw new DomainError("INVALID_EARNING_MODE", "A purchase amount and rule version are required");
      const [rule] = await tx.select().from(programRuleVersions).where(and(eq(programRuleVersions.tenantId, program.tenantId), eq(programRuleVersions.programId, program.id))).orderBy(desc(programRuleVersions.version)).limit(1);
      if (!rule || rule.id !== input.ruleVersionId) throw new DomainError("STALE_RULE", "Programme rule has changed; refresh and confirm again");
      ruleVersionId = rule.id;
      try { quantity = purchasePoints(input.purchaseAmountMinor, program.pointsPerCurrencyUnit); }
      catch (error) { if (error instanceof PointsError) throw new DomainError(error.code, error.code); throw error; }
    } else {
      if (input.purchaseAmountMinor !== undefined || input.ruleVersionId !== undefined) throw new DomainError("INVALID_EARNING_MODE", "This programme uses manual quantity");
      if (!Number.isInteger(input.quantity) || input.quantity === undefined || input.quantity < 1) throw new DomainError("INVALID_QUANTITY", "Quantity must be a positive integer");
      quantity = input.quantity;
    }
    const manualLimit = staff.role === "cashier" ? 10 : staff.role === "manager" ? 100 : 1000;
    const purchaseAmountLimit = staff.role === "cashier" ? 50_000 : staff.role === "manager" ? 200_000 : 1_000_000;
    const purchasePointsLimit = staff.role === "cashier" ? 500 : staff.role === "manager" ? 2_000 : 10_000;
    if (purchaseMode && (input.purchaseAmountMinor! > purchaseAmountLimit || quantity > purchasePointsLimit)) throw new DomainError("LIMIT_EXCEEDED", "Purchase exceeds this staff role's amount or points limit; ask an owner to review");
    if ((!purchaseMode && quantity > manualLimit) || member.balance + quantity > 2_147_483_647) throw new DomainError("LIMIT_EXCEEDED", "Award exceeds role or balance limit");

    const [entry] = await tx.insert(ledgerEntries).values({
      tenantId: member.tenantId,
      locationId: input.locationId,
      membershipId: member.id,
      delta: quantity,
      kind: "award",
      source: input.source ?? "staff_online",
      actorUserId: input.userId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      deviceAt: input.deviceAt,
      reason: input.reason,
    }).returning();
    if (purchaseMode && ruleVersionId) {
      const [tenant] = await tx.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, member.tenantId));
      if (!tenant || (tenant.currency !== "EUR" && tenant.currency !== "MAD")) throw new DomainError("INVALID_CURRENCY", "Unsupported currency for purchase points");
      await tx.insert(purchaseAwards).values({ ledgerEntryId: entry.id, tenantId: member.tenantId, ruleVersionId, amountMinor: input.purchaseAmountMinor!, currency: tenant.currency, appliedRate: program.pointsPerCurrencyUnit, pointsAwarded: quantity, rounding: "floor" });
    }
    const balance = member.balance + quantity;
    await tx.update(memberships).set({ balance }).where(eq(memberships.id, member.id));
    await tx.insert(outboxJobs).values({ tenantId: member.tenantId, kind: "wallet.refresh", payload: { membershipId: member.id } });
    return { balance, duplicate: false, entryId: entry.id, creditedQuantity: quantity };
  });
}

export type RedeemInput = {
  userId: string;
  locationId: string;
  membershipId: string;
  rewardVersionId: string;
  idempotencyKey: string;
  requestId: string;
  deviceAt?: Date;
};

export async function redeem(input: RedeemInput): Promise<{ balance: number; duplicate: boolean; entryId: string }> {
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 100) throw new DomainError("INVALID_KEY", "Invalid idempotency key");
  return db.transaction(async (tx) => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.id, input.membershipId)).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    const [program] = await tx.select().from(programs).where(and(eq(programs.id, member.programId), eq(programs.tenantId, member.tenantId)));
    if (!program || program.locationId !== input.locationId || program.status !== "active") throw new DomainError("NOT_FOUND", "Card not found at this location");
    const [staff] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, member.tenantId), eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
    if (!staff || (staff.role !== "owner" && staff.locationId !== input.locationId)) throw new DomainError("FORBIDDEN", "No checkout access");

    const [existing] = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, member.tenantId), eq(ledgerEntries.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      const [previous] = await tx.select().from(redemptions).where(eq(redemptions.ledgerEntryId, existing.id));
      if (existing.membershipId !== member.id || existing.kind !== "redeem" || previous?.rewardVersionId !== input.rewardVersionId) throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      return { balance: member.balance, duplicate: true, entryId: existing.id };
    }

    const [selected] = await tx.select({ version: rewardVersions, reward: rewards })
      .from(rewardVersions)
      .innerJoin(rewards, and(eq(rewards.id, rewardVersions.rewardId), eq(rewards.tenantId, rewardVersions.tenantId)))
      .where(and(eq(rewardVersions.id, input.rewardVersionId), eq(rewardVersions.tenantId, member.tenantId), sql`${rewardVersions.effectiveAt} <= now()`));
    if (!selected || !selected.reward.active || selected.reward.programId !== member.programId) throw new DomainError("INVALID_REWARD", "Reward is not available");
    const [currentVersion] = await tx.select({ id: rewardVersions.id }).from(rewardVersions)
      .where(and(eq(rewardVersions.rewardId, selected.reward.id), eq(rewardVersions.tenantId, member.tenantId)))
      .orderBy(desc(rewardVersions.version)).limit(1);
    if (currentVersion.id !== input.rewardVersionId) throw new DomainError("STALE_REWARD", "Reward has changed; refresh and confirm again");
    if (member.balance < selected.version.cost) throw new DomainError("INSUFFICIENT_BALANCE", "Not enough points or stamps");

    const [entry] = await tx.insert(ledgerEntries).values({
      tenantId: member.tenantId,
      locationId: input.locationId,
      membershipId: member.id,
      delta: -selected.version.cost,
      kind: "redeem",
      source: "staff_online",
      actorUserId: input.userId,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      deviceAt: input.deviceAt,
    }).returning();
    const balance = member.balance - selected.version.cost;
    await tx.update(memberships).set({ balance }).where(eq(memberships.id, member.id));
    await tx.insert(redemptions).values({ tenantId: member.tenantId, membershipId: member.id, ledgerEntryId: entry.id, rewardVersionId: selected.version.id, rewardTitle: selected.version.title, cost: selected.version.cost });
    await tx.insert(outboxJobs).values({ tenantId: member.tenantId, kind: "wallet.refresh", payload: { membershipId: member.id } });
    return { balance, duplicate: false, entryId: entry.id };
  });
}

export type ReversalInput = {
  userId: string;
  locationId: string;
  entryId: string;
  reason: string;
  idempotencyKey: string;
  requestId: string;
};

export async function reverseEntry(input: ReversalInput): Promise<{ balance: number; duplicate: boolean; entryId: string }> {
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 240) throw new DomainError("INVALID_REASON", "A correction reason is required");
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 100) throw new DomainError("INVALID_KEY", "Invalid idempotency key");
  return db.transaction(async (tx) => {
    const [original] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, input.entryId));
    if (!original || original.locationId !== input.locationId || original.kind === "reversal") throw new DomainError("NOT_FOUND", "Transaction not found at this location");
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.id, original.membershipId), eq(memberships.tenantId, original.tenantId))).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    const [staff] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, original.tenantId), eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
    if (!staff || staff.role === "cashier" || (staff.role === "manager" && staff.locationId !== input.locationId)) throw new DomainError("FORBIDDEN", "Manager or owner access required");
    if (staff.role === "manager" && Math.abs(original.delta) > 100) throw new DomainError("LIMIT_EXCEEDED", "Owner approval required for this correction");
    const [existing] = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, original.tenantId), eq(ledgerEntries.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (existing.kind !== "reversal" || existing.reversalOfId !== original.id) throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      return { balance: member.balance, duplicate: true, entryId: existing.id };
    }
    const [reversal] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, original.tenantId), eq(ledgerEntries.reversalOfId, original.id)));
    if (reversal) throw new DomainError("ALREADY_REVERSED", "Transaction was already corrected");
    const balance = member.balance - original.delta;
    if (balance < 0) throw new DomainError("INSUFFICIENT_BALANCE", "Correction would make the balance negative");
    const [entry] = await tx.insert(ledgerEntries).values({ tenantId: original.tenantId, locationId: original.locationId, membershipId: member.id, delta: -original.delta, kind: "reversal", source: "staff_correction", actorUserId: input.userId, requestId: input.requestId, idempotencyKey: input.idempotencyKey, reason, reversalOfId: original.id }).returning();
    await tx.update(memberships).set({ balance }).where(eq(memberships.id, member.id));
    await tx.insert(outboxJobs).values({ tenantId: original.tenantId, kind: "wallet.refresh", payload: { membershipId: member.id } });
    return { balance, duplicate: false, entryId: entry.id };
  });
}
