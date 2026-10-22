import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { billingLocationPlans, consentEvents, ledgerEntries, locations, membershipContacts, memberships, programRuleVersions, programs, purchaseAwards, rewardVersions, rewards, staffInvites, staffRoles, subscriptions, tenants } from "@/db/schema";
import { birthdayState, DomainError, winbackState } from "./loyalty";
import { validCardToken } from "./card-lifecycle";
import { formatCardLocator, isScanCodeInput, parseCardLocator } from "./card-locator";
import { draftPriceMinor } from "./pricing";
import { MAX_POINTS_PER_CURRENCY_UNIT } from "./points";
import { publicReferralTerms, recordReferralAttribution } from "./referrals";
import { automaticTapAllowed } from "./pilot-policy";
import { activeHappyHour, happyHourProblem, type HappyHourWindow } from "./happy-hour";
import { CHALLENGE_VISITS, challengeBonusRange, challengeFor, challengeSentence, cardNewsProblem, monthOf, nextMonthStart, pendingChallenge, LEVEL_WINDOW_DAYS, levelFor, levelPerkProblem, REVIEW_AFTER_VISITS, reviewUrlValid } from "./card-extras";
import { challengeProgress, recentVisitDays } from "./challenges";
import { hiddenSurfaces, surfaceHidden } from "./pilot-surfaces";
import { birthdayRule, winbackRule } from "./wallet-message-rules";
import { enqueueWalletProgramRefresh } from "./wallet/enqueue";
import { cardExpiry } from "./points-expiry";
import { expiryRuleText, POINTS_EXPIRY_MONTHS } from "./points-expiry-rules";

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
export function slugOf(name: string) { return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "lokal"; }
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
      if (await awaitsSetup(tx, tenant.id)) {
        // A shop the operator created (ENG-047): the owner's answers replace the operator's draft, then the programme starts.
        await tx.update(tenants).set({ name: input.businessName, currency: input.currency, locale: input.locale }).where(eq(tenants.id, tenant.id));
        const [updated] = await tx.update(locations).set({ name: input.locationName ?? input.businessName, city: input.city, country: input.country, timezone: input.timezone, contactEmail: input.contactEmail, brandColor: input.brandColor, logoData, latitude: input.latitude, longitude: input.longitude })
          .where(and(eq(locations.id, location.id), eq(locations.tenantId, tenant.id))).returning();
        return startProgramme(tx, tenant.id, updated, input, earningMode);
      }
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
    return startProgramme(tx, tenant.id, location, input, earningMode);
  });
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A shop the operator created (its owner accepted an owner invitation) with no programme and no subscription yet: the
 * assistant finishes it. Any other half-made shop keeps the explicit setup error.
 */
async function awaitsSetup(tx: Transaction | typeof db, tenantId: string) {
  const [row] = await tx.select({ waiting: sql<boolean>`exists (select 1 from ${staffInvites} where ${staffInvites.tenantId} = ${tenantId} and ${staffInvites.role} = 'owner' and ${staffInvites.acceptedAt} is not null)
    and not exists (select 1 from ${programs} where ${programs.tenantId} = ${tenantId}) and not exists (select 1 from ${subscriptions} where ${subscriptions.tenantId} = ${tenantId})` }).from(tenants).where(eq(tenants.id, tenantId));
  return row?.waiting === true;
}

async function startProgramme(tx: Transaction, tenantId: string, location: typeof locations.$inferSelect, input: z.output<typeof merchantInput>, earningMode: "manual" | "purchase") {
  const suffix = randomCode(5).toLowerCase().replace(/[^a-z0-9]/g, "");
  const [program] = await tx.insert(programs).values({ tenantId, locationId: location.id, slug: `${slugOf(input.programName)}-${suffix}`, name: input.programName, type: input.programType, earningMode, pointsPerCurrencyUnit: input.pointsPerCurrencyUnit ?? 1, rulesText: input.rulesText, effectiveAt: input.effectiveDate ? new Date(`${input.effectiveDate}T00:00:00Z`) : undefined }).returning();
  await tx.insert(programRuleVersions).values({ tenantId, programId: program.id, version: 1, name: program.name, type: program.type, rulesText: program.rulesText, earningMode: program.earningMode, pointsPerCurrencyUnit: program.pointsPerCurrencyUnit, effectiveAt: program.effectiveAt });
  const [reward] = await tx.insert(rewards).values({ tenantId, programId: program.id }).returning();
  await tx.insert(rewardVersions).values({ tenantId, rewardId: reward.id, version: 1, title: input.rewardTitle, cost: input.rewardCost });
  const priceMinor = draftPriceMinor(input.currency);
  await tx.insert(subscriptions).values({ tenantId, currency: input.currency, priceMinor });
  await tx.insert(billingLocationPlans).values({ tenantId, locationId: location.id, currency: input.currency, priceMinor });
  return { tenantId, locationId: location.id, programId: program.id, programSlug: program.slug, city: location.city, programType: program.type };
}

/** What the operator entered for a shop still waiting for its owner's assistant, to prefill it; null for any other account. */
export async function setupDraft(userId: string) {
  const [row] = await db.select({ tenantId: tenants.id, businessName: tenants.name, locationName: locations.name, city: locations.city, country: locations.country, timezone: locations.timezone, locale: tenants.locale })
    .from(staffRoles).innerJoin(tenants, eq(tenants.id, staffRoles.tenantId)).innerJoin(locations, eq(locations.tenantId, staffRoles.tenantId))
    .where(and(eq(staffRoles.userId, userId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!row || !await awaitsSetup(db, row.tenantId)) return null;
  return { businessName: row.businessName, locationName: row.locationName, city: row.city, country: row.country, timezone: row.timezone, locale: row.locale };
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
      // A welcome bonus is sized for one programme type (up to 3 stamps or 50 points); a type change switches it off.
      await tx.update(programs).set({ name: input.name, rulesText: input.rulesText, type: nextType, earningMode, pointsPerCurrencyUnit, ...(nextType !== program.type ? { welcomeBonus: 0, happyHourEnabled: false, winbackBonus: Math.min(1, program.winbackBonus), birthdayBonus: Math.min(1, program.birthdayBonus), pointsExpiryMonths: null, pointsExpirySince: null, challengeVisits: null, challengeNextFrom: null, challengeNextVisits: null, challengeNextBonus: null } : {}) }).where(eq(programs.id, program.id));
      await tx.insert(programRuleVersions).values({ tenantId: program.tenantId, programId: program.id, version: latestRule.version + 1, name: input.name, type: nextType, rulesText: input.rulesText, earningMode, pointsPerCurrencyUnit });
      await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
    }
    return { programSlug: program.slug, programType: nextType, ruleVersion: latestRule.version + Number(ruleChanged) };
  });
}

const programExtrasInput = z.object({
  actorUserId: z.string().min(1),
  programId: z.uuid(),
  welcomeBonus: z.number().int().min(0).max(50).optional(),
  cardNews: z.string().max(1000).optional(),
  reviewUrl: z.string().max(1000).optional(),
  /** Months after which earned points expire; null switches it off. */
  pointsExpiryMonths: z.union([z.literal(POINTS_EXPIRY_MONTHS), z.null()]).optional(),
  /** Monthly challenge: visit days per calendar month (null = off) and the bonus booked once when they are reached. */
  challengeVisits: z.number().int().min(CHALLENGE_VISITS.min).max(CHALLENGE_VISITS.max).nullable().optional(),
  challengeBonus: z.number().int().min(1).max(25000).optional(),
  /** Customer levels: Silber and Gold thresholds (visit days in 90 days) and one perk text per level. */
  levelsEnabled: z.boolean().optional(),
  levelSilverVisits: z.number().int().min(2).max(50).optional(),
  levelGoldVisits: z.number().int().min(3).max(90).optional(),
  levelBronzePerk: z.string().max(200).optional(),
  levelSilverPerk: z.string().max(200).optional(),
  levelGoldPerk: z.string().max(200).optional(),
  /** Average spend per visit in minor units for the estimated results figure; null clears it. */
  averageVisitSpendMinor: z.number().int().min(1).max(100000).nullable().optional(),
}).strict();

/** Owner-only programme settings outside the versioned earning rule. */
export async function updateProgramExtras(raw: z.input<typeof programExtrasInput>, now = new Date()) {
  const input = programExtrasInput.parse(raw);
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(programs).where(and(eq(programs.id, input.programId), eq(programs.status, "active"))).for("update");
    if (!program) throw new DomainError("NOT_FOUND", "Program not found");
    const [owner] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, input.actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
    if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
    if (input.welcomeBonus !== undefined && input.welcomeBonus > (program.type === "stamp" ? 3 : 50)) throw new DomainError("INVALID_WELCOME_BONUS", "Welcome bonus is 0 to 3 stamps or 0 to 50 points");
    const cardNews = input.cardNews?.trim();
    if (cardNews !== undefined && cardNewsProblem(cardNews)) throw new DomainError("INVALID_CARD_NEWS", "Card news is plain text, at most 140 characters, without links");
    const reviewUrl = input.reviewUrl === undefined ? program.reviewUrl : input.reviewUrl.trim() || null;
    if (reviewUrl !== null && !reviewUrlValid(reviewUrl)) throw new DomainError("INVALID_REVIEW_URL", "Review link must be an https Google link (g.page, google.com/maps or search.google.com/local/writereview)");
    if (input.pointsExpiryMonths && program.type !== "points") throw new DomainError("INVALID_POINTS_EXPIRY", "Points expiry needs a points programme");
    // A new or changed period applies only to points earned from now on: earlier points were collected under the old rule.
    const expiry = input.pointsExpiryMonths === undefined || input.pointsExpiryMonths === program.pointsExpiryMonths ? {}
      : { pointsExpiryMonths: input.pointsExpiryMonths, pointsExpirySince: input.pointsExpiryMonths ? sql`now()` : null };
    // ENG-065: a running challenge changes from the next calendar month (location time); this month keeps the terms the
    // card shows. Switching on a challenge that is off starts at once. Saving folds a pending change that has started in.
    const [{ timezone }] = await tx.select({ timezone: locations.timezone }).from(locations).where(and(eq(locations.id, program.locationId), eq(locations.tenantId, program.tenantId)));
    const month = monthOf(now, timezone);
    const current = challengeFor(program, month);
    const latest = pendingChallenge(program, month) ?? current;
    const challengeVisits = input.challengeVisits === undefined ? latest.visits : input.challengeVisits;
    const challengeBonus = input.challengeBonus ?? latest.bonus ?? current.bonus;
    const challenge = current.visits === null || (challengeVisits === current.visits && challengeBonus === current.bonus)
      ? { challengeVisits, challengeBonus, challengeNextFrom: null, challengeNextVisits: null, challengeNextBonus: null }
      : { challengeVisits: current.visits, challengeBonus: current.bonus, challengeNextFrom: nextMonthStart(month), challengeNextVisits: challengeVisits, challengeNextBonus: challengeVisits === null ? null : challengeBonus };
    if (challengeVisits !== null) {
      // shortcut: checked when the owner saves; a cheaper reward added later does not re-check the bonus. Re-check on reward changes if owners hit it.
      const cheapest = Math.min(...(await currentRewards(program.tenantId, program.id, tx)).map(reward => reward.cost));
      const range = challengeBonusRange(program.type, cheapest);
      if (challengeBonus < range.min || challengeBonus > range.max) throw new DomainError("INVALID_CHALLENGE", range.max < 1 ? "Der Punkte-Bonus braucht eine Prämie ab 4 Punkten." : `Bonus: ${range.min} bis ${range.max} ${program.type === "stamp" ? "Stempel" : "Punkte"} (bei Punkten höchstens ein Viertel der günstigsten Prämie).`);
    }
    const levels = {
      levelsEnabled: input.levelsEnabled ?? program.levelsEnabled,
      levelSilverVisits: input.levelSilverVisits ?? program.levelSilverVisits,
      levelGoldVisits: input.levelGoldVisits ?? program.levelGoldVisits,
      levelBronzePerk: input.levelBronzePerk?.trim() ?? program.levelBronzePerk,
      levelSilverPerk: input.levelSilverPerk?.trim() ?? program.levelSilverPerk,
      levelGoldPerk: input.levelGoldPerk?.trim() ?? program.levelGoldPerk,
    };
    if (levels.levelsEnabled && (levels.levelSilverVisits === null || levels.levelGoldVisits === null)) throw new DomainError("INVALID_LEVELS", "Bitte lege fest, ab wie vielen Besuchen Silber und Gold gelten.");
    if (levels.levelSilverVisits !== null && levels.levelGoldVisits !== null && levels.levelGoldVisits <= levels.levelSilverVisits) throw new DomainError("INVALID_LEVELS", "Gold braucht mehr Besuche als Silber.");
    if ([levels.levelBronzePerk, levels.levelSilverPerk, levels.levelGoldPerk].some(levelPerkProblem)) throw new DomainError("INVALID_LEVELS", "Ein Vorteil ist reiner Text, höchstens 60 Zeichen, ohne Links.");
    const [updated] = await tx.update(programs).set({ welcomeBonus: input.welcomeBonus ?? program.welcomeBonus, cardNews: cardNews ?? program.cardNews, reviewUrl, ...expiry, ...challenge, ...levels, averageVisitSpendMinor: input.averageVisitSpendMinor === undefined ? program.averageVisitSpendMinor : input.averageVisitSpendMinor }).where(eq(programs.id, program.id)).returning();
    return { welcomeBonus: updated.welcomeBonus, cardNews: updated.cardNews, reviewUrl: updated.reviewUrl, pointsExpiryMonths: updated.pointsExpiryMonths, challengeVisits: updated.challengeVisits, challengeBonus: updated.challengeBonus, challengeNext: pendingChallenge(updated, month),
      levelsEnabled: updated.levelsEnabled, levelSilverVisits: updated.levelSilverVisits, levelGoldVisits: updated.levelGoldVisits, levelBronzePerk: updated.levelBronzePerk, levelSilverPerk: updated.levelSilverPerk, levelGoldPerk: updated.levelGoldPerk, averageVisitSpendMinor: updated.averageVisitSpendMinor };
  });
}

const happyHourInput = z.object({
  actorUserId: z.string().min(1),
  programId: z.uuid(),
  happyHourEnabled: z.boolean(),
  happyHourWindows: z.array(z.unknown()).max(3),
}).strict();

/** Owner-only: the programme's happy-hour switch and windows. Points programmes only; windows are checked as a whole. */
export async function updateProgramHappyHour(raw: z.input<typeof happyHourInput>) {
  const input = happyHourInput.parse(raw);
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(programs).where(and(eq(programs.id, input.programId), eq(programs.status, "active"))).for("update");
    if (!program) throw new DomainError("NOT_FOUND", "Program not found");
    const [owner] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, input.actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
    if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
    if (happyHourProblem(input.happyHourWindows)) throw new DomainError("INVALID_HAPPY_HOUR", "Happy hour: up to 3 weekly windows with weekdays, start and end time (HH:MM), each ending after it starts the same day (midnight-crossing windows are not supported)");
    if (input.happyHourEnabled && (program.type !== "points" || input.happyHourWindows.length === 0)) throw new DomainError("INVALID_HAPPY_HOUR", "Happy hour needs a points programme and at least one window");
    const [updated] = await tx.update(programs).set({ happyHourEnabled: input.happyHourEnabled, happyHourWindows: input.happyHourWindows as HappyHourWindow[] }).where(eq(programs.id, program.id)).returning();
    return { happyHourEnabled: updated.happyHourEnabled, happyHourWindows: updated.happyHourWindows };
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
export async function currentRewards(tenantId: string, programId: string, reader: Pick<typeof db, "select"> = db) {
  const rows = await reader.select({ reward: rewards, version: rewardVersions }).from(rewards)
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

/** Programme rules as customers see them (card and sign-up): the owner's text, plus the win-back and birthday lines while those bonuses are on (Legal). */
function shownRules(program: typeof programs.$inferSelect) {
  if (surfaceHidden("walletMessages")) return program.rulesText;
  const type = program.type as "stamp" | "points";
  const lines = [program.rulesText];
  if (program.winbackEnabled && program.winbackBonus > 0) lines.push(winbackRule(type, program.winbackDays, program.winbackBonus));
  if (program.birthdayEnabled && program.birthdayBonus > 0) lines.push(birthdayRule(type, program.birthdayBonus));
  return lines.join("\n\n");
}

/** The owner screen's challenge: the terms in force now and a change that starts later („Gilt ab 1.11.“). */
function meChallenge(program: typeof programs.$inferSelect, timeZone: string) {
  const month = monthOf(new Date(), timeZone), current = challengeFor(program, month);
  return { challengeVisits: current.visits, challengeBonus: current.bonus, challengeNext: pendingChallenge(program, month) };
}

/** The card's line for the running month: the challenge and the visit days so far (absent while the shop has none). */
async function cardChallenge(tx: Parameters<typeof challengeProgress>[0], row: { member: typeof memberships.$inferSelect; program: typeof programs.$inferSelect; location: typeof locations.$inferSelect }) {
  const now = new Date();
  const rule = challengeFor(row.program, monthOf(now, row.location.timezone));
  if (!rule.visits) return undefined;
  const progress = await challengeProgress(tx, { tenantId: row.member.tenantId, membershipId: row.member.id, locationId: row.program.locationId, at: now });
  const month = new Intl.DateTimeFormat("de-DE", { month: "long", timeZone: row.location.timezone }).format(now);
  const [year, monthNumber] = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: row.location.timezone }).format(now).split("-").map(Number);
  const endsOn = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNumber, 0)));
  return { ...challengeSentence(rule.visits, rule.bonus, row.program.type, month, endsOn), visits: Math.min(progress.visits, rule.visits), target: rule.visits, done: progress.bonuses.length > 0 };
}

/** The card's level from visit days in the last 90 days, its perk and the next step; absent while levels are off. */
async function cardLevel(tx: Parameters<typeof recentVisitDays>[0], member: typeof memberships.$inferSelect, program: typeof programs.$inferSelect) {
  const { levelSilverVisits: silver, levelGoldVisits: gold } = program;
  if (!program.levelsEnabled || silver === null || gold === null) return undefined;
  const days = await recentVisitDays(tx, { tenantId: member.tenantId, membershipId: member.id, locationId: program.locationId, days: LEVEL_WINDOW_DAYS });
  const visits = days.length;
  const name = levelFor(visits, silver, gold);
  const perk = name === "Gold" ? program.levelGoldPerk : name === "Silber" ? program.levelSilverPerk : name === "Bronze" ? program.levelBronzePerk : "";
  // „Gold bis …“ (Legal): the level drops when its deciding visit day (the gold-th newest) leaves the 90 days.
  const until = name ? days[(name === "Gold" ? gold : name === "Silber" ? silver : 1) - 1] : undefined;
  const next = name === "Gold" ? null : name === "Silber" ? { name: "Gold", visits: gold - visits } : { name: "Silber", visits: silver - visits };
  return { name, perk: perk || undefined, until, visits, next };
}

export async function getCard(token: string) {
  if (!validCardToken(token)) throw new DomainError("NOT_FOUND", "Card not found");
  // Balance, recent activity and reward progress must describe one committed state.
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ member: memberships, program: programs, location: locations, tenant: tenants })
      .from(memberships)
      .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
      .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.cardToken, token), sql`${memberships.closedAt} is null`));
    if (!row) throw new DomainError("NOT_FOUND", "Card not found");
    const activity = await tx.select({ delta: ledgerEntries.delta, kind: ledgerEntries.kind, source: ledgerEntries.source, createdAt: ledgerEntries.createdAt, purchaseLedgerId: purchaseAwards.ledgerEntryId }).from(ledgerEntries)
      .leftJoin(purchaseAwards, and(eq(purchaseAwards.ledgerEntryId, ledgerEntries.id), eq(purchaseAwards.tenantId, ledgerEntries.tenantId)))
      .where(and(eq(ledgerEntries.tenantId, row.member.tenantId), eq(ledgerEntries.membershipId, row.member.id)))
      .orderBy(desc(ledgerEntries.createdAt)).limit(10);
    // The review link is only a link: no reward, stamp, points or draw is ever tied to it.
    const [visits] = row.program.reviewUrl ? await tx.select({ count: sql<number>`count(*)::int` }).from(ledgerEntries).where(and(
      eq(ledgerEntries.tenantId, row.member.tenantId), eq(ledgerEntries.membershipId, row.member.id), eq(ledgerEntries.kind, "award"),
      sql`${ledgerEntries.source} in ('staff_online','staff_offline')`,
      sql`not exists (select 1 from ledger_entries undo where undo.tenant_id = ${ledgerEntries.tenantId} and undo.reversal_of_id = ${ledgerEntries.id})`)) : [{ count: 0 }];
    return { programId: row.program.id, scanCode: row.member.scanCode, cardLocator: formatCardLocator(row.member.cardLocator), balance: row.member.balance, merchantName: row.tenant.name, locationName: row.location.name, programName: row.program.name, programType: row.program.type, earningMode: row.program.earningMode, locale: row.tenant.locale, brandColor: row.location.brandColor, endsOn: row.program.cancellationConfirmedAt ? row.program.cancellationEndDate ?? undefined : undefined, rulesText: shownRules(row.program), news: row.program.cardNews || undefined, happyHourUntil: row.program.earningMode === "purchase" && row.program.type === "points" && row.program.happyHourEnabled ? activeHappyHour(row.program.happyHourWindows, new Date(), row.location.timezone)?.end : undefined, reviewUrl: row.program.reviewUrl && visits.count >= REVIEW_AFTER_VISITS ? row.program.reviewUrl : undefined, pointsExpiry: await cardExpiry(tx, row.member.tenantId, row.member.id, row.program, row.location.timezone), challenge: await cardChallenge(tx, row), level: await cardLevel(tx, row.member, row.program), rewards: await currentRewards(row.member.tenantId, row.program.id, tx), activity: activity.map(({ purchaseLedgerId, source, ...entry }) => ({ ...entry, isPurchase: purchaseLedgerId !== null, isWelcomeBonus: source === "welcome_bonus", isHappyHour: source === "happy_hour", isWinbackBonus: source === "winback_bonus", isBirthdayBonus: source === "birthday_bonus", isChallengeBonus: source === "challenge_bonus" })) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
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
  return { stage: "open" as const, membershipId: member.id, cardLocator: formatCardLocator(member.cardLocator), matchedBy: by, balance: member.balance, programType: program.type, earningMode: program.earningMode, pointsPerCurrencyUnit: program.pointsPerCurrencyUnit, currency: tenant.currency, ruleVersionId: rule.id, rewards: await currentRewards(member.tenantId, program.id), winbackBonus: program.winbackBonus > 0 && (await winbackState(db, member.id, new Date())) ? program.winbackBonus : 0, birthdayBonus: program.birthdayBonus > 0 && (await birthdayState(db, member.id, new Date())) ? program.birthdayBonus : 0, level: await cardLevel(db, member, program) };
}

export async function getPublicProgram(slug: string) {
  const [row] = await db.select({ program: programs, location: locations, tenant: tenants, active: sql<boolean>`${programs.effectiveAt} <= now()` }).from(programs)
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, programs.tenantId))
    .where(and(eq(programs.slug, slug), eq(programs.status, "active")));
  if (!row) throw new DomainError("NOT_FOUND", "Program not found");
  const rewardList = await currentRewards(row.tenant.id, row.program.id);
  const [reward] = rewardList;
  return { businessName: row.tenant.name, locationName: row.location.name, programName: row.program.name, programType: row.program.type, earningMode: row.program.earningMode, pointsPerCurrencyUnit: row.program.pointsPerCurrencyUnit, currency: row.tenant.currency, locale: row.tenant.locale, rulesText: shownRules(row.program), pointsExpiryRule: row.program.pointsExpiryMonths ? expiryRuleText(row.program.pointsExpiryMonths) : undefined, rewards: rewardList, rewardTitle: reward?.title, rewardCost: reward?.cost, brandColor: row.location.brandColor, active: row.active, referral: await publicReferralTerms(row.tenant.id, row.program.id) };
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
  let [location] = await db.select().from(locations).where(and(eq(locations.tenantId, staff.tenantId), targetLocationId ? eq(locations.id, targetLocationId) : sql`true`)).orderBy(asc(locations.createdAt), asc(locations.id)).limit(1);
  if (staff.role === "owner" && selectedLocationId && !location) throw new DomainError("NOT_FOUND", "Der gewählte Standort ist nicht verfügbar. Bitte wende dich an den Support.");
  if (!tenant || !location) throw new DomainError("SETUP_INCOMPLETE", SETUP_INCOMPLETE);
  let [program] = await db.select().from(programs).where(and(eq(programs.tenantId, tenant.id), eq(programs.locationId, location.id), eq(programs.status, "active"))).limit(1);
  if (!program) {
    const [ended] = await db.select({ id: programs.id }).from(programs).where(and(eq(programs.tenantId, tenant.id), eq(programs.locationId, location.id), eq(programs.status, "ended"))).limit(1);
    if (ended && staff.role === "owner") {
      // An owner whose location (oldest, or selected) has ended works in the oldest location that still runs a programme.
      const [running] = await db.select({ location: locations, program: programs }).from(programs)
        .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
        .where(and(eq(programs.tenantId, tenant.id), eq(programs.status, "active"))).orderBy(asc(locations.createdAt), asc(locations.id)).limit(1);
      if (running) ({ location, program } = running);
    }
    // The owner of a shop the operator created has no programme yet: like an identity-only account, the assistant comes next.
    if (!ended && staff.role === "owner" && await awaitsSetup(db, tenant.id)) return null;
    if (!program) throw new DomainError(ended ? "PROGRAM_ENDED" : "SETUP_INCOMPLETE", ended ? "Programm beendet" : SETUP_INCOMPLETE);
  }
  const [reward] = program ? await currentRewards(tenant.id, program.id) : [];
  const base = { userId, tenantId: tenant.id, locationId: location.id, role: staff.role, businessName: tenant.name, locationName: location.name, locale: tenant.locale, programId: program?.id, programSlug: program?.slug, programType: program?.type, tapMode: program?.tapMode, tapAutomaticAllowed: automaticTapAllowed(), hiddenSurfaces: hiddenSurfaces(), tapCooldownSeconds: program?.tapCooldownSeconds, welcomeBonus: program.welcomeBonus, cardNews: program.cardNews, reviewUrl: program.reviewUrl, cancellationEndDate: program.cancellationEndDate, happyHourEnabled: program.happyHourEnabled, happyHourWindows: program.happyHourWindows, pointsExpiryMonths: program.pointsExpiryMonths, ...meChallenge(program, location.timezone), levelsEnabled: program.levelsEnabled, levelSilverVisits: program.levelSilverVisits, levelGoldVisits: program.levelGoldVisits, levelBronzePerk: program.levelBronzePerk, levelSilverPerk: program.levelSilverPerk, levelGoldPerk: program.levelGoldPerk, averageVisitSpendMinor: program.averageVisitSpendMinor, rewardTitle: reward?.title, rewardCost: reward?.cost };
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
