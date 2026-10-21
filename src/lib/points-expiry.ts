import { randomUUID } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, locations, memberships, programs } from "@/db/schema";
import { duePoints, EXPIRY_REMINDER_DAYS, expiryBuckets, expiryReminderText, expiryRuleText, upcomingExpiry } from "./points-expiry-rules";
import { enqueueWalletRefresh } from "./wallet/enqueue";
import { queueCardWalletMessage } from "./wallet-messages";

// Points expiry (ENG-051). Expired points leave the card as a ledger row (kind and source 'expiry', no actor), booked by
// the worker; nothing is ever deleted. Analytics, referrals and the weekly report count only staff awards and 'redeem'
// rows, so an expiry is neither a visit nor a redemption. A manager or owner can give expired points back with an
// ordinary correction; the replay then treats them as freshly earned.

type Reader = Pick<typeof db, "select">;
type Rule = { pointsExpiryMonths: number | null; pointsExpirySince: Date | null };

export async function cardExpiryBuckets(reader: Reader, tenantId: string, membershipId: string, rule: Rule) {
  if (!rule.pointsExpiryMonths || !rule.pointsExpirySince) return [];
  const rows = await reader.select({ delta: ledgerEntries.delta, kind: ledgerEntries.kind, createdAt: ledgerEntries.createdAt }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenantId, tenantId), eq(ledgerEntries.membershipId, membershipId)));
  return expiryBuckets(rows, { months: rule.pointsExpiryMonths, since: rule.pointsExpirySince });
}

/** What the card shows: the rule (always, once it is on) and the points that expire within the next 30 days. */
export async function cardExpiry(reader: Reader, tenantId: string, membershipId: string, rule: Rule, timeZone: string, now = new Date()) {
  if (!rule.pointsExpiryMonths) return undefined;
  const upcoming = upcomingExpiry(await cardExpiryBuckets(reader, tenantId, membershipId, rule), now);
  return { rule: expiryRuleText(rule.pointsExpiryMonths), notice: upcoming ? expiryReminderText(upcoming.amount, upcoming.firstAt, timeZone) : undefined };
}

// shortcut: one transaction per card holding points in an expiry programme; fine for a few thousand cards, batch by programme past that.
const candidates = () => db.select({ membershipId: memberships.id, tenantId: memberships.tenantId, programId: programs.id }).from(memberships)
  .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
  .where(and(eq(programs.status, "active"), isNotNull(programs.pointsExpiryMonths), isNull(memberships.closedAt), gt(memberships.balance, 0)));

/** Books one card's due expiry under its lock. Exactly once: a second run finds the lots already used up by the first row (the key only names the run). */
export async function expireCardPoints(membershipId: string, now = new Date()) {
  return db.transaction(async tx => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for("update");
    if (!member || member.closedAt) return 0;
    // Shared like a booking, so an owner's save of the rule and this job wait for each other.
    const [program] = await tx.select().from(programs).where(and(eq(programs.id, member.programId), eq(programs.tenantId, member.tenantId))).for("share");
    if (!program || program.status !== "active") return 0;
    const amount = Math.min(duePoints(await cardExpiryBuckets(tx, member.tenantId, member.id, program), now), member.balance);
    if (amount <= 0) return 0;
    await tx.insert(ledgerEntries).values({
      tenantId: member.tenantId, locationId: program.locationId, membershipId: member.id, delta: -amount, kind: "expiry", source: "expiry",
      actorUserId: null, requestId: randomUUID(), idempotencyKey: `expiry:${member.id}:${now.toISOString()}`, reason: "Punkte verfallen",
      // The replay matches this row to the lots due at its time, so it carries the time the amount was computed for.
      createdAt: now,
    });
    await tx.update(memberships).set({ balance: member.balance - amount }).where(eq(memberships.id, member.id));
    await enqueueWalletRefresh(tx, member.tenantId, member.id);
    return amount;
  });
}

/** Worker tick: books due expiries, then queues the Wallet reminders. Returns how many cards lost points. */
export async function runPointsExpiry(now = new Date()) {
  let expired = 0;
  for (const card of await candidates()) {
    // One card that cannot be booked must not stop every other card's expiry or the worker loop.
    try { if (await expireCardPoints(card.membershipId, now)) expired += 1; }
    catch (error) { console.error(`Points expiry for card ${card.membershipId} failed (${error instanceof Error ? error.name : "error"})`); }
  }
  await queueExpiryReminders(now);
  return expired;
}

/** One Wallet reminder per card and 30 days, covering what expires in the next 30 days; only for consented Apple holders. */
export async function queueExpiryReminders(now = new Date()) {
  let queued = 0;
  for (const card of await candidates()) {
    const [row] = await db.select({ program: programs, timezone: locations.timezone }).from(programs)
      .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
      .where(and(eq(programs.id, card.programId), eq(programs.tenantId, card.tenantId), sql`exists (select 1 from wallet_message_consents c where c.tenant_id = ${card.tenantId}::uuid and c.membership_id = ${card.membershipId}::uuid and c.withdrawn_at is null)`));
    if (!row) continue;
    const upcoming = upcomingExpiry(await cardExpiryBuckets(db, card.tenantId, card.membershipId, row.program), now);
    if (!upcoming) continue;
    const text = expiryReminderText(upcoming.amount, upcoming.firstAt, row.timezone);
    try { if (await queueCardWalletMessage({ tenantId: card.tenantId, programId: card.programId, membershipId: card.membershipId, kind: "expiry", text, onceWithinDays: EXPIRY_REMINDER_DAYS }, now)) queued += 1; }
    catch (error) { console.error(`Expiry reminder for card ${card.membershipId} failed (${error instanceof Error ? error.name : "error"})`); }
  }
  return queued;
}
