import { manualAwardLimit, type StaffRole } from "./award-limits";
import { and, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { automationRules, ledgerEntries, locations, memberships, outboxJobs, programRuleVersions, programs, purchaseAwards, redemptions, rewardVersions, rewards, staffRoles, tenants } from "@/db/schema";
import { activeHappyHour } from "./happy-hour";
import { PointsError, purchasePoints } from "./points";
import { qualifyReferralOnAward, reverseReferralForCheckout } from "./referrals";
import { enqueueWalletRefresh } from "./wallet/enqueue";
import { surfaceHidden } from "./pilot-surfaces";
import { birthdayWeek, WINBACK_WINDOW_DAYS } from "./wallet-message-rules";

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// Called only after the transaction has rolled back. Different cards have independent
// membership locks, but a racing tenant-wide key collision is a definitive rejection.
function rethrowLedgerKeyConflict(error: unknown): never {
  const databaseError = error instanceof Error && error.cause ? error.cause : error;
  if (databaseError && typeof databaseError === "object" && "code" in databaseError && databaseError.code === "23505"
    && "constraint" in databaseError && databaseError.constraint === "ledger_idempotency_uq") {
    throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
  }
  throw error;
}

// How long a booking waits for an owner's programme save before giving up. It holds the card meanwhile, so a slow save
// must not stall the counter; nothing is booked and the cashier can simply try again.
const PROGRAMME_LOCK_WAIT = "3s";

export async function lockProgrammeForBooking<T>(tx: Transaction, read: () => Promise<T>): Promise<T> {
  const [{ previous }] = (await tx.execute<{ previous: string }>(sql`SELECT current_setting('lock_timeout') AS previous`)).rows;
  await tx.execute(sql`SELECT set_config('lock_timeout', ${PROGRAMME_LOCK_WAIT}, true)`);
  let locked: T;
  try { locked = await read(); }
  catch (error) {
    const databaseError = error instanceof Error && error.cause ? error.cause : error;
    if (databaseError && typeof databaseError === "object" && "code" in databaseError && databaseError.code === "55P03") {
      throw new DomainError("PROGRAMME_BUSY", "The programme is being changed right now; nothing was booked, try again in a moment");
    }
    throw error;
  }
  await tx.execute(sql`SELECT set_config('lock_timeout', ${previous}, true)`);
  return locked;
}

// Every ledger idempotency-key namespace the server generates itself (staff tap confirmation and automatic tap, offline
// sync, referral bonuses and their reversals, the welcome bonus, the happy-hour extra and the win-back and birthday bonuses, each with its reversal). A client key in one of them could take
// a key first and block or replay a server booking. Add every new server-generated prefix here.
export const RESERVED_KEY_PREFIXES = ["tap:", "offline:", "referral:", "welcome:", "welcome-reversal:", "happyhour:", "happyhour-reversal:", "winback:", "winback-reversal:", "birthday:", "birthday-reversal:"] as const;
const validKeyLength = (key: string) => key.length >= 8 && key.length <= 100;

/** For keys that come from a client (the public award, redeem and reverse entry points). Internal callers never use it. */
function assertClientKey(key: string) {
  if (!validKeyLength(key) || RESERVED_KEY_PREFIXES.some(prefix => key.startsWith(prefix))) throw new DomainError("INVALID_KEY", "Invalid idempotency key");
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
  source?: "staff_online" | "staff_offline" | "synthetic_seed";
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function checkoutStaff(tx: Transaction, tenantId: string, userId: string) {
  // Ledger's actor FK also locks this identity. Acquire it before the staff
  // row to match onboarding/invitation ordering and avoid a lock cycle.
  await tx.execute(sql`SELECT id FROM "user" WHERE id = ${userId} FOR KEY SHARE`);
  // Revocation must wait for an authorized checkout to commit; if revocation
  // wins this lock, the active predicate is rechecked and checkout is denied.
  const [staff] = await tx.select().from(staffRoles)
    .where(and(eq(staffRoles.tenantId, tenantId), eq(staffRoles.userId, userId), eq(staffRoles.active, true))).for("share");
  return staff;
}

/** Client entry point (cashier route, scripts). Tap confirmation and offline sync call awardInTransaction with server keys. */
type AwardResult = { balance: number; duplicate: boolean; entryId: string; creditedQuantity: number; winbackBonus?: number; birthdayBonus?: number };

export async function award(input: AwardInput): Promise<AwardResult> {
  assertClientKey(input.idempotencyKey);
  return db.transaction(tx => awardInTransaction(tx, input)).catch(rethrowLedgerKeyConflict);
}

// Offline reconciliation holds its lease lock and books the ledger in the
// same database transaction. The ordinary online path uses this same logic.
export async function awardInTransaction(tx: Transaction, input: AwardInput): Promise<AwardResult> {
  return bookAwardInTransaction(tx, input, false);
}

// Only the authenticated SDM flow calls this after locking the provisioned tag.
// It reuses the same member lock, balance, ledger and outbox as cashier awards.
export async function awardTapInTransaction(tx: Transaction, input: { locationId: string; membershipId: string; tagId: string; counter: number }): Promise<AwardResult> {
  return bookAwardInTransaction(tx, { userId: `nfc:${input.tagId}`, locationId: input.locationId, membershipId: input.membershipId, quantity: 1, idempotencyKey: `tap:${input.tagId}:${input.counter}`, requestId: randomUUID() }, true);
}

async function bookAwardInTransaction(tx: Transaction, input: AwardInput, trustedTap: boolean): Promise<AwardResult> {
  if (!validKeyLength(input.idempotencyKey)) throw new DomainError("INVALID_KEY", "Invalid idempotency key");

    const [member] = await tx.select().from(memberships).where(eq(memberships.id, input.membershipId)).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    const programRow = () => tx.select().from(programs).where(and(eq(programs.id, member.programId), eq(programs.tenantId, member.tenantId)));
    const atThisLocation = (row: typeof programs.$inferSelect | undefined) => {
      if (!row || row.locationId !== input.locationId || row.status !== "active") throw new DomainError("NOT_FOUND", "Card not found at this location");
      return row;
    };
    // Authorization and replay come before the programme lock below: a booking that already went through is reported
    // as such even while an owner saves the programme, never as "nothing was booked", which would invite a second one.
    atThisLocation((await programRow())[0]);
    const staff = trustedTap ? undefined : await checkoutStaff(tx, member.tenantId, input.userId);
    if (!trustedTap && (!staff || (staff.role !== "owner" && staff.locationId !== input.locationId))) throw new DomainError("FORBIDDEN", "No checkout access");
    const [existing] = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, member.tenantId), eq(ledgerEntries.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (existing.membershipId !== member.id || existing.kind !== "award") throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      const [purchase] = await tx.select().from(purchaseAwards).where(eq(purchaseAwards.ledgerEntryId, existing.id));
      if (purchase) {
        if (purchase.amountMinor !== input.purchaseAmountMinor || purchase.ruleVersionId !== input.ruleVersionId || purchase.pointsAwarded !== existing.delta || input.quantity !== undefined) throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      } else if (purchase || existing.delta !== input.quantity || input.purchaseAmountMinor !== undefined || input.ruleVersionId !== undefined) throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      return { balance: member.balance, duplicate: true, entryId: existing.id, creditedQuantity: existing.delta };
    }
    // A new booking: shared and held until commit, so an owner's programme save (FOR UPDATE) and a booking wait for each
    // other and the save's "no activity yet" check before a type change cannot miss a first award committing at the
    // same moment. Read again under the lock. Automatic tap awards keep the plain read: they hold their tag first, and
    // never run in production.
    const program = atThisLocation((trustedTap ? await programRow() : await lockProgrammeForBooking(tx, () => programRow().for("share")))[0]);
    if (trustedTap && (program.type !== "stamp" || program.earningMode !== "manual" || input.quantity !== 1)) throw new DomainError("INVALID_EARNING_MODE", "Tap supports one fixed stamp only");
    const purchaseMode = program.type === "points" && program.earningMode === "purchase";

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
    const manualLimit = trustedTap ? 1 : manualAwardLimit(staff?.role as StaffRole | undefined);
    const purchaseAmountLimit = staff?.role === "cashier" ? 50_000 : staff?.role === "manager" ? 200_000 : 1_000_000;
    const purchasePointsLimit = staff?.role === "cashier" ? 500 : staff?.role === "manager" ? 2_000 : 10_000;
    if (purchaseMode && (input.purchaseAmountMinor! > purchaseAmountLimit || quantity > purchasePointsLimit)) throw new DomainError("LIMIT_EXCEEDED", "Purchase exceeds this staff role's amount or points limit; ask an owner to review");
    if ((!purchaseMode && quantity > manualLimit) || member.balance + quantity * (program.happyHourEnabled ? 2 : 1) + program.welcomeBonus + (program.winbackEnabled ? program.winbackBonus : 0) + (program.birthdayEnabled ? program.birthdayBonus : 0) > 2_147_483_647) throw new DomainError("LIMIT_EXCEEDED", "Award exceeds role or balance limit");

    const [entry] = await tx.insert(ledgerEntries).values({
      tenantId: member.tenantId,
      locationId: input.locationId,
      membershipId: member.id,
      delta: quantity,
      kind: "award",
      source: trustedTap ? "nfc_tap" : input.source ?? "staff_online",
      actorUserId: trustedTap ? null : input.userId,
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
    const staffConfirmed = entry.source === "staff_online" || entry.source === "staff_offline";
    const welcomeBonus = staffConfirmed ? await bookWelcomeBonus(tx, { program, entry }) : 0;
    // Only online awards: a staff_offline award has no purchase time the server can trust (created_at is the sync time, deviceAt is the till's clock).
    const happyHour = entry.source === "staff_online" && purchaseMode ? await bookHappyHour(tx, { program, entry }) : 0;
    // Win-back and birthday depend on the visit day too, so they follow the same rule.
    const winbackBonus = entry.source === "staff_online" ? await bookWinbackBonus(tx, { program, entry }) : 0;
    const birthdayBonus = entry.source === "staff_online" ? await bookBirthdayBonus(tx, { program, entry }) : 0;
    const balance = member.balance + quantity + welcomeBonus + happyHour + winbackBonus + birthdayBonus;
    await tx.update(memberships).set({ balance }).where(eq(memberships.id, member.id));
    await enqueueWalletRefresh(tx, member.tenantId, member.id);
    const referral = staffConfirmed ? await qualifyReferralOnAward(tx, {
      tenantId: member.tenantId, programId: program.id, locationId: input.locationId,
      referredMembershipId: member.id, awardEntryId: entry.id, actorUserId: input.userId,
    }) : { referredBonus: 0 };
    if (staffConfirmed) {
      const [rule] = await tx.select({ id: automationRules.id, revision: automationRules.revision }).from(automationRules)
        .where(and(eq(automationRules.tenantId, member.tenantId), eq(automationRules.programId, program.id), eq(automationRules.triggerKind, "first_checkout"), eq(automationRules.enabled, true))).limit(1);
      if (rule) await tx.insert(outboxJobs).values({ tenantId: member.tenantId, kind: "automation.event", payload: { ruleId: rule.id, ruleRevision: String(rule.revision), membershipId: member.id, ledgerEntryId: entry.id } });
    }
    return { balance: balance + referral.referredBonus, duplicate: false, entryId: entry.id, creditedQuantity: quantity, winbackBonus, birthdayBonus };
}

// The welcome bonus ("Startbonus") is its own ledger row next to the card's first staff-confirmed award, keyed by that
// award's id: the key makes it once per award and lets a correction of the award find and reverse it. Referral, retention
// and analytics count only staff sources, so the bonus never counts as a purchase or visit.
const welcomeBonusKey = (awardEntryId: string) => `welcome:${awardEntryId}`;

async function bookWelcomeBonus(tx: Transaction, input: { program: typeof programs.$inferSelect; entry: typeof ledgerEntries.$inferSelect }): Promise<number> {
  const { program, entry } = input;
  if (program.welcomeBonus <= 0) return 0;
  // The membership row is locked by the caller, so this "first award" check cannot race another booking for this card.
  const [earlier] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(
    eq(ledgerEntries.tenantId, entry.tenantId), eq(ledgerEntries.membershipId, entry.membershipId), ne(ledgerEntries.id, entry.id),
    inArray(ledgerEntries.source, ["staff_online", "staff_offline", "welcome_bonus"]))).limit(1);
  if (earlier) return 0;
  await tx.insert(ledgerEntries).values({
    tenantId: entry.tenantId, locationId: entry.locationId, membershipId: entry.membershipId, delta: program.welcomeBonus, kind: "award",
    source: "welcome_bonus", actorUserId: entry.actorUserId, requestId: entry.requestId, idempotencyKey: welcomeBonusKey(entry.id), reason: "Startbonus",
  });
  return program.welcomeBonus;
}

// Happy hour: while a window of the programme is running (in its location's timezone), a confirmed purchase award books the
// same points again as its own row, keyed by the award's id like the welcome bonus. Not a visit, not a purchase.
const happyHourKey = (awardEntryId: string) => `happyhour:${awardEntryId}`;

async function bookHappyHour(tx: Transaction, input: { program: typeof programs.$inferSelect; entry: typeof ledgerEntries.$inferSelect }): Promise<number> {
  const { program, entry } = input;
  if (!program.happyHourEnabled) return 0;
  const [location] = await tx.select({ timezone: locations.timezone }).from(locations).where(and(eq(locations.id, program.locationId), eq(locations.tenantId, program.tenantId)));
  if (!location || !activeHappyHour(program.happyHourWindows, entry.createdAt, location.timezone)) return 0;
  await tx.insert(ledgerEntries).values({
    tenantId: entry.tenantId, locationId: entry.locationId, membershipId: entry.membershipId, delta: entry.delta, kind: "award",
    source: "happy_hour", actorUserId: entry.actorUserId, requestId: entry.requestId, idempotencyKey: happyHourKey(entry.id), reason: "Happy Hour",
  });
  return entry.delta;
}

// Win-back (ENG-044): a card that comes back between day N and day N + 14 (calendar days in the location's timezone) after
// its last confirmed stamp gets the programme's bonus as its own row next to the confirmed award, keyed by that award's id
// like the welcome bonus. Independent of message consent (Art. 7 (4) DSGVO); not a visit. After the award the card's last
// stamp is today, so the next award is outside the window: one bonus per lapse. Withheld with the walletMessages surface.
const winbackKey = (awardEntryId: string) => `winback:${awardEntryId}`;

/** A card's last confirmed stamp (alias `m` = memberships): a staff-confirmed award that was not corrected. Bonus rows never count. */
export const lastConfirmedStamp = (before: Date | SQL = sql`'infinity'::timestamptz`, except: string | null = null) => sql`(SELECT max(e.created_at) FROM ledger_entries e
  WHERE e.tenant_id = m.tenant_id AND e.membership_id = m.id AND e.kind = 'award' AND e.source IN ('staff_online','staff_offline') AND e.created_at <= ${before}
    AND (${except}::uuid IS NULL OR e.id <> ${except}::uuid) AND NOT EXISTS (SELECT 1 FROM ledger_entries u WHERE u.tenant_id = e.tenant_id AND u.reversal_of_id = e.id))`;

/** Whether a card is in its win-back window at `at`, and the window's last day (YYYY-MM-DD). Null when off or no stamp yet. */
export async function winbackState(tx: Pick<typeof db, "execute">, membershipId: string, at: Date, exceptEntryId: string | null = null) {
  if (surfaceHidden("walletMessages")) return null;
  const [row] = (await tx.execute<{ bonus: number; days: number; lapsed: number; deadline: string }>(sql`
    SELECT p.winback_bonus AS bonus, p.winback_days AS days,
      (${at}::timestamptz AT TIME ZONE l.timezone)::date - (s.last AT TIME ZONE l.timezone)::date AS lapsed,
      ((s.last AT TIME ZONE l.timezone)::date + p.winback_days + ${WINBACK_WINDOW_DAYS}::int)::text AS deadline
    FROM memberships m JOIN programs p ON p.id = m.program_id AND p.tenant_id = m.tenant_id
      JOIN locations l ON l.id = p.location_id AND l.tenant_id = p.tenant_id
      CROSS JOIN LATERAL (SELECT ${lastConfirmedStamp(at, exceptEntryId)} AS last) s
    WHERE m.id = ${membershipId}::uuid AND p.winback_enabled AND s.last IS NOT NULL`)).rows;
  if (!row || row.lapsed < row.days || row.lapsed > row.days + WINBACK_WINDOW_DAYS) return null;
  return { bonus: row.bonus, deadline: row.deadline };
}

async function bookWinbackBonus(tx: Transaction, input: { program: typeof programs.$inferSelect; entry: typeof ledgerEntries.$inferSelect }): Promise<number> {
  const { program, entry } = input;
  if (!program.winbackEnabled || program.winbackBonus <= 0) return 0;
  // The membership row is locked by the caller, so no other booking for this card can race this check.
  if (!(await winbackState(tx, entry.membershipId, entry.createdAt, entry.id))) return 0;
  await tx.insert(ledgerEntries).values({
    tenantId: entry.tenantId, locationId: entry.locationId, membershipId: entry.membershipId, delta: program.winbackBonus, kind: "award",
    source: "winback_bonus", actorUserId: entry.actorUserId, requestId: entry.requestId, idempotencyKey: winbackKey(entry.id), reason: "Willkommen-zurück-Bonus",
  });
  return program.winbackBonus;
}

// Birthday (ENG-049): a card with a stored birthday gets the programme's bonus with a confirmed award in its birthday week
// (Monday to Sunday in the location's timezone), at most once in BIRTHDAY_REPEAT_DAYS, so moving the birthday does not
// earn a second one. Same row pattern as the win-back bonus; independent of message consent. Withheld with walletMessages.
const birthdayKey = (awardEntryId: string) => `birthday:${awardEntryId}`;
const BIRTHDAY_REPEAT_DAYS = 300;

/** Whether a card is in its birthday week at `at` and has not had the bonus this year; the week's Sunday (YYYY-MM-DD). */
export async function birthdayState(tx: Pick<typeof db, "execute">, membershipId: string, at: Date) {
  if (surfaceHidden("walletMessages")) return null;
  const [row] = (await tx.execute<{ bonus: number; day: number; month: number; today: string; had: boolean }>(sql`
    SELECT p.birthday_bonus AS bonus, b.day, b.month, (${at}::timestamptz AT TIME ZONE l.timezone)::date::text AS today,
      EXISTS (SELECT 1 FROM ledger_entries e WHERE e.tenant_id = m.tenant_id AND e.membership_id = m.id AND e.source = 'birthday_bonus' AND e.kind = 'award'
        AND e.created_at > ${at}::timestamptz - make_interval(days => ${BIRTHDAY_REPEAT_DAYS}) AND NOT EXISTS (SELECT 1 FROM ledger_entries u WHERE u.tenant_id = e.tenant_id AND u.reversal_of_id = e.id)) AS had
    FROM memberships m JOIN programs p ON p.id = m.program_id AND p.tenant_id = m.tenant_id
      JOIN locations l ON l.id = p.location_id AND l.tenant_id = p.tenant_id
      JOIN card_birthdays b ON b.membership_id = m.id AND b.tenant_id = m.tenant_id
    WHERE m.id = ${membershipId}::uuid AND p.birthday_enabled`)).rows;
  const week = row && !row.had ? birthdayWeek(row.day, row.month, row.today) : null;
  return week ? { bonus: row.bonus, end: week.end } : null;
}

async function bookBirthdayBonus(tx: Transaction, input: { program: typeof programs.$inferSelect; entry: typeof ledgerEntries.$inferSelect }): Promise<number> {
  const { program, entry } = input;
  if (!program.birthdayEnabled || program.birthdayBonus <= 0) return 0;
  // The membership row is locked by the caller, so no other booking for this card can race the once-a-year check.
  if (!(await birthdayState(tx, entry.membershipId, entry.createdAt))) return 0;
  await tx.insert(ledgerEntries).values({
    tenantId: entry.tenantId, locationId: entry.locationId, membershipId: entry.membershipId, delta: program.birthdayBonus, kind: "award",
    source: "birthday_bonus", actorUserId: entry.actorUserId, requestId: entry.requestId, idempotencyKey: birthdayKey(entry.id), reason: "Geburtstags-Bonus",
  });
  return program.birthdayBonus;
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
  assertClientKey(input.idempotencyKey);
  return db.transaction(async (tx) => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.id, input.membershipId)).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    const [program] = await tx.select().from(programs).where(and(eq(programs.id, member.programId), eq(programs.tenantId, member.tenantId)));
    if (!program || program.locationId !== input.locationId || program.status !== "active") throw new DomainError("NOT_FOUND", "Card not found at this location");
    const staff = await checkoutStaff(tx, member.tenantId, input.userId);
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
      // Keep this catalogue entry stable through booking; owner edit/archive takes an exclusive reward lock.
      .where(and(eq(rewardVersions.id, input.rewardVersionId), eq(rewardVersions.tenantId, member.tenantId), sql`${rewardVersions.effectiveAt} <= now()`)).for("share", { of: rewards });
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
    await enqueueWalletRefresh(tx, member.tenantId, member.id);
    return { balance, duplicate: false, entryId: entry.id };
  }).catch(rethrowLedgerKeyConflict);
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
  assertClientKey(input.idempotencyKey);
  return db.transaction(async (tx) => {
    const [original] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, input.entryId));
    if (!original || original.locationId !== input.locationId || original.kind === "reversal") throw new DomainError("NOT_FOUND", "Transaction not found at this location");
    if (original.source === "referral_bonus") throw new DomainError("REFERRAL_REVIEW_REQUIRED", "Referral bonuses are corrected through referral review");
    if (original.source === "happy_hour") throw new DomainError("HAPPY_HOUR_WITH_AWARD", "The happy-hour points are corrected together with their award");
    if (original.source === "welcome_bonus") throw new DomainError("WELCOME_BONUS_WITH_AWARD", "The welcome bonus is corrected together with the card's first award");
    if (original.source === "birthday_bonus") throw new DomainError("BIRTHDAY_BONUS_WITH_AWARD", "The birthday bonus is corrected together with its award");
    if (original.source === "winback_bonus") throw new DomainError("WINBACK_BONUS_WITH_AWARD", "The win-back bonus is corrected together with its award");
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.id, original.membershipId), eq(memberships.tenantId, original.tenantId))).for("update");
    if (!member || member.closedAt) throw new DomainError("NOT_FOUND", "Card not found");
    // An ended programme books nothing more, corrections included (the end job never touches memberships, so a plain read is safe).
    const [ended] = member ? await tx.select({ id: programs.id }).from(programs).where(and(eq(programs.id, member.programId), eq(programs.status, "ended"))) : [];
    if (ended) throw new DomainError("NOT_FOUND", "Card not found at this location");
    const staff = await checkoutStaff(tx, original.tenantId, input.userId);
    if (!staff || staff.role === "cashier" || (staff.role === "manager" && staff.locationId !== input.locationId)) throw new DomainError("FORBIDDEN", "Manager or owner access required");
    if (staff.role === "manager" && Math.abs(original.delta) > 100) throw new DomainError("LIMIT_EXCEEDED", "Owner approval required for this correction");
    const [existing] = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, original.tenantId), eq(ledgerEntries.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (existing.kind !== "reversal" || existing.reversalOfId !== original.id) throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      return { balance: member.balance, duplicate: true, entryId: existing.id };
    }
    const [reversal] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, original.tenantId), eq(ledgerEntries.reversalOfId, original.id)));
    if (reversal) throw new DomainError("ALREADY_REVERSED", "Transaction was already corrected");
    // Correcting the card's first award takes its welcome bonus back in the same transaction.
    const [bonus] = original.kind === "award" ? await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, original.tenantId), eq(ledgerEntries.idempotencyKey, welcomeBonusKey(original.id)), eq(ledgerEntries.source, "welcome_bonus"))) : [];
    const [extra] = original.kind === "award" ? await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, original.tenantId), eq(ledgerEntries.idempotencyKey, happyHourKey(original.id)), eq(ledgerEntries.source, "happy_hour"))) : [];
    const [winback] = original.kind === "award" ? await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, original.tenantId), eq(ledgerEntries.idempotencyKey, winbackKey(original.id)), eq(ledgerEntries.source, "winback_bonus"))) : [];
    const [birthday] = original.kind === "award" ? await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, original.tenantId), eq(ledgerEntries.idempotencyKey, birthdayKey(original.id)), eq(ledgerEntries.source, "birthday_bonus"))) : [];
    const balance = member.balance - original.delta - (bonus?.delta ?? 0) - (extra?.delta ?? 0) - (winback?.delta ?? 0) - (birthday?.delta ?? 0);
    if (balance < 0) throw new DomainError("INSUFFICIENT_BALANCE", "Correction would make the balance negative");
    const [entry] = await tx.insert(ledgerEntries).values({ tenantId: original.tenantId, locationId: original.locationId, membershipId: member.id, delta: -original.delta, kind: "reversal", source: "staff_correction", actorUserId: input.userId, requestId: input.requestId, idempotencyKey: input.idempotencyKey, reason, reversalOfId: original.id }).returning();
    if (bonus) await tx.insert(ledgerEntries).values({ tenantId: bonus.tenantId, locationId: bonus.locationId, membershipId: member.id, delta: -bonus.delta, kind: "reversal", source: "staff_correction", actorUserId: input.userId, requestId: input.requestId, idempotencyKey: `welcome-reversal:${original.id}`, reason, reversalOfId: bonus.id });
    if (extra) await tx.insert(ledgerEntries).values({ tenantId: extra.tenantId, locationId: extra.locationId, membershipId: member.id, delta: -extra.delta, kind: "reversal", source: "staff_correction", actorUserId: input.userId, requestId: input.requestId, idempotencyKey: `happyhour-reversal:${original.id}`, reason, reversalOfId: extra.id });
    if (winback) await tx.insert(ledgerEntries).values({ tenantId: winback.tenantId, locationId: winback.locationId, membershipId: member.id, delta: -winback.delta, kind: "reversal", source: "staff_correction", actorUserId: input.userId, requestId: input.requestId, idempotencyKey: `winback-reversal:${original.id}`, reason, reversalOfId: winback.id });
    if (birthday) await tx.insert(ledgerEntries).values({ tenantId: birthday.tenantId, locationId: birthday.locationId, membershipId: member.id, delta: -birthday.delta, kind: "reversal", source: "staff_correction", actorUserId: input.userId, requestId: input.requestId, idempotencyKey: `birthday-reversal:${original.id}`, reason, reversalOfId: birthday.id });
    await tx.update(memberships).set({ balance }).where(eq(memberships.id, member.id));
    await enqueueWalletRefresh(tx, original.tenantId, member.id);
    if (original.kind === "award" && (original.source === "staff_online" || original.source === "staff_offline")) {
      await reverseReferralForCheckout(tx, { qualifyingEntryId: original.id, tenantId: original.tenantId, actorUserId: input.userId, allowLargeBonus: staff.role === "owner" });
    }
    const [updated] = await tx.select({ balance: memberships.balance }).from(memberships).where(eq(memberships.id, member.id));
    return { balance: updated.balance, duplicate: false, entryId: entry.id };
  }).catch(rethrowLedgerKeyConflict);
}
