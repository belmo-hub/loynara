import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { billingLocationPlans, consentEvents, ledgerEntries, locations, membershipContacts, memberships, programRuleVersions, programs, purchaseAwards, rewardVersions, rewards, staffRoles, subscriptions, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { validCardToken } from "./card-lifecycle";
import { formatCardLocator, isScanCodeInput, parseCardLocator } from "./card-locator";
import { draftPriceMinor } from "./pricing";
import { MAX_POINTS_PER_CURRENCY_UNIT } from "./points";
import { publicReferralTerms, recordReferralAttribution } from "./referrals";
import { automaticTapAllowed } from "./pilot-policy";
import { hiddenSurfaces } from "./pilot-surfaces";
import { enqueueWalletProgramRefresh } from "./wallet/enqueue";

const shortText = z.string().trim().min(2).max(180);
const merchantInput = z.object({
  userId: z.string().min(1),
  businessName: shortText,
  locationName: shortText.optional(),
  city: z.string().trim().min(2).max(120),
  country: z.enum(["DE", "MA"]),
  timezone: z.string().min(3).max(80),
  locale: z.enum(["de", "fr"]),
  currency: z.enum(["EUR", "MAD"]),
  programName: shortText,
  programType: z.enum(["stamp", "points"]),
  earningMode: z.enum(["manual", "purchase"]).optional(),
  pointsPerCurrencyUnit: z.number().int().min(1).max(MAX_POINTS_PER_CURRENCY_UNIT).optional(),
  rulesText: z.string().trim().min(10).max(3000),
  rewardTitle: shortText,
  rewardCost: z.number().int().min(1).max(100000),
  contactEmail: z.email().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  logoData: z.string().max(3_000_000).optional(),
  effectiveDate: z.iso.date().optional(),
});

function randomCode(bytes: number) { return randomBytes(bytes).toString("base64url"); }
const SETUP_INCOMPLETE = "Die Einrichtung deines Geschäfts ist unvollständig. Bitte wende dich an den Support. Starte keine neue Einrichtung.";
const ACCESS_REVOKED = "Dein Zugang wurde entzogen. Bitte wende dich an die Inhaberin oder den Inhaber.";
function slugOf(name: string) { return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "lokal"; }
function checkedLogo(value?: string) {
  if (!value) return null;
  const match = /^data:(image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new DomainError("INVALID_LOGO", "Logo must be PNG, JPEG or WebP");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 16 || bytes.length > 2_000_000) throw new DomainError("INVALID_LOGO", "Logo must be at most 2 MB");
  const magic = bytes.subarray(0, 12).toString("hex");
  const valid = match[1] === "image/png" ? magic.startsWith("89504e470d0a1a0a") : match[1] === "image/jpeg" ? magic.startsWith("ffd8ff") : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new DomainError("INVALID_LOGO", "Logo format does not match its contents");
  return value;
}

export async function createMerchant(raw: z.input<typeof merchantInput>) {
  const input = merchantInput.parse(raw);
  const earningMode = input.earningMode ?? "manual";
  if (input.programType === "stamp" && earningMode !== "manual") throw new DomainError("INVALID_EARNING_MODE", "Stamp programmes use manual earning");
  try { new Intl.DateTimeFormat("de", { timeZone: input.timezone }); } catch { throw new DomainError("INVALID_TIMEZONE", "Unknown timezone"); }
  if ((input.country === "DE" && input.currency !== "EUR") || (input.country === "MA" && input.currency !== "MAD")) throw new DomainError("INVALID_CURRENCY", "Currency and country differ");
  if ((input.latitude === undefined) !== (input.longitude === undefined)) throw new DomainError("INVALID_COORDINATES", "Latitude and longitude are required together");
  const logoData = checkedLogo(input.logoData);
  return db.transaction(async (tx) => {
    // Serialize retries for this authenticated identity, including the first
    // request before a staff row exists. No provisioning happens in auth hooks.
    await tx.execute(sql`select id from "user" where id = ${input.userId} for update`);
    const [existing] = await tx.select().from(staffRoles).where(eq(staffRoles.userId, input.userId)).limit(1).for("update");
    if (existing) {
      if (!existing.active) throw new DomainError("FORBIDDEN", ACCESS_REVOKED);
      if (existing.role !== "owner") throw new DomainError("FORBIDDEN", "Nur Inhaber:innen dürfen ein Geschäft einrichten. Dein Konto hat bereits einen Teamzugang.");
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, existing.tenantId)).for("update");
      const ownedLocations = await tx.select().from(locations).where(eq(locations.tenantId, existing.tenantId)).limit(2);
      if (ownedLocations.length > 1) throw new DomainError("ALREADY_ONBOARDED", "Dein Geschäft ist bereits eingerichtet. Öffne die Übersicht und wähle dort den gewünschten Standort.");
      const [location] = ownedLocations;
      if (!tenant || !location) throw new DomainError("SETUP_INCOMPLETE", SETUP_INCOMPLETE);
      const [completed] = await tx.select({ program: programs }).from(programs)
        .innerJoin(programRuleVersions, and(eq(programRuleVersions.tenantId, existing.tenantId), eq(programRuleVersions.programId, programs.id)))
        .innerJoin(billingLocationPlans, and(eq(billingLocationPlans.tenantId, existing.tenantId), eq(billingLocationPlans.locationId, location.id)))
        .innerJoin(subscriptions, eq(subscriptions.tenantId, existing.tenantId))
        .where(and(eq(programs.tenantId, existing.tenantId), eq(programs.locationId, location.id), eq(programs.status, "active"))).limit(1);
      if (!completed) throw new DomainError("SETUP_INCOMPLETE", SETUP_INCOMPLETE);
      const program = completed.program;
      return { tenantId: tenant.id, locationId: location.id, programId: program.id, programSlug: program.slug, city: location.city, programType: program.type };
    }
    const suffix = randomCode(5).toLowerCase().replace(/[^a-z0-9]/g, "");
    const [tenant] = await tx.insert(tenants).values({ name: input.businessName, slug: `${slugOf(input.businessName)}-${suffix}`, currency: input.currency, locale: input.locale }).returning();
    const [location] = await tx.insert(locations).values({ tenantId: tenant.id, name: input.locationName ?? input.businessName, city: input.city, country: input.country, timezone: input.timezone, contactEmail: input.contactEmail, brandColor: input.brandColor, logoData, latitude: input.latitude, longitude: input.longitude }).returning();
    const assigned = await tx.insert(staffRoles).values({ tenantId: tenant.id, userId: input.userId, role: "owner" })
      .onConflictDoNothing({ target: staffRoles.userId }).returning({ userId: staffRoles.userId });
    if (!assigned.length) throw new DomainError("ALREADY_ONBOARDED", "Dein Konto wurde bereits einem Geschäft zugeordnet. Lade deinen Bereich neu.");
    const [program] = await tx.insert(programs).values({ tenantId: tenant.id, locationId: location.id, slug: `${slugOf(input.programName)}-${suffix}`, name: input.programName, type: input.programType, earningMode, pointsPerCurrencyUnit: input.pointsPerCurrencyUnit ?? 1, rulesText: input.rulesText, effectiveAt: input.effectiveDate ? new Date(`${input.effectiveDate}T00:00:00Z`) : undefined }).returning();
    await tx.insert(programRuleVersions).values({ tenantId: tenant.id, programId: program.id, version: 1, name: program.name, type: program.type, rulesText: program.rulesText, earningMode: program.earningMode, pointsPerCurrencyUnit: program.pointsPerCurrencyUnit, effectiveAt: program.effectiveAt });
    const [reward] = await tx.insert(rewards).values({ tenantId: tenant.id, programId: program.id }).returning();
    await tx.insert(rewardVersions).values({ tenantId: tenant.id, rewardId: reward.id, version: 1, title: input.rewardTitle, cost: input.rewardCost });
    const priceMinor = draftPriceMinor(input.currency);
    await tx.insert(subscriptions).values({ tenantId: tenant.id, currency: input.currency, priceMinor });
    await tx.insert(billingLocationPlans).values({ tenantId: tenant.id, locationId: location.id, currency: input.currency, priceMinor });
    return { tenantId: tenant.id, locationId: location.id, programId: program.id, programSlug: program.slug, city: location.city, programType: program.type };
  });
}

const updateProgramInput = z.object({
  actorUserId: z.string().min(1),
  programSlug: z.string().min(1).max(120),
  name: shortText,
  rulesText: z.string().trim().min(10).max(3000),
  programType: z.enum(["stamp", "points"]).optional(),
  earningMode: z.enum(["manual", "purchase"]).optional(),
  pointsPerCurrencyUnit: z.number().int().min(1).max(MAX_POINTS_PER_CURRENCY_UNIT).optional(),
}).strict();

export async function updateProgram(raw: z.input<typeof updateProgramInput>) {
  const input = updateProgramInput.parse(raw);
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(programs).where(and(eq(programs.slug, input.programSlug), eq(programs.status, "active"))).for("update");
    if (!program) throw new DomainError("NOT_FOUND", "Program not found");
    const [owner] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, input.actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
    if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
    const nextType = input.programType ?? program.type;
    const earningMode = input.earningMode ?? program.earningMode;
    const pointsPerCurrencyUnit = input.pointsPerCurrencyUnit ?? program.pointsPerCurrencyUnit;
    if (nextType === "stamp" && earningMode !== "manual") throw new DomainError("INVALID_EARNING_MODE", "Stamp programmes use manual earning");
    if (nextType !== program.type) {
      const [activity] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, program.tenantId), eq(ledgerEntries.locationId, program.locationId))).limit(1);
      if (activity) throw new DomainError("TYPE_LOCKED", "Program type cannot change after transactions");
    }
    const [latestRule] = await tx.select().from(programRuleVersions).where(and(eq(programRuleVersions.tenantId, program.tenantId), eq(programRuleVersions.programId, program.id))).orderBy(desc(programRuleVersions.version)).limit(1);
    if (!latestRule) throw new DomainError("NOT_FOUND", "Programme rule not found");
    const ruleChanged = program.name !== input.name || program.rulesText !== input.rulesText || program.type !== nextType || program.earningMode !== earningMode || program.pointsPerCurrencyUnit !== pointsPerCurrencyUnit;
    if (ruleChanged) {
      await tx.update(programs).set({ name: input.name, rulesText: input.rulesText, type: nextType, earningMode, pointsPerCurrencyUnit }).where(eq(programs.id, program.id));
      await tx.insert(programRuleVersions).values({ tenantId: program.tenantId, programId: program.id, version: latestRule.version + 1, name: input.name, type: nextType, rulesText: input.rulesText, earningMode, pointsPerCurrencyUnit });
      await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
    }
    return { programSlug: program.slug, programType: nextType, ruleVersion: latestRule.version + Number(ruleChanged) };
  });
}

const enrollInput = z.object({
  slug: z.string().min(1).max(120),
  acceptedTerms: z.literal(true),
  referralCode: z.string().regex(/^ref_[A-Za-z0-9_-]{24}$/).optional(),
  email: z.email().optional(),
  marketingOptIn: z.boolean().default(false),
});

export async function enroll(raw: z.input<typeof enrollInput>) {
  const input = enrollInput.parse(raw);
  if (input.marketingOptIn && !input.email) throw new DomainError("EMAIL_REQUIRED", "An email is needed to receive marketing");
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(programs).where(and(eq(programs.slug, input.slug), eq(programs.status, "active")));
    if (!program) throw new DomainError("NOT_FOUND", "Program not found");
    const [availability] = await tx.select({ active: sql<boolean>`${programs.effectiveAt} <= now()` }).from(programs).where(eq(programs.id, program.id));
    if (!availability.active) throw new DomainError("NOT_AVAILABLE", "Program is not active yet");
    const [plan] = await tx.select().from(billingLocationPlans).where(and(eq(billingLocationPlans.tenantId, program.tenantId), eq(billingLocationPlans.locationId, program.locationId))).for("update");
    if (!plan) throw new DomainError("PLAN_UNAVAILABLE", "Location plan is unavailable");
    const [usage] = await tx.select({ total: sql<number>`count(*)::int` }).from(memberships)
      .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
      .where(and(eq(memberships.tenantId, program.tenantId), eq(programs.locationId, program.locationId), sql`${memberships.closedAt} is null`));
    if (usage.total >= plan.memberLimit) throw new DomainError("PLAN_MEMBER_LIMIT", "This location has reached its card limit");
    const [member] = await tx.insert(memberships).values({ tenantId: program.tenantId, programId: program.id, scanCode: `sc_${randomCode(24)}`, cardToken: `card_${randomCode(32)}` }).returning();
    if (input.referralCode) await recordReferralAttribution(tx, { tenantId: program.tenantId, programId: program.id, referredMembershipId: member.id, referralCode: input.referralCode });
    if (input.email) await tx.insert(membershipContacts).values({ tenantId: program.tenantId, membershipId: member.id, email: input.email.toLowerCase() });
    if (input.marketingOptIn) await tx.insert(consentEvents).values({ tenantId: program.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: true, noticeVersion: "2026-09", source: "enrollment" });
    return { id: member.id, programId: program.id, cardToken: member.cardToken, scanCode: member.scanCode };
  });
}

/** Active rewards in the merchant's order. The browser card and the Wallet pass both show the first as the target. */
export async function currentRewards(tenantId: string, programId: string) {
  const rows = await db.select({ reward: rewards, version: rewardVersions }).from(rewards)
    .innerJoin(rewardVersions, and(eq(rewardVersions.rewardId, rewards.id), eq(rewardVersions.tenantId, rewards.tenantId)))
    .where(and(eq(rewards.tenantId, tenantId), eq(rewards.programId, programId), eq(rewards.active, true), sql`${rewardVersions.effectiveAt} <= now()`))
    .orderBy(desc(rewardVersions.version));
  const seen = new Set<string>();
  return rows.filter(({ reward }) => { if (seen.has(reward.id)) return false; seen.add(reward.id); return true; })
    .sort((a, b) => a.reward.sortOrder - b.reward.sortOrder || a.reward.id.localeCompare(b.reward.id))
    .map(({ reward, version }) => ({ id: version.id, rewardId: reward.id, title: version.title, cost: version.cost, termsText: version.termsText, sortOrder: reward.sortOrder }));
}

const rewardFields = z.object({ title: shortText, cost: z.number().int().min(1).max(100000), termsText: z.string().trim().max(3000).default("") });

async function ownerProgram(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], actorUserId: string, programSlug: string) {
  const [program] = await tx.select().from(programs).where(and(eq(programs.slug, programSlug), eq(programs.status, "active"))).for("update");
  if (!program) throw new DomainError("NOT_FOUND", "Programme not found");
  const [owner] = await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
  if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
  return program;
}

export async function getMerchantRewards(input: { actorUserId: string; programSlug: string }) {
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const rows = await tx.select({ reward: rewards, version: rewardVersions }).from(rewards)
      .innerJoin(rewardVersions, and(eq(rewardVersions.rewardId, rewards.id), eq(rewardVersions.tenantId, rewards.tenantId)))
      .where(and(eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id)))
      .orderBy(desc(rewardVersions.version));
    const seen = new Set<string>();
    return rows.filter(({ reward }) => { if (seen.has(reward.id)) return false; seen.add(reward.id); return true; })
      .sort((a, b) => a.reward.sortOrder - b.reward.sortOrder || a.reward.id.localeCompare(b.reward.id))
      .map(({ reward, version }) => ({ rewardId: reward.id, versionId: version.id, version: version.version, title: version.title, cost: version.cost, termsText: version.termsText, sortOrder: reward.sortOrder, active: reward.active }));
  });
}

export async function createReward(raw: { actorUserId: string; programSlug: string; title: string; cost: number; termsText?: string }) {
  const input = rewardFields.extend({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120) }).parse(raw);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const active = await tx.select({ id: rewards.id }).from(rewards).where(and(eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id), eq(rewards.active, true)));
    if (active.length >= 100) throw new DomainError("REWARD_LIMIT", "A programme can have at most 100 active rewards");
    const [highest] = await tx.select({ sortOrder: rewards.sortOrder }).from(rewards).where(and(eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id))).orderBy(desc(rewards.sortOrder)).limit(1);
    const [reward] = await tx.insert(rewards).values({ tenantId: program.tenantId, programId: program.id, sortOrder: (highest?.sortOrder ?? -1) + 1 }).returning();
    const [version] = await tx.insert(rewardVersions).values({ tenantId: program.tenantId, rewardId: reward.id, version: 1, title: input.title, cost: input.cost, termsText: input.termsText }).returning();
    await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
    return { rewardId: reward.id, versionId: version.id };
  });
}

export async function editReward(raw: { actorUserId: string; programSlug: string; rewardId: string; title: string; cost: number; termsText: string }) {
  const input = rewardFields.extend({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120), rewardId: z.uuid() }).parse(raw);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const [reward] = await tx.select().from(rewards).where(and(eq(rewards.id, input.rewardId), eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id), eq(rewards.active, true))).for("update");
    if (!reward) throw new DomainError("NOT_FOUND", "Reward not found");
    const [latest] = await tx.select().from(rewardVersions).where(and(eq(rewardVersions.tenantId, program.tenantId), eq(rewardVersions.rewardId, reward.id))).orderBy(desc(rewardVersions.version)).limit(1);
    if (!latest) throw new DomainError("NOT_FOUND", "Reward version not found");
    if (latest.title === input.title && latest.cost === input.cost && latest.termsText === input.termsText) return { rewardId: reward.id, versionId: latest.id, version: latest.version };
    const [version] = await tx.insert(rewardVersions).values({ tenantId: program.tenantId, rewardId: reward.id, version: latest.version + 1, title: input.title, cost: input.cost, termsText: input.termsText }).returning();
    await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
    return { rewardId: reward.id, versionId: version.id, version: version.version };
  });
}

export async function reorderRewards(raw: { actorUserId: string; programSlug: string; rewardIds: string[] }) {
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120), rewardIds: z.array(z.uuid()).min(1).max(100) }).parse(raw);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const active = await tx.select({ id: rewards.id }).from(rewards).where(and(eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id), eq(rewards.active, true)));
    if (input.rewardIds.length !== active.length || new Set(input.rewardIds).size !== active.length || active.some(row => !input.rewardIds.includes(row.id))) throw new DomainError("INVALID_REWARD_ORDER", "Order must include every active reward once");
    for (const [index, id] of input.rewardIds.entries()) await tx.update(rewards).set({ sortOrder: index }).where(eq(rewards.id, id));
    await enqueueWalletProgramRefresh(tx, program.tenantId, program.id); // the first reward is the pass's target
    return { rewardIds: input.rewardIds };
  });
}

export async function archiveReward(raw: { actorUserId: string; programSlug: string; rewardId: string }) {
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120), rewardId: z.uuid() }).parse(raw);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const active = await tx.select({ id: rewards.id }).from(rewards).where(and(eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id), eq(rewards.active, true)));
    if (!active.some(row => row.id === input.rewardId)) throw new DomainError("NOT_FOUND", "Active reward not found");
    if (active.length === 1) throw new DomainError("LAST_ACTIVE_REWARD", "At least one active reward is required");
    await tx.update(rewards).set({ active: false }).where(eq(rewards.id, input.rewardId));
    await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
    return { rewardId: input.rewardId, archived: true };
  });
}

export async function getCard(token: string) {
  if (!validCardToken(token)) throw new DomainError("NOT_FOUND", "Card not found");
  const [row] = await db.select({ member: memberships, program: programs, location: locations, tenant: tenants })
    .from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.cardToken, token), sql`${memberships.closedAt} is null`));
  if (!row) throw new DomainError("NOT_FOUND", "Card not found");
  const activity = await db.select({ delta: ledgerEntries.delta, kind: ledgerEntries.kind, createdAt: ledgerEntries.createdAt, purchaseLedgerId: purchaseAwards.ledgerEntryId }).from(ledgerEntries)
    .leftJoin(purchaseAwards, and(eq(purchaseAwards.ledgerEntryId, ledgerEntries.id), eq(purchaseAwards.tenantId, ledgerEntries.tenantId)))
    .where(and(eq(ledgerEntries.tenantId, row.member.tenantId), eq(ledgerEntries.membershipId, row.member.id)))
    .orderBy(desc(ledgerEntries.createdAt)).limit(10);
  return { scanCode: row.member.scanCode, cardLocator: formatCardLocator(row.member.cardLocator), balance: row.member.balance, merchantName: row.tenant.name, locationName: row.location.name, programName: row.program.name, programType: row.program.type, earningMode: row.program.earningMode, locale: row.tenant.locale, brandColor: row.location.brandColor, rulesText: row.program.rulesText, rewards: await currentRewards(row.member.tenantId, row.program.id), activity: activity.map(({ purchaseLedgerId, ...entry }) => ({ ...entry, isPurchase: purchaseLedgerId !== null })) };
}

type CounterCard = { member: typeof memberships.$inferSelect; program: typeof programs.$inferSelect; tenant: typeof tenants.$inferSelect; by: "code" | "locator" };

/**
 * Resolves what the counter typed or scanned to a card the signed-in staff member may work with. A scan code is a
 * credential and is looked up directly. Anything else must parse as a card locator, which is resolved only inside the
 * staff member's own tenant and then only at the selected location; every miss looks the same ("not found"), so a lookup
 * never reveals another location's or merchant's cards.
 */
async function resolveCounterCard(input: { userId: string; locationId: string; code: string }): Promise<CounterCard> {
  const code = input.code.trim();
  const locator = isScanCodeInput(code) ? null : parseCardLocator(code);
  if (!locator && !isScanCodeInput(code)) throw new DomainError("INVALID_CODE", "Invalid card code");
  const [actor] = locator ? await db.select({ tenantId: staffRoles.tenantId }).from(staffRoles).where(and(eq(staffRoles.userId, input.userId), eq(staffRoles.active, true))) : [];
  if (locator && !actor) throw new DomainError("FORBIDDEN", "No checkout access");
  const [row] = await db.select({ member: memberships, program: programs, tenant: tenants }).from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(locator ? and(eq(memberships.tenantId, actor.tenantId), eq(memberships.cardLocator, locator)) : eq(memberships.scanCode, code));
  if (!row || row.member.closedAt || row.program.locationId !== input.locationId || row.program.status !== "active") throw new DomainError("NOT_FOUND", "Card not found at this location");
  const [role] = await db.select().from(staffRoles).where(and(eq(staffRoles.tenantId, row.member.tenantId), eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
  if (!role || (role.role !== "owner" && role.locationId !== input.locationId)) throw new DomainError("FORBIDDEN", "No checkout access");
  return { ...row, by: locator ? "locator" : "code" };
}

/**
 * Step one for a typed locator: just enough to confirm "that is the card in front of me" (locator, programme, month of
 * issue). No balance, rewards, internal ID or offline lease. The cashier then opens the card deliberately.
 */
export async function previewCardLocator(input: { userId: string; locationId: string; scanCode: string }) {
  const card = await resolveCounterCard({ userId: input.userId, locationId: input.locationId, code: input.scanCode });
  if (card.by !== "locator") throw new DomainError("INVALID_CODE", "Preview is only for card locators");
  return { stage: "preview" as const, cardLocator: formatCardLocator(card.member.cardLocator), programName: card.program.name, issuedAt: card.member.createdAt.toISOString().slice(0, 7) };
}

/** Opens a card for checkout work: balance, rewards and the rule version the next award must confirm. */
export async function lookupCard(input: { userId: string; locationId: string; scanCode: string }) {
  const { member, program, tenant, by } = await resolveCounterCard({ userId: input.userId, locationId: input.locationId, code: input.scanCode });
  const [rule] = await db.select({ id: programRuleVersions.id }).from(programRuleVersions).where(and(eq(programRuleVersions.tenantId, member.tenantId), eq(programRuleVersions.programId, program.id))).orderBy(desc(programRuleVersions.version)).limit(1);
  if (!rule) throw new DomainError("NOT_FOUND", "Programme rule not found");
  return { stage: "open" as const, membershipId: member.id, cardLocator: formatCardLocator(member.cardLocator), matchedBy: by, balance: member.balance, programType: program.type, earningMode: program.earningMode, pointsPerCurrencyUnit: program.pointsPerCurrencyUnit, currency: tenant.currency, ruleVersionId: rule.id, rewards: await currentRewards(member.tenantId, program.id) };
}

export async function getPublicProgram(slug: string) {
  const [row] = await db.select({ program: programs, location: locations, tenant: tenants, active: sql<boolean>`${programs.effectiveAt} <= now()` }).from(programs)
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, programs.tenantId))
    .where(and(eq(programs.slug, slug), eq(programs.status, "active")));
  if (!row) throw new DomainError("NOT_FOUND", "Program not found");
  const rewardList = await currentRewards(row.tenant.id, row.program.id);
  const [reward] = rewardList;
  return { businessName: row.tenant.name, locationName: row.location.name, programName: row.program.name, programType: row.program.type, earningMode: row.program.earningMode, pointsPerCurrencyUnit: row.program.pointsPerCurrencyUnit, currency: row.tenant.currency, locale: row.tenant.locale, rulesText: row.program.rulesText, rewards: rewardList, rewardTitle: reward?.title, rewardCost: reward?.cost, brandColor: row.location.brandColor, active: row.active, referral: await publicReferralTerms(row.tenant.id, row.program.id) };
}

export async function getMerchantContext(userId: string, selectedLocationId?: string | null) {
  const [staff] = await db.select().from(staffRoles).where(eq(staffRoles.userId, userId)).limit(1);
  if (!staff) return null;
  if (!staff.active) throw new DomainError("FORBIDDEN", ACCESS_REVOKED);
  // Staff have one assigned location. Only an owner can use a selected-location
  // cookie, and every request checks that selection against the owner tenant.
  if (staff.role === "owner" && selectedLocationId && !z.uuid().safeParse(selectedLocationId).success) throw new DomainError("INVALID_LOCATION", "Invalid selected location");
  if (staff.role !== "owner" && !staff.locationId) throw new DomainError("FORBIDDEN", "Deinem Teamzugang fehlt ein Standort. Bitte wende dich an die Inhaberin oder den Inhaber.");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, staff.tenantId));
  const targetLocationId = staff.role === "owner" ? selectedLocationId : staff.locationId;
  const [location] = await db.select().from(locations).where(and(eq(locations.tenantId, staff.tenantId), targetLocationId ? eq(locations.id, targetLocationId) : sql`true`)).orderBy(asc(locations.createdAt), asc(locations.id)).limit(1);
  if (staff.role === "owner" && selectedLocationId && !location) throw new DomainError("NOT_FOUND", "Der gewählte Standort ist nicht verfügbar. Bitte wende dich an den Support.");
  if (!tenant || !location) throw new DomainError("SETUP_INCOMPLETE", SETUP_INCOMPLETE);
  const [program] = await db.select().from(programs).where(and(eq(programs.tenantId, tenant.id), eq(programs.locationId, location.id), eq(programs.status, "active"))).limit(1);
  if (!program) throw new DomainError("SETUP_INCOMPLETE", SETUP_INCOMPLETE);
  const [reward] = program ? await currentRewards(tenant.id, program.id) : [];
  const base = { userId, tenantId: tenant.id, locationId: location.id, role: staff.role, businessName: tenant.name, locationName: location.name, locale: tenant.locale, programId: program?.id, programSlug: program?.slug, programType: program?.type, tapMode: program?.tapMode, tapAutomaticAllowed: automaticTapAllowed(), hiddenSurfaces: hiddenSurfaces(), tapCooldownSeconds: program?.tapCooldownSeconds, rewardTitle: reward?.title, rewardCost: reward?.cost };
  if (staff.role === "cashier") return { ...base, stats: undefined, activity: undefined };
  const [memberCount] = program ? await db.select({ count: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.tenantId, tenant.id), eq(memberships.programId, program.id))) : [{ count: 0 }];
  const [totals] = await db.select({ awards: sql<number>`count(*) filter (where ${ledgerEntries.kind} = 'award')::int`, redemptions: sql<number>`count(*) filter (where ${ledgerEntries.kind} = 'redeem')::int` }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenantId, tenant.id), eq(ledgerEntries.locationId, location.id)));
  const entries = await db.select({ id: ledgerEntries.id, kind: ledgerEntries.kind, delta: ledgerEntries.delta, createdAt: ledgerEntries.createdAt, cardLocator: memberships.cardLocator }).from(ledgerEntries)
    .innerJoin(memberships, and(eq(memberships.id, ledgerEntries.membershipId), eq(memberships.tenantId, ledgerEntries.tenantId)))
    .where(and(eq(ledgerEntries.tenantId, tenant.id), eq(ledgerEntries.locationId, location.id)))
    .orderBy(desc(ledgerEntries.createdAt)).limit(10);
  return { ...base, stats: { members: memberCount.count, awards: totals.awards, redemptions: totals.redemptions, periodLabel: "Seit Programmstart" }, activity: entries.map((entry) => ({ id: entry.id, kind: entry.kind === "redeem" ? "redemption" : entry.kind, occurredAt: entry.createdAt.toLocaleString(tenant.locale === "fr" ? "fr-FR" : "de-DE", { timeZone: location.timezone }), amount: Math.abs(entry.delta), unit: program?.type === "points" ? "Punkte" : "Stempel", reference: `Karte ${formatCardLocator(entry.cardLocator)}` })) };
}
