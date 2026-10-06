import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ledgerEntries, membershipContacts, memberships, outboxJobs, programs, referralCodes, referralSettings, referrals, staffRoles } from "@/db/schema";
import { validCardToken } from "./card-lifecycle";
import { formatCardLocator } from "./card-locator";
import { DomainError } from "./loyalty";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Referral = typeof referrals.$inferSelect;
const settingsInput = z.object({
  actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120),
  enabled: z.boolean(), referrerBonus: z.number().int().min(0).max(1000), referredBonus: z.number().int().min(0).max(1000),
}).strict().refine(value => !value.enabled || value.referrerBonus + value.referredBonus > 0, { message: "An enabled referral rule needs a bonus" });
const codeSchema = z.string().regex(/^ref_[A-Za-z0-9_-]{24}$/);

async function ownerProgram(tx: Transaction, actorUserId: string, programSlug: string) {
  const [program] = await tx.select().from(programs).where(and(eq(programs.slug, programSlug), eq(programs.status, "active")));
  if (!program) throw new DomainError("NOT_FOUND", "Programme not found");
  const [owner] = await tx.select({ userId: staffRoles.userId }).from(staffRoles)
    .where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
  if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
  return program;
}

export async function configureReferrals(raw: z.input<typeof settingsInput>) {
  const input = settingsInput.parse(raw);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const [setting] = await tx.insert(referralSettings).values({
      tenantId: program.tenantId, programId: program.id, enabled: input.enabled,
      referrerBonus: input.referrerBonus, referredBonus: input.referredBonus,
    }).onConflictDoUpdate({ target: referralSettings.programId, set: {
      enabled: input.enabled, referrerBonus: input.referrerBonus, referredBonus: input.referredBonus, updatedAt: new Date(),
    } }).returning();
    return { enabled: setting.enabled, referrerBonus: setting.referrerBonus, referredBonus: setting.referredBonus, programType: program.type };
  });
}

export async function getReferralSettings(input: { actorUserId: string; programSlug: string }) {
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const [setting] = await tx.select().from(referralSettings).where(eq(referralSettings.programId, program.id));
    return { enabled: setting?.enabled ?? false, referrerBonus: setting?.referrerBonus ?? 0, referredBonus: setting?.referredBonus ?? 0, programType: program.type };
  });
}

export async function publicReferralTerms(tenantId: string, programId: string) {
  const [setting] = await db.select({ enabled: referralSettings.enabled, referrerBonus: referralSettings.referrerBonus, referredBonus: referralSettings.referredBonus })
    .from(referralSettings).where(and(eq(referralSettings.tenantId, tenantId), eq(referralSettings.programId, programId)));
  return setting?.enabled ? setting : { enabled: false, referrerBonus: 0, referredBonus: 0 };
}

function publicOrigin() {
  const configured = process.env.PUBLIC_BASE_URL;
  if (!configured) throw new Error("Public application origin is not configured");
  const parsed = new URL(configured);
  const local = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.origin !== configured || !(parsed.protocol === "https:" || local)) throw new Error("Public application origin is invalid");
  return parsed;
}

export async function getCardReferralShare(cardToken: string) {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  const origin = publicOrigin();
  return db.transaction(async tx => {
    const [row] = await tx.select({ member: memberships, program: programs }).from(memberships)
      .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
      .where(eq(memberships.cardToken, cardToken));
    if (!row || row.member.closedAt || row.program.status !== "active") throw new DomainError("NOT_FOUND", "Card not found");
    const [setting] = await tx.select().from(referralSettings).where(and(eq(referralSettings.tenantId, row.member.tenantId), eq(referralSettings.programId, row.program.id)));
    if (!setting?.enabled) throw new DomainError("REFERRAL_DISABLED", "Referral sharing is unavailable for this programme");
    await tx.insert(referralCodes).values({ tenantId: row.member.tenantId, programId: row.program.id, membershipId: row.member.id, code: `ref_${randomBytes(18).toString("base64url")}` })
      .onConflictDoNothing({ target: referralCodes.membershipId });
    const [code] = await tx.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.membershipId, row.member.id));
    if (!code) throw new Error("Referral code could not be created");
    const url = new URL(`/join/${encodeURIComponent(row.program.slug)}`, origin);
    url.searchParams.set("ref", code.code);
    // The card's own progress only: counts, never who signed up.
    const [progress] = await tx.select({
      signedUp: sql<number>`count(*)::int`,
      qualified: sql<number>`count(*) FILTER (WHERE ${referrals.status} = 'qualified')::int`,
    }).from(referrals).where(and(eq(referrals.tenantId, row.member.tenantId), eq(referrals.referrerMembershipId, row.member.id)));
    return { shareUrl: url.toString(), referrerBonus: setting.referrerBonus, referredBonus: setting.referredBonus, programType: row.program.type,
      progress: { signedUp: progress?.signedUp ?? 0, qualified: progress?.qualified ?? 0 } };
  });
}

/** Runs inside the card-enrollment transaction. An opened link never earns credit. */
export async function recordReferralAttribution(tx: Transaction, input: { tenantId: string; programId: string; referredMembershipId: string; referralCode: string }) {
  const code = codeSchema.parse(input.referralCode);
  const [setting] = await tx.select().from(referralSettings).where(and(eq(referralSettings.tenantId, input.tenantId), eq(referralSettings.programId, input.programId)));
  if (!setting?.enabled) throw new DomainError("INVALID_REFERRAL", "Referral link is not available");
  const [source] = await tx.select({ referralCode: referralCodes, member: memberships }).from(referralCodes)
    .innerJoin(memberships, and(eq(memberships.id, referralCodes.membershipId), eq(memberships.tenantId, referralCodes.tenantId)))
    .where(and(eq(referralCodes.code, code), eq(referralCodes.tenantId, input.tenantId), eq(referralCodes.programId, input.programId)));
  if (!source || source.member.closedAt || source.member.programId !== input.programId || source.member.id === input.referredMembershipId) {
    throw new DomainError("INVALID_REFERRAL", "Referral link is not available");
  }
  await tx.insert(referrals).values({
    tenantId: input.tenantId, programId: input.programId, referrerMembershipId: source.member.id,
    referredMembershipId: input.referredMembershipId, codeId: source.referralCode.id,
    referrerBonus: setting.referrerBonus, referredBonus: setting.referredBonus,
  });
}

async function verifiedEmail(tx: Transaction, tenantId: string, membershipId: string) {
  const [contact] = await tx.select({ email: membershipContacts.email, verified: membershipContacts.emailVerified }).from(membershipContacts)
    .where(and(eq(membershipContacts.tenantId, tenantId), eq(membershipContacts.membershipId, membershipId)));
  return contact?.verified && contact.email ? contact.email.trim().toLowerCase() : null;
}

function bonusKey(referralId: string, recipient: "referrer" | "referred") { return `referral:${referralId}:${recipient}`; }
function reversalKey(referralId: string, recipient: "referrer" | "referred") { return `referral:${referralId}:reverse:${recipient}`; }

async function postBonus(tx: Transaction, input: { referral: Referral; membershipId: string; amount: number; recipient: "referrer" | "referred"; locationId: string; actorUserId: string }) {
  if (input.amount === 0) return null;
  const [entry] = await tx.insert(ledgerEntries).values({
    tenantId: input.referral.tenantId, locationId: input.locationId, membershipId: input.membershipId,
    kind: "award", source: "referral_bonus", delta: input.amount, actorUserId: input.actorUserId,
    requestId: randomUUID(), idempotencyKey: bonusKey(input.referral.id, input.recipient),
    reason: "Referral bonus after first confirmed checkout",
  }).returning({ id: ledgerEntries.id });
  return entry.id;
}

/** Called after a staff award is persisted, within the same transaction and member lock. */
export async function qualifyReferralOnAward(tx: Transaction, input: {
  tenantId: string; programId: string; locationId: string; referredMembershipId: string; awardEntryId: string; actorUserId: string;
}) {
  const [referral] = await tx.select().from(referrals)
    .where(and(eq(referrals.tenantId, input.tenantId), eq(referrals.programId, input.programId), eq(referrals.referredMembershipId, input.referredMembershipId), eq(referrals.status, "pending")))
    .for("update");
  if (!referral) return { referredBonus: 0 };
  const [prior] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(
    eq(ledgerEntries.tenantId, input.tenantId), eq(ledgerEntries.membershipId, input.referredMembershipId),
    eq(ledgerEntries.kind, "award"), sql`${ledgerEntries.source} in ('staff_online','staff_offline')`,
    sql`${ledgerEntries.id} <> ${input.awardEntryId}`,
    sql`not exists (select 1 from ledger_entries correction where correction.tenant_id = ${ledgerEntries.tenantId} and correction.reversal_of_id = ${ledgerEntries.id})`,
  )).limit(1);
  if (prior) return { referredBonus: 0 };
  const [referrer] = await tx.select().from(memberships)
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.id, referral.referrerMembershipId))).for("update");
  const [referred] = await tx.select().from(memberships)
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.id, referral.referredMembershipId)));
  let reviewReason: string | null = null;
  if (!referrer || referrer.closedAt || referrer.programId !== input.programId || !referred || referred.closedAt) reviewReason = "member_unavailable";
  else {
    const referrerEmail = await verifiedEmail(tx, input.tenantId, referrer.id);
    const referredEmail = await verifiedEmail(tx, input.tenantId, referred.id);
    if (referrerEmail && referredEmail && referrerEmail === referredEmail) reviewReason = "same_verified_email";
    else if (referrer.balance + referral.referrerBonus > 2_147_483_647 || referred.balance + referral.referredBonus > 2_147_483_647) reviewReason = "balance_limit";
  }
  if (reviewReason) {
    await tx.update(referrals).set({ status: "review", reviewReason, qualifyingEntryId: input.awardEntryId }).where(eq(referrals.id, referral.id));
    return { referredBonus: 0 };
  }
  const referrerBonusEntryId = await postBonus(tx, { referral, membershipId: referrer!.id, amount: referral.referrerBonus, recipient: "referrer", locationId: input.locationId, actorUserId: input.actorUserId });
  const referredBonusEntryId = await postBonus(tx, { referral, membershipId: referred!.id, amount: referral.referredBonus, recipient: "referred", locationId: input.locationId, actorUserId: input.actorUserId });
  if (referral.referrerBonus) {
    await tx.update(memberships).set({ balance: referrer!.balance + referral.referrerBonus }).where(eq(memberships.id, referrer!.id));
    await tx.insert(outboxJobs).values({ tenantId: input.tenantId, kind: "wallet.refresh", payload: { membershipId: referrer!.id } });
  }
  if (referral.referredBonus) await tx.update(memberships).set({ balance: referred!.balance + referral.referredBonus }).where(eq(memberships.id, referred!.id));
  await tx.update(referrals).set({ status: "qualified", qualifyingEntryId: input.awardEntryId, referrerBonusEntryId, referredBonusEntryId, qualifiedAt: new Date() }).where(eq(referrals.id, referral.id));
  return { referredBonus: referral.referredBonus };
}

async function reverseOutstandingBonuses(tx: Transaction, referral: Referral, input: { actorUserId: string; allowLargeBonus: boolean }) {
  let unresolvedReason: string | null = null;
  for (const [recipient, bonusEntryId] of [["referrer", referral.referrerBonusEntryId], ["referred", referral.referredBonusEntryId]] as const) {
    if (!bonusEntryId) continue;
    const [bonus] = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, referral.tenantId), eq(ledgerEntries.id, bonusEntryId)));
    if (!bonus) throw new Error("Referral bonus ledger entry is missing");
    const [already] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, referral.tenantId), eq(ledgerEntries.reversalOfId, bonus.id)));
    if (already) continue;
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.tenantId, referral.tenantId), eq(memberships.id, bonus.membershipId))).for("update");
    if (!input.allowLargeBonus && bonus.delta > 100) { unresolvedReason ??= "owner_required"; continue; }
    if (!member || member.closedAt) { unresolvedReason ??= "member_unavailable"; continue; }
    if (member.balance < bonus.delta) { unresolvedReason ??= "bonus_spent"; continue; }
    await tx.insert(ledgerEntries).values({
      tenantId: referral.tenantId, locationId: bonus.locationId, membershipId: bonus.membershipId,
      delta: -bonus.delta, kind: "reversal", source: "staff_correction", actorUserId: input.actorUserId,
      requestId: randomUUID(), idempotencyKey: reversalKey(referral.id, recipient), reversalOfId: bonus.id,
      reason: "Referral bonus reversed after checkout correction",
    });
    await tx.update(memberships).set({ balance: member.balance - bonus.delta }).where(eq(memberships.id, member.id));
    await tx.insert(outboxJobs).values({ tenantId: referral.tenantId, kind: "wallet.refresh", payload: { membershipId: member.id } });
  }
  const next = unresolvedReason ? "review" : "reversed";
  await tx.update(referrals).set({ status: next, reviewReason: unresolvedReason, reversedAt: unresolvedReason ? null : new Date() }).where(eq(referrals.id, referral.id));
  return next;
}

/** Called by the existing correction transaction after the qualifying award is reversed. */
export async function reverseReferralForCheckout(tx: Transaction, input: { qualifyingEntryId: string; tenantId: string; actorUserId: string; allowLargeBonus: boolean }) {
  const [referral] = await tx.select().from(referrals)
    .where(and(eq(referrals.tenantId, input.tenantId), eq(referrals.qualifyingEntryId, input.qualifyingEntryId), eq(referrals.status, "qualified")))
    .for("update");
  if (!referral) return;
  await reverseOutstandingBonuses(tx, referral, input);
}

export async function listReferrals(input: { actorUserId: string; programSlug: string }) {
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const rows = await tx.select().from(referrals).where(and(eq(referrals.tenantId, program.tenantId), eq(referrals.programId, program.id)))
      .orderBy(desc(referrals.createdAt)).limit(100);
    // Show the same card numbers (K-XXXXXX) the owner sees under Customers and the cashier sees on the card.
    const ids = [...new Set(rows.flatMap(row => [row.referrerMembershipId, row.referredMembershipId]))];
    const locators = new Map(ids.length ? (await tx.select({ id: memberships.id, locator: memberships.cardLocator }).from(memberships)
      .where(and(eq(memberships.tenantId, program.tenantId), inArray(memberships.id, ids)))).map(row => [row.id, formatCardLocator(row.locator)]) : []);
    return rows.map(row => ({
      id: row.id, status: row.status, referrerCard: locators.get(row.referrerMembershipId) ?? "unbekannt", referredCard: locators.get(row.referredMembershipId) ?? "unbekannt",
      referrerBonus: row.referrerBonus, referredBonus: row.referredBonus, reviewReason: row.reviewReason,
      hasCreditedBonus: Boolean(row.referrerBonusEntryId || row.referredBonusEntryId),
      createdAt: row.createdAt.toISOString(), qualifiedAt: row.qualifiedAt?.toISOString() ?? null,
    }));
  });
}

const reviewInput = z.discriminatedUnion("action", [
  z.object({ actorUserId: z.string().min(1), referralId: z.uuid(), action: z.literal("reject"), reason: z.string().trim().min(10).max(240) }).strict(),
  z.object({ actorUserId: z.string().min(1), referralId: z.uuid(), action: z.literal("retry_reversal") }).strict(),
]);

export async function reviewReferral(raw: z.input<typeof reviewInput>) {
  const input = reviewInput.parse(raw);
  return db.transaction(async tx => {
    const [referral] = await tx.select().from(referrals).where(eq(referrals.id, input.referralId)).for("update");
    if (!referral) throw new DomainError("NOT_FOUND", "Referral not found");
    const [owner] = await tx.select({ userId: staffRoles.userId }).from(staffRoles)
      .where(and(eq(staffRoles.tenantId, referral.tenantId), eq(staffRoles.userId, input.actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
    if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
    if (referral.status !== "review") throw new DomainError("INVALID_REFERRAL_STATE", "Referral is not in review");
    if (input.action === "reject") {
      if (referral.referrerBonusEntryId || referral.referredBonusEntryId) throw new DomainError("INVALID_REFERRAL_STATE", "Credited bonuses require reversal review");
      await tx.update(referrals).set({ status: "rejected", reviewNote: input.reason, reviewedByUserId: input.actorUserId, reviewedAt: new Date() }).where(eq(referrals.id, referral.id));
      return { id: referral.id, status: "rejected" };
    }
    if (!referral.qualifyingEntryId || !referral.referrerBonusEntryId && !referral.referredBonusEntryId) throw new DomainError("INVALID_REFERRAL_STATE", "No credited bonus needs reversal");
    const [qualifyingReversal] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries)
      .where(and(eq(ledgerEntries.tenantId, referral.tenantId), eq(ledgerEntries.reversalOfId, referral.qualifyingEntryId)));
    if (!qualifyingReversal) throw new DomainError("INVALID_REFERRAL_STATE", "Qualifying checkout has not been reversed");
    const status = await reverseOutstandingBonuses(tx, referral, { actorUserId: input.actorUserId, allowLargeBonus: true });
    await tx.update(referrals).set({ reviewedByUserId: input.actorUserId, reviewedAt: new Date() }).where(eq(referrals.id, referral.id));
    return { id: referral.id, status };
  });
}
