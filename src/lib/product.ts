import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { placeId } from "./place-search";
import type { PgInsertValue } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { billingLocationPlans, consentEvents, ledgerEntries, locations, membershipContacts, memberships, ownerAcceptances, programRuleVersions, programs, purchaseAwards, rewardVersions, rewards, staffInvites, staffRoles, subscriptions, tenants, walletMessageConsents } from "@/db/schema";
import { birthdayState, DomainError, welcomeBonusDue, winbackState } from "./loyalty";
import { SHOP_NAME_REFUSAL, unsafeShopName } from "./sender-details";
import { validCardToken } from "./card-lifecycle";
import { formatCardLocator, isScanCodeInput, parseCardLocator } from "./card-locator";
import { draftPriceMinor } from "./pricing";
import { byPurchase, checkRulesText, MAX_POINTS_PER_CURRENCY_UNIT, purchaseRuleSentence, REWARD_COST_MAX } from "./points";
import { publicReferralTerms, recordReferralAttribution } from "./referrals";
import { automaticTapAllowed } from "./pilot-policy";
import { activeHappyHour, happyHourProblem, type HappyHourWindow } from "./happy-hour";
import { CHALLENGE_VISITS, challengeBonusRange, challengeFor, challengeSentence, cardNewsProblem, monthOf, nextMonthStart, pendingChallenge, LEVEL_WINDOW_DAYS, levelFor, levelPerkProblem, REVIEW_AFTER_VISITS, reviewUrlValid } from "./card-extras";
import { challengeProgress, recentVisitDays } from "./challenges";
import { hiddenSurfaces, surfaceHidden } from "./pilot-surfaces";
import { germanDate } from "./programme-end-date";
import { birthdayRule, contentRefusal, JOIN_CONSENT_TEXT_VERSION, winbackRule } from "./wallet-message-rules";
import { enqueueWalletProgramRefresh, scheduleWalletProgramRefresh } from "./wallet/enqueue";
import { walletAvailability } from "./wallet/capability";
import { passFastEnv } from "./wallet/template-bindings";
import { liveReward, noticeEnd, notSuperseded, savedAt } from "./reward-versions";
import { expiryWaits, programInForce, ruleVersions } from "./rule-versions";
import { cardExpiry } from "./points-expiry";
import { expiryRuleText, POINTS_EXPIRY_MONTHS } from "./points-expiry-rules";
import { withUnit } from "./units";
import { checkedLogoUpload } from "./wallet/logo-process";
import { ownerTenant } from "./billing";
import { DEMO_CONSENT_TEXT_VERSION, demoConsentText, shopDemo } from "./demo-texts";
import { experienceFlag } from "./experience-flags";

const shortText = z.string().trim().min(2).max(180);
export const merchantInput = z.object({
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
  rulesText: z.string().trim().max(3000), // its minimum depends on the earning: checkRulesText
  rewardTitle: shortText,
  rewardCost: z.number().int().min(1).max(REWARD_COST_MAX),
  contactEmail: z.email().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  googlePlaceId: placeId.optional(), // the shop search's pick (ENG-323); never its name or address
  logoData: z.string().max(3_000_000).optional(),
  effectiveDate: z.iso.date().optional(),
});

const placeFields = ({ googlePlaceId }: { googlePlaceId?: string }) => googlePlaceId ? { googlePlaceId, placeLocationFetchedAt: new Date() } : {};
function randomCode(bytes: number) { return randomBytes(bytes).toString("base64url"); }
const ACCEPTANCE_MISSING = "Mit diesem Konto kannst du kein Geschäft einrichten, weil die Vertragsbedingungen nicht angenommen sind. Erstelle dein Konto über „Konto erstellen“.";
const SETUP_INCOMPLETE = "Die Einrichtung deines Geschäfts ist unvollständig. Bitte wende dich an den Support. Starte keine neue Einrichtung.";
const ACCESS_REVOKED = "Dein Zugang wurde entzogen. Bitte wende dich an die Inhaberin oder den Inhaber.";
export function slugOf(name: string) { return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "lokal"; }
/** `newShop: false` (the setup route while public registration is closed): an account without a role gets no shop of its own; only the owner of a shop the operator created finishes its setup.
 *  `requireAcceptance` (the setup route while it is open, ENG-277): a new shop only for an account that accepted the terms at /register.
 *  Only an invited owner (operator-made shop, paper contract) skips it, through the existing-owner branch; staff never get a shop. */
export async function createMerchant(raw: z.input<typeof merchantInput>, { newShop = true, requireAcceptance = false } = {}) {
  const input = merchantInput.parse(raw);
  if (unsafeShopName(input.businessName)) throw new DomainError("INVALID_SHOP_NAME", SHOP_NAME_REFUSAL);
  const earningMode = input.earningMode ?? "manual";
  if (input.programType === "stamp" && earningMode !== "manual") throw new DomainError("INVALID_EARNING_MODE", "Stamp programmes use manual earning");
  checkRulesText(input.programType, earningMode, input.rulesText);
  try { new Intl.DateTimeFormat("de", { timeZone: input.timezone }); } catch { throw new DomainError("INVALID_TIMEZONE", "Unknown timezone"); }
  if ((input.country === "DE" && input.currency !== "EUR") || (input.country === "MA" && input.currency !== "MAD")) throw new DomainError("INVALID_CURRENCY", "Currency and country differ");
  if ((input.latitude === undefined) !== (input.longitude === undefined) || (input.googlePlaceId && input.latitude === undefined)) throw new DomainError("INVALID_COORDINATES", "Latitude and longitude are required together");
  // Decoding a large logo costs real memory, so it waits until the account may set up this shop.
  const logo = async () => input.logoData ? checkedLogoUpload(input.logoData) : null;
  return db.transaction(async (tx) => {
    // Serialize retries for this authenticated identity, including the first
    // request before a staff row exists. No provisioning happens in auth hooks.
    await tx.execute(sql`select id from "user" where id = ${input.userId} for update`);
    const [existing] = await tx.select().from(staffRoles).where(eq(staffRoles.userId, input.userId)).limit(1).for("update");
    if (existing) {
      if (!existing.active) throw new DomainError("FORBIDDEN", ACCESS_REVOKED);
      if (existing.role !== "owner") throw new DomainError("FORBIDDEN", "Dein Konto gehört schon zu einem Team. Mit diesem Konto kannst du kein eigenes Geschäft einrichten.");
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, existing.tenantId)).for("update");
      const ownedLocations = await tx.select().from(locations).where(eq(locations.tenantId, existing.tenantId)).limit(2);
      if (ownedLocations.length > 1) throw new DomainError("ALREADY_ONBOARDED", "Dein Geschäft ist bereits eingerichtet. Öffne die Übersicht und wähle dort den gewünschten Standort.");
      const [location] = ownedLocations;
      if (!tenant || !location) throw new DomainError("SETUP_INCOMPLETE", SETUP_INCOMPLETE);
      if (await awaitsSetup(tx, tenant.id)) {
        // A shop the operator created (ENG-047): the owner's answers replace the operator's draft, then the programme starts.
        const logoData = await logo();
        await tx.update(tenants).set({ name: input.businessName, currency: input.currency, locale: input.locale }).where(eq(tenants.id, tenant.id));
        const [updated] = await tx.update(locations).set({ name: input.locationName ?? input.businessName, city: input.city, country: input.country, timezone: input.timezone, contactEmail: input.contactEmail, brandColor: input.brandColor, logoData, latitude: input.latitude, longitude: input.longitude, ...placeFields(input) })
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
    if (!newShop) throw new DomainError("FORBIDDEN", "Mit diesem Konto kannst du kein Geschäft einrichten. Nimm zuerst deine Einladung an.");
    if (requireAcceptance && !(await tx.select({ id: ownerAcceptances.id }).from(ownerAcceptances).where(eq(ownerAcceptances.userId, input.userId)).limit(1)).length) throw new DomainError("FORBIDDEN", ACCEPTANCE_MISSING);
    const { tenant, location } = await insertShop(tx, input, await logo());
    const assigned = await tx.insert(staffRoles).values({ tenantId: tenant.id, userId: input.userId, role: "owner" })
      .onConflictDoNothing({ target: staffRoles.userId }).returning({ userId: staffRoles.userId });
    if (!assigned.length) throw new DomainError("ALREADY_ONBOARDED", "Dein Konto wurde bereits einem Geschäft zugeordnet. Lade deinen Bereich neu.");
    // ENG-277: the sign-up acceptance gets its business once the business exists.
    await tx.update(ownerAcceptances).set({ tenantId: tenant.id }).where(and(eq(ownerAcceptances.userId, input.userId), isNull(ownerAcceptances.tenantId)));
    return startProgramme(tx, tenant.id, location, input, earningMode);
  });
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The shop and its first location, as the setup creates them. `slug` is the demo's own (lib/demo); otherwise generated. */
export async function insertShop(tx: Transaction, input: z.output<typeof merchantInput>, logoData: string | null, slug?: string) {
  const suffix = randomCode(5).toLowerCase().replace(/[^a-z0-9]/g, "");
  const [tenant] = await tx.insert(tenants).values({ name: input.businessName, slug: slug ?? `${slugOf(input.businessName)}-${suffix}`, currency: input.currency, locale: input.locale }).returning();
  const [location] = await tx.insert(locations).values({ tenantId: tenant.id, name: input.locationName ?? input.businessName, city: input.city, country: input.country, timezone: input.timezone, contactEmail: input.contactEmail, brandColor: input.brandColor, logoData, latitude: input.latitude, longitude: input.longitude, ...placeFields(input) }).returning();
  return { tenant, location };
}

/** A reward title reaches every pass holder (pass front, reminders), so it follows the Wallet message content rules (Legal,
 *  7 Nov): checked when a title is created or changed; titles already stored are left as they are. */
export function requireAllowedRewardTitle(title: string) {
  const refused = contentRefusal(title);
  if (refused) throw new DomainError("MESSAGE_REFUSED", refused);
}

/**
 * A shop the operator created (its owner accepted an owner invitation) with no programme and no subscription yet: the
 * assistant finishes it. Any other half-made shop keeps the explicit setup error.
 */
async function awaitsSetup(tx: Transaction | typeof db, tenantId: string) {
  const [row] = await tx.select({ waiting: sql<boolean>`exists (select 1 from ${staffInvites} where ${staffInvites.tenantId} = ${tenantId} and ${staffInvites.role} = 'owner' and ${staffInvites.acceptedAt} is not null)
    and not exists (select 1 from ${programs} where ${programs.tenantId} = ${tenantId}) and not exists (select 1 from ${subscriptions} where ${subscriptions.tenantId} = ${tenantId})` }).from(tenants).where(eq(tenants.id, tenantId));
  return row?.waiting === true;
}

export async function startProgramme(tx: Transaction, tenantId: string, location: typeof locations.$inferSelect, input: z.output<typeof merchantInput>, earningMode: "manual" | "purchase") {
  requireAllowedRewardTitle(input.rewardTitle);
  const suffix = randomCode(5).toLowerCase().replace(/[^a-z0-9]/g, "");
  // Never backdated (Legal, ENG-099 3c): a card maps to the rule version in force when it joined. A start date that has
  // begun (today's, by default) counts from now, as every later version does; a future one stays.
  const start = input.effectiveDate ? new Date(`${input.effectiveDate}T00:00:00Z`) : undefined;
  const [program] = await tx.insert(programs).values({ tenantId, locationId: location.id, slug: `${slugOf(input.programName)}-${suffix}`, name: input.programName, type: input.programType, earningMode, pointsPerCurrencyUnit: input.pointsPerCurrencyUnit ?? 1, rulesText: input.rulesText, effectiveAt: start && start > new Date() ? start : undefined }).returning();
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

/** ENG-323 F-1: whether this account may set up a shop now, by createMerchant's gate: the owner of a shop awaiting setup, or,
 *  while sign-up is open, an account without a staff role that accepted the terms. Gates the Google shop search. */
export async function maySetUpShop(userId: string, registrationOpen = process.env.PUBLIC_REGISTRATION_ENABLED === "true") {
  if (await setupDraft(userId)) return true;
  if (!registrationOpen) return false;
  const [staff] = await db.select({ userId: staffRoles.userId }).from(staffRoles).where(eq(staffRoles.userId, userId)).limit(1);
  const [accepted] = staff ? [] : await db.select({ id: ownerAcceptances.id }).from(ownerAcceptances).where(eq(ownerAcceptances.userId, userId)).limit(1);
  return Boolean(accepted);
}

// Every field but the programme is optional: a Programm question posts only its own (ENG-099 N-3), the rest stays as stored.
const updateProgramInput = z.object({
  actorUserId: z.string().min(1),
  programSlug: z.string().min(1).max(120),
  name: shortText.optional(),
  rulesText: z.string().trim().max(3000).optional(), // checked against the resulting programme: checkRulesText
  programType: z.enum(["stamp", "points"]).optional(),
  earningMode: z.enum(["manual", "purchase"]).optional(),
  pointsPerCurrencyUnit: z.number().int().min(1).max(MAX_POINTS_PER_CURRENCY_UNIT).optional(),
  /** The owner's answer whether a changed mode or rules text is worse for customers (ENG-100 W46); no preselect. */
  worse: z.boolean().optional(),
}).strict();

type RuleVersion = typeof programRuleVersions.$inferSelect;
/** A rule version's fields, to copy into a new one (rows are append-only). */
const ruleFields = (v: RuleVersion) => ({ name: v.name, type: v.type, rulesText: v.rulesText, earningMode: v.earningMode, pointsPerCurrencyUnit: v.pointsPerCurrencyUnit, pointsExpiryMonths: v.pointsExpiryMonths, pointsExpirySince: v.pointsExpirySince });
type NewRuleVersion = Omit<PgInsertValue<typeof programRuleVersions>, "tenantId" | "programId" | "version">;
/** Inserts versions `next`, `next + 1`, … created at the save's instant (savedAt), effective then unless dated: none of them
 *  supersedes another (CTO note 1). */
const insertRuleVersions = (tx: Transaction, program: typeof programs.$inferSelect, at: SQL, next: number, rows: NewRuleVersion[]) =>
  tx.insert(programRuleVersions).values(rows.map((row, index) => ({ effectiveAt: at, ...row, createdAt: at, tenantId: program.tenantId, programId: program.id, version: next + index }))).returning();
const RULE_PENDING = () => new DomainError("CHANGE_PENDING", "Für die Regel wartet schon eine Änderung auf ihr Datum. Nimm sie zuerst zurück.");
const EXPIRY_FINAL = () => new DomainError("CHANGE_PENDING", "Diese Änderung kannst du nicht zurücknehmen. Eine neue Änderung geht erst, wenn sie gilt.");

/**
 * ENG-100 D3, compared with the rule version in force: a lower rate within „Nach Einkaufswert“ is dated four weeks on
 * automatically, a higher one applies at once; a mode switch (either direction) or a changed rules text needs the owner's
 * `worse` answer, refused when absent: worse is dated, better applies at once. The programme name always applies at once.
 * One pending change at a time: while one waits, only the name goes through, carried into both the version in force and
 * the waiting one (D2). A type change applies at once, and only while the programme has no card and no booking (Legal).
 * The programmes row is the newest saved (the owner's baseline); customers read the version in force (programInForce).
 */
export async function updateProgram(raw: z.input<typeof updateProgramInput>) {
  const input = updateProgramInput.parse(raw);
  return db.transaction(async (tx) => {
    // The owner first: another shop's programme is never locked, and reads as not there (ENG-197).
    const tenantId = await ownerTenant(input.actorUserId, tx);
    const [program] = await tx.select().from(programs).where(and(eq(programs.slug, input.programSlug), eq(programs.tenantId, tenantId), eq(programs.status, "active"))).for("update");
    if (!program) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
    const name = input.name ?? program.name, rulesText = input.rulesText ?? program.rulesText;
    const nextType = input.programType ?? program.type;
    const earningMode = input.earningMode ?? program.earningMode;
    const pointsPerCurrencyUnit = input.pointsPerCurrencyUnit ?? program.pointsPerCurrencyUnit;
    if (nextType === "stamp" && earningMode !== "manual") throw new DomainError("INVALID_EARNING_MODE", "Stamp programmes use manual earning");
    // The text sent or the stored one: a switch out of points by purchase amount needs the owner's own rule.
    checkRulesText(nextType, earningMode, rulesText);
    if (nextType !== program.type) {
      const [activity] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, program.tenantId), eq(ledgerEntries.locationId, program.locationId))).limit(1);
      const [card] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.tenantId, program.tenantId), eq(memberships.programId, program.id))).limit(1);
      if (activity || card) throw new DomainError("TYPE_LOCKED", "Program type cannot change once cards or transactions exist");
    }
    const at = await savedAt(tx);
    const { inForce, pending, next } = await ruleVersions(tx, program, at);
    const ruleChanged = program.rulesText !== rulesText || program.type !== nextType || program.earningMode !== earningMode || program.pointsPerCurrencyUnit !== pointsPerCurrencyUnit;
    if (!ruleChanged && program.name === name) return { programSlug: program.slug, programType: nextType, ruleVersion: next - 1, effectiveAt: null };
    if (pending && ruleChanged) throw RULE_PENDING();
    // Nobody holds a card when the type changes, so nothing there waits for a date.
    const typeChange = nextType !== inForce.type, switched = earningMode !== inForce.earningMode;
    const choice = !typeChange && (switched || rulesText !== inForce.rulesText);
    if (choice && input.worse === undefined) throw new DomainError("CHOICE_REQUIRED", "Sag bitte, ob die neue Regel für deine Kunden schlechter ist.");
    const dated = !typeChange && ((!switched && earningMode === "purchase" && pointsPerCurrencyUnit < inForce.pointsPerCurrencyUnit) || (choice && input.worse === true));
    const expiry = typeChange ? { pointsExpiryMonths: null, pointsExpirySince: null } : { pointsExpiryMonths: program.pointsExpiryMonths, pointsExpirySince: program.pointsExpirySince };
    const versions = pending ? [{ ...ruleFields(inForce), name }, { ...ruleFields(pending), name, effectiveAt: sql`(SELECT effective_at FROM program_rule_versions WHERE id = ${pending.id})` }]
      : [...(dated && name !== inForce.name ? [{ ...ruleFields(inForce), ...expiry, name }] : []), { name, type: nextType, rulesText, earningMode, pointsPerCurrencyUnit, ...expiry, ...(dated ? { effectiveAt: noticeEnd(at) } : {}) }];
    // A welcome bonus is sized for one programme type (up to 3 stamps or 50 points); a type change switches it off.
    await tx.update(programs).set({ name, rulesText, type: nextType, earningMode, pointsPerCurrencyUnit, ...(nextType !== program.type ? { welcomeBonus: 0, happyHourEnabled: false, winbackBonus: Math.min(1, program.winbackBonus), birthdayBonus: Math.min(1, program.birthdayBonus), pointsExpiryMonths: null, pointsExpirySince: null, challengeVisits: null, challengeNextFrom: null, challengeNextVisits: null, challengeNextBonus: null } : {}) }).where(eq(programs.id, program.id));
    const saved = (await insertRuleVersions(tx, program, at, next, versions)).at(-1)!;
    if (dated) await scheduleWalletProgramRefresh(tx, program.tenantId, program.id, noticeEnd(at));
    await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
    return { programSlug: program.slug, programType: nextType, ruleVersion: saved.version, effectiveAt: dated ? saved.effectiveAt : null };
  });
}

/** Cancels the waiting rule or expiry change at once („Änderung zurücknehmen“): a copy of the version in force supersedes
 *  it (D1) and the row returns to it. A pending expiry shortening is final (W59, Legal): its old points already never expire. */
async function takeBackRule(tx: Transaction, program: typeof programs.$inferSelect, at: SQL) {
  const { inForce, pending, next } = await ruleVersions(tx, program, at);
  if (!pending) return false;
  const expiry = expiryWaits(program, pending);
  if (expiry && inForce.pointsExpiryMonths !== null) throw EXPIRY_FINAL();
  await insertRuleVersions(tx, program, at, next, [ruleFields(inForce)]);
  await tx.update(programs).set({ rulesText: inForce.rulesText, earningMode: inForce.earningMode, pointsPerCurrencyUnit: inForce.pointsPerCurrencyUnit, ...(expiry ? { pointsExpiryMonths: null, pointsExpirySince: null } : {}) }).where(eq(programs.id, program.id));
  // A refresh already scheduled for the old date stays: it reads the current state and changes nothing.
  await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
  return true;
}

export async function takeBackRuleChange(raw: { actorUserId: string; programSlug: string }) {
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120) }).parse(raw);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    return { takenBack: await takeBackRule(tx, program, await savedAt(tx)) };
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

/**
 * ENG-100 D4 and Legal: switching expiry on or shortening it is dated, since = four weeks on, and only lots earned from
 * since on expire (earlier ones never do). Switching it off or lengthening applies at once. Every save writes a rule
 * version with the months that apply from its date, and since never moves to an earlier date (Legal). While a change waits the
 * expiry takes no other edit; switching off a waiting switch-on takes it back, a waiting shortening is final (W59).
 */
async function saveExpiry(tx: Transaction, program: typeof programs.$inferSelect, months: (typeof POINTS_EXPIRY_MONTHS)[number] | null) {
  const at = await savedAt(tx); // the caller holds the programme lock
  const { inForce, pending, next } = await ruleVersions(tx, program, at);
  if (pending) {
    if (!expiryWaits(program, pending)) throw RULE_PENDING();
    if (months !== null || inForce.pointsExpiryMonths !== null) throw inForce.pointsExpiryMonths === null ? RULE_PENDING() : EXPIRY_FINAL();
    await takeBackRule(tx, program, at);
    return {};
  }
  const old = program.pointsExpiryMonths, dated = months !== null && (old === null || months < old);
  // At once, a longer period restarts from now as before: points earned until now never expire, which favours customers.
  // GREATEST: since never moves to an earlier date (Legal), whatever the row held.
  const since = (start: SQL) => sql`GREATEST(${start}, ${program.pointsExpirySince})`;
  const expiry = { pointsExpiryMonths: months, pointsExpirySince: months === null ? null : since(dated ? noticeEnd(at) : at) };
  // A version from before 0043 records no expiry: first record the one in force, so a take-back can tell a shortening.
  const versions = [...(dated && inForce.pointsExpiryMonths !== old ? [{ ...ruleFields(inForce), pointsExpiryMonths: old, pointsExpirySince: program.pointsExpirySince }] : []),
    { ...ruleFields(inForce), ...expiry, ...(dated ? { effectiveAt: noticeEnd(at) } : {}) }];
  await insertRuleVersions(tx, program, at, next, versions);
  if (dated) await scheduleWalletProgramRefresh(tx, program.tenantId, program.id, noticeEnd(at));
  await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
  return expiry;
}

/** Owner-only programme settings outside the versioned earning rule. */
export async function updateProgramExtras(raw: z.input<typeof programExtrasInput>, now = new Date()) {
  const input = programExtrasInput.parse(raw);
  return db.transaction(async (tx) => {
    const tenantId = await ownerTenant(input.actorUserId, tx);
    const [program] = await tx.select().from(programs).where(and(eq(programs.id, input.programId), eq(programs.tenantId, tenantId), eq(programs.status, "active"))).for("update");
    if (!program) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
    if (input.welcomeBonus !== undefined && input.welcomeBonus > (program.type === "stamp" ? 3 : 50)) throw new DomainError("INVALID_WELCOME_BONUS", "Welcome bonus is 0 to 3 stamps or 0 to 50 points");
    const cardNews = input.cardNews?.trim();
    if (cardNews !== undefined && cardNewsProblem(cardNews)) throw new DomainError("INVALID_CARD_NEWS", "Card news is plain text, at most 140 characters, without links");
    const reviewUrl = input.reviewUrl === undefined ? program.reviewUrl : input.reviewUrl.trim() || null;
    if (reviewUrl !== null && !reviewUrlValid(reviewUrl)) throw new DomainError("INVALID_REVIEW_URL", "Review link must be an https Google link (g.page, google.com/maps or search.google.com/local/writereview)");
    if (input.pointsExpiryMonths && program.type !== "points") throw new DomainError("INVALID_POINTS_EXPIRY", "Points expiry needs a points programme");
    const expiry = input.pointsExpiryMonths === undefined || input.pointsExpiryMonths === program.pointsExpiryMonths ? {} : await saveExpiry(tx, program, input.pointsExpiryMonths);
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
    // Only a request that sets the challenge checks it, so saving another setting never fails on it (ENG-099 N-3).
    if (challengeVisits !== null && (input.challengeVisits !== undefined || input.challengeBonus !== undefined)) {
      // shortcut: checked when the owner saves; a cheaper reward added later does not re-check the bonus. Re-check on reward changes if owners hit it.
      const cheapest = Math.min(...(await currentRewards(program.tenantId, program.id, tx)).map(reward => reward.cost));
      const range = challengeBonusRange(program.type, cheapest);
      if (challengeBonus < range.min || challengeBonus > range.max) throw new DomainError("INVALID_CHALLENGE", range.max < 1 ? "Der Punkte-Bonus braucht eine Prämie ab 4 Punkten." : `Bonus: ${range.min} bis ${withUnit(range.max, program.type as "stamp" | "points")} (bei Punkten höchstens ein Viertel der günstigsten Prämie).`);
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
    if (levels.levelSilverVisits !== null && levels.levelGoldVisits !== null && levels.levelGoldVisits <= levels.levelSilverVisits) throw new DomainError("INVALID_LEVELS", "Gold braucht mehr Buchungstage als Silber.");
    if ([levels.levelBronzePerk, levels.levelSilverPerk, levels.levelGoldPerk].some(levelPerkProblem)) throw new DomainError("INVALID_LEVELS", "Ein Vorteil ist reiner Text, höchstens 60 Zeichen, ohne Links.");
    const [updated] = await tx.update(programs).set({ welcomeBonus: input.welcomeBonus ?? program.welcomeBonus, cardNews: cardNews ?? program.cardNews, reviewUrl, ...expiry, ...challenge, ...levels, averageVisitSpendMinor: input.averageVisitSpendMinor === undefined ? program.averageVisitSpendMinor : input.averageVisitSpendMinor }).where(eq(programs.id, program.id)).returning();
    // The back of the Apple pass lists the expiry rule (ENG-119): a new period refreshes installed passes, without an alert.
    if ("pointsExpiryMonths" in expiry) await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
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
    const tenantId = await ownerTenant(input.actorUserId, tx);
    const [program] = await tx.select().from(programs).where(and(eq(programs.id, input.programId), eq(programs.tenantId, tenantId), eq(programs.status, "active"))).for("update");
    if (!program) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
    if (happyHourProblem(input.happyHourWindows)) throw new DomainError("INVALID_HAPPY_HOUR", "Happy hour: up to 3 weekly windows with weekdays, start and end time (HH:MM), each ending after it starts the same day (midnight-crossing windows are not supported)");
    if (input.happyHourEnabled && (program.type !== "points" || input.happyHourWindows.length === 0)) throw new DomainError("INVALID_HAPPY_HOUR", "Happy hour needs a points programme and at least one window");
    const [updated] = await tx.update(programs).set({ happyHourEnabled: input.happyHourEnabled, happyHourWindows: input.happyHourWindows as HappyHourWindow[] }).where(eq(programs.id, program.id)).returning();
    return { happyHourEnabled: updated.happyHourEnabled, happyHourWindows: updated.happyHourWindows };
  });
}

export const enrollInput = z.object({
  slug: z.string().min(1).max(120),
  acceptedTerms: z.literal(true),
  referralCode: z.string().regex(/^ref_[A-Za-z0-9_-]{24}$/).optional(),
  email: z.email().optional(),
  marketingOptIn: z.boolean().default(false),
  /** ENG-100 D7: the rule version and reward versions the join page showed (the newest, pending or in force). The join is
   *  refused as stale when they differ. Optional here; the join page always sends them. */
  ruleVersionId: z.uuid().optional(),
  rewardVersionIds: z.array(z.uuid()).max(100).optional(),
  /** ENG-173: the Wallet-message text the guest ticked on the join page; absent = no tick, no consent. */
  walletConsentVersion: z.string().max(40).optional(),
});

/** The newest version (pending, else in force) of each live reward: what a join page shows (D7). */
async function newestRewardVersionIds(reader: Pick<typeof db, "select">, tenantId: string, programId: string) {
  const rows = await reader.select({ id: sql<string>`(SELECT v.id FROM reward_versions v WHERE v.tenant_id = rewards.tenant_id AND v.reward_id = rewards.id AND ${sql.raw(notSuperseded("v"))} ORDER BY v.version DESC LIMIT 1)` })
    .from(rewards).where(and(eq(rewards.tenantId, tenantId), eq(rewards.programId, programId), sql.raw(liveReward("rewards", "now()")))).orderBy(asc(rewards.sortOrder), asc(rewards.id));
  return rows.map(row => row.id);
}

export async function enroll(raw: z.input<typeof enrollInput>) {
  const input = enrollInput.parse(raw);
  if (input.marketingOptIn && !input.email) throw new DomainError("EMAIL_REQUIRED", "An email is needed to receive marketing");
  return db.transaction(async (tx) => {
    // Shared and taken first, as a booking does, so an owner's save (FOR UPDATE, also programme first) cannot commit a
    // new rule or reward version between the staleness check and the card.
    const [program] = await tx.select().from(programs).where(and(eq(programs.slug, input.slug), eq(programs.status, "active"))).for("share");
    if (!program) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
    const [availability] = await tx.select({ active: sql<boolean>`${programs.effectiveAt} <= now()` }).from(programs).where(eq(programs.id, program.id));
    if (!availability.active) throw new DomainError("NOT_AVAILABLE", "Program is not active yet");
    const shownRewards = input.rewardVersionIds && [...input.rewardVersionIds].sort().join();
    if ((input.ruleVersionId && input.ruleVersionId !== (await programInForce(tx, program)).newestRuleVersionId)
      || (shownRewards !== undefined && shownRewards !== (await newestRewardVersionIds(tx, program.tenantId, program.id)).sort().join())) throw new DomainError("STALE_RULE", "Programme rule has changed; refresh and confirm again");
    if (input.walletConsentVersion !== undefined) {
      // A tick counts only for the text shown today, on the German join page, while the surface is on and the location has Apple Wallet.
      const [tenant] = await tx.select({ locale: tenants.locale, name: tenants.name, slug: tenants.slug, createdAt: tenants.createdAt }).from(tenants).where(eq(tenants.id, program.tenantId));
      const appleWallet = walletAvailability(await passFastEnv(program.tenantId, program.locationId, tx), program.tenantId, program.locationId, program.id).apple === "available";
      // A demo shows Legal's demo wording (demo-texts): only its version counts there, and only there.
      const shown = shopDemo(tenant, "UTC") ? DEMO_CONSENT_TEXT_VERSION : JOIN_CONSENT_TEXT_VERSION;
      if (input.walletConsentVersion !== shown || tenant.locale === "fr" || surfaceHidden("walletMessages") || !appleWallet) throw new DomainError("CONSENT_TEXT_CHANGED", "Der Text zum Häkchen hat sich geändert. Bitte lade die Seite neu und lies ihn. Das Häkchen ist freiwillig; deine Karte bekommst du auch ohne.");
    }
    const [plan] = await tx.select().from(billingLocationPlans).where(and(eq(billingLocationPlans.tenantId, program.tenantId), eq(billingLocationPlans.locationId, program.locationId))).for("update");
    if (!plan) throw new DomainError("PLAN_UNAVAILABLE", "Für dieses Geschäft kannst du gerade keine Karte erstellen. Bitte frage im Geschäft nach.");
    const [usage] = await tx.select({ total: sql<number>`count(*)::int` }).from(memberships)
      .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
      .where(and(eq(memberships.tenantId, program.tenantId), eq(programs.locationId, program.locationId), sql`${memberships.closedAt} is null`));
    if (usage.total >= plan.memberLimit) throw new DomainError("PLAN_MEMBER_LIMIT", "This location has reached its card limit");
    const [member] = await tx.insert(memberships).values({ tenantId: program.tenantId, programId: program.id, scanCode: `sc_${randomCode(24)}`, cardToken: `card_${randomCode(32)}` }).returning();
    if (input.referralCode) await recordReferralAttribution(tx, { tenantId: program.tenantId, programId: program.id, referredMembershipId: member.id, referralCode: input.referralCode });
    if (input.email) await tx.insert(membershipContacts).values({ tenantId: program.tenantId, membershipId: member.id, email: input.email.toLowerCase() });
    if (input.marketingOptIn) await tx.insert(consentEvents).values({ tenantId: program.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: true, noticeVersion: "2026-09", source: "enrollment" });
    if (input.walletConsentVersion !== undefined) await tx.insert(walletMessageConsents).values({ tenantId: program.tenantId, membershipId: member.id, textVersion: input.walletConsentVersion });
    return { id: member.id, programId: program.id, cardToken: member.cardToken, cardLocator: formatCardLocator(member.cardLocator), scanCode: member.scanCode };
  });
}

type RewardChange = { effectiveOn: string; title: string; cost: number };
const localDay = (at: SQL) => sql<string>`to_char(${at} AT TIME ZONE ${locations.timezone}, 'YYYY-MM-DD')`;

/** Each reward with its version in force (ENG-100 D1), its pending change and its scheduled end; dates are calendar days
 *  in the location's timezone. `liveOnly` drops archived and ended rewards. */
async function rewardCatalogue(reader: Pick<typeof db, "select">, tenantId: string, programId: string, liveOnly: boolean) {
  const rows = await reader.select({
    reward: rewards, version: rewardVersions, live: sql<boolean>`${sql.raw(liveReward("rewards", "now()"))}`,
    endsOn: sql<string | null>`CASE WHEN ${rewards.endsAt} > now() THEN ${localDay(sql`${rewards.endsAt}`)} END`,
    /** The day a dated archive took effect (owner's „Archivierte Prämien“); null for archives from before ENG-100. */
    endedOn: sql<string | null>`CASE WHEN ${rewards.endsAt} <= now() THEN ${localDay(sql`${rewards.endsAt}`)} END`,
    pending: sql<RewardChange | null>`(SELECT json_build_object('effectiveOn', ${localDay(sql`pv.effective_at`)}, 'title', pv.title, 'cost', pv.cost) FROM reward_versions pv
      WHERE pv.tenant_id = ${rewards.tenantId} AND pv.reward_id = ${rewards.id} AND pv.effective_at > now() AND ${sql.raw(notSuperseded("pv"))} ORDER BY pv.version DESC LIMIT 1)`,
  }).from(rewards)
    .innerJoin(rewardVersions, and(eq(rewardVersions.rewardId, rewards.id), eq(rewardVersions.tenantId, rewards.tenantId)))
    .innerJoin(programs, and(eq(programs.id, rewards.programId), eq(programs.tenantId, rewards.tenantId)))
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .where(and(eq(rewards.tenantId, tenantId), eq(rewards.programId, programId), liveOnly ? sql.raw(liveReward("rewards", "now()")) : undefined,
      sql`${rewardVersions.effectiveAt} <= now()`, sql.raw(notSuperseded("reward_versions"))))
    .orderBy(desc(rewardVersions.version));
  const seen = new Set<string>();
  return rows.filter(({ reward }) => { if (seen.has(reward.id)) return false; seen.add(reward.id); return true; })
    .sort((a, b) => a.reward.sortOrder - b.reward.sortOrder || a.reward.id.localeCompare(b.reward.id));
}

/** Live rewards in the merchant's order, each at its version in force. The browser card and the Wallet pass both show the
 *  first as the target. `pending` and `endsOn` announce a dated change (ENG-100 D8). No conditions text: rewards carry
 *  none on any screen (ENG-115), so it does not travel to cards, join pages or the till. */
export async function currentRewards(tenantId: string, programId: string, reader: Pick<typeof db, "select"> = db) {
  return (await rewardCatalogue(reader, tenantId, programId, true))
    .map(({ reward, version, endsOn, pending }) => ({ id: version.id, rewardId: reward.id, title: version.title, cost: version.cost, sortOrder: reward.sortOrder, endsOn, pending }));
}

const rewardFields = z.object({ title: shortText, cost: z.number().int().min(1).max(100000), termsText: z.string().trim().max(3000).default("") });
const rewardTarget = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120), rewardId: z.uuid() });

async function ownerProgram(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], actorUserId: string, programSlug: string) {
  // The owner first: another shop's programme is never locked, and reads as not there (ENG-197).
  const tenantId = await ownerTenant(actorUserId, tx);
  const [program] = await tx.select().from(programs).where(and(eq(programs.slug, programSlug), eq(programs.tenantId, tenantId), eq(programs.status, "active"))).for("update");
  if (!program) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
  return program;
}

/** A live reward of the owner's programme under an exclusive lock (taken after the programme's), with its version in force,
 *  its pending version and the next version number. One pending change per reward (ENG-100): `waiting` blocks other edits. */
async function ownerReward(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], program: typeof programs.$inferSelect, rewardId: string, at: SQL) {
  const [reward] = await tx.select().from(rewards).where(and(eq(rewards.id, rewardId), eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id), liveReward("rewards", at))).for("update");
  if (!reward) throw new DomainError("NOT_FOUND", "Diese Prämie haben wir nicht gefunden. Bitte lade die Seite neu.");
  const versions = await tx.select({ version: rewardVersions, due: sql<boolean>`${rewardVersions.effectiveAt} <= ${at}`, kept: sql<boolean>`${sql.raw(notSuperseded("reward_versions"))}` })
    .from(rewardVersions).where(and(eq(rewardVersions.tenantId, program.tenantId), eq(rewardVersions.rewardId, reward.id))).orderBy(desc(rewardVersions.version));
  const kept = versions.filter(row => row.kept);
  const inForce = kept.find(row => row.due)?.version;
  if (!inForce) throw new DomainError("NOT_FOUND", "Diese Prämie haben wir nicht gefunden. Bitte lade die Seite neu.");
  const pending = kept[0]?.due ? undefined : kept[0]?.version;
  return { reward, inForce, pending, next: versions[0].version.version + 1, waiting: Boolean(pending || reward.endsAt) };
}
const CHANGE_PENDING = () => new DomainError("CHANGE_PENDING", "Für diese Prämie wartet schon eine Änderung auf ihr Datum. Nimm sie zuerst zurück.");

export async function getMerchantRewards(input: { actorUserId: string; programSlug: string }) {
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    return (await rewardCatalogue(tx, program.tenantId, program.id, false))
      .map(({ reward, version, live, endsOn, endedOn, pending }) => ({ rewardId: reward.id, versionId: version.id, version: version.version, title: version.title, cost: version.cost, termsText: version.termsText, sortOrder: reward.sortOrder, active: live, endsOn, endedOn, pending }));
  });
}

export async function createReward(raw: { actorUserId: string; programSlug: string; title: string; cost: number; termsText?: string }) {
  const input = rewardFields.extend({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120) }).parse(raw);
  requireAllowedRewardTitle(input.title);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const active = await tx.select({ id: rewards.id }).from(rewards).where(and(eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id), sql.raw(liveReward("rewards", "now()"))));
    if (active.length >= 100) throw new DomainError("REWARD_LIMIT", "A programme can have at most 100 active rewards");
    const [highest] = await tx.select({ sortOrder: rewards.sortOrder }).from(rewards).where(and(eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id))).orderBy(desc(rewards.sortOrder)).limit(1);
    const [reward] = await tx.insert(rewards).values({ tenantId: program.tenantId, programId: program.id, sortOrder: (highest?.sortOrder ?? -1) + 1 }).returning();
    const [version] = await tx.insert(rewardVersions).values({ tenantId: program.tenantId, rewardId: reward.id, version: 1, title: input.title, cost: input.cost, termsText: input.termsText }).returning();
    await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
    return { rewardId: reward.id, versionId: version.id };
  });
}

/**
 * A price change, a rename, or both in one call (ENG-100 D3 and Legal). Compared with the version in force: a higher cost
 * is dated automatically, a lower or equal one applies at once. A changed title (or conditions text) needs the owner's
 * `worse` choice, refused when absent: worse is dated, better applies at once. A dated save puts every change of the call
 * into one version effective four weeks on; an at-once save takes created_at = effective_at = the transaction time, so
 * nothing created in the same transaction supersedes it (CTO note 1). While a change waits, the reward takes no other edit.
 */
export async function editReward(raw: { actorUserId: string; programSlug: string; rewardId: string; title?: string; cost?: number; termsText?: string; worse?: boolean }) {
  const input = rewardTarget.extend({ title: shortText.optional(), cost: z.number().int().min(1).max(100000).optional(), termsText: z.string().trim().max(3000).optional(), worse: z.boolean().optional() }).parse(raw);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const at = await savedAt(tx);
    const { reward, inForce, next, waiting } = await ownerReward(tx, program, input.rewardId, at);
    const title = input.title ?? inForce.title, cost = input.cost ?? inForce.cost, termsText = input.termsText ?? inForce.termsText;
    const renamed = title !== inForce.title || termsText !== inForce.termsText;
    if (title !== inForce.title) requireAllowedRewardTitle(title);
    // Before the no-op: an edit back to the version in force must not read as saved while the dated change still waits.
    if (waiting) throw CHANGE_PENDING();
    if (!renamed && cost === inForce.cost) return { rewardId: reward.id, versionId: inForce.id, version: inForce.version, effectiveAt: null };
    if (renamed && input.worse === undefined) throw new DomainError("CHOICE_REQUIRED", "Sag bitte, ob der neue Name für deine Kunden schlechter ist.");
    const dated = cost > inForce.cost || (renamed && input.worse === true);
    const [version] = await tx.insert(rewardVersions).values({ tenantId: program.tenantId, rewardId: reward.id, version: next, title, cost, termsText, createdAt: at, effectiveAt: dated ? noticeEnd(at) : at }).returning();
    if (dated) await scheduleWalletProgramRefresh(tx, program.tenantId, program.id, noticeEnd(at));
    await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
    return { rewardId: reward.id, versionId: version.id, version: version.version, effectiveAt: dated ? version.effectiveAt : null };
  });
}

/** „Änderung zurücknehmen“ / „Archivieren zurücknehmen“: cancels the waiting change at once. A pending version is superseded
 *  by a copy of the version in force (rows are append-only); a scheduled archive loses its date. Nothing waiting: no-op. */
export async function takeBackRewardChange(raw: { actorUserId: string; programSlug: string; rewardId: string }) {
  const input = rewardTarget.parse(raw);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const at = await savedAt(tx);
    const { reward, inForce, pending, next } = await ownerReward(tx, program, input.rewardId, at);
    if (reward.endsAt) await tx.update(rewards).set({ endsAt: null }).where(eq(rewards.id, reward.id));
    else if (pending) await tx.insert(rewardVersions).values({ tenantId: program.tenantId, rewardId: reward.id, version: next, title: inForce.title, cost: inForce.cost, termsText: inForce.termsText, createdAt: at, effectiveAt: at });
    else return { rewardId: reward.id, takenBack: false };
    // A refresh already scheduled for the old date stays: it reads the current state and changes nothing.
    await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
    return { rewardId: reward.id, takenBack: true };
  });
}

export async function reorderRewards(raw: { actorUserId: string; programSlug: string; rewardIds: string[] }) {
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120), rewardIds: z.array(z.uuid()).min(1).max(100) }).parse(raw);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const active = await tx.select({ id: rewards.id }).from(rewards).where(and(eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id), sql.raw(liveReward("rewards", "now()"))));
    if (input.rewardIds.length !== active.length || new Set(input.rewardIds).size !== active.length || active.some(row => !input.rewardIds.includes(row.id))) throw new DomainError("INVALID_REWARD_ORDER", "Order must include every active reward once");
    for (const [index, id] of input.rewardIds.entries()) await tx.update(rewards).set({ sortOrder: index }).where(eq(rewards.id, id));
    await enqueueWalletProgramRefresh(tx, program.tenantId, program.id); // the first reward is the pass's target
    return { rewardIds: input.rewardIds };
  });
}

/** Archiving is dated (ENG-100 D3): the reward stays on cards and redeemable until ends_at, four weeks on. At least one
 *  reward must stay that is not ending. */
export async function archiveReward(raw: { actorUserId: string; programSlug: string; rewardId: string }) {
  const input = rewardTarget.parse(raw);
  return db.transaction(async tx => {
    const program = await ownerProgram(tx, input.actorUserId, input.programSlug);
    const at = await savedAt(tx);
    const { reward, waiting } = await ownerReward(tx, program, input.rewardId, at);
    if (waiting) throw CHANGE_PENDING();
    const [others] = await tx.select({ count: sql<number>`count(*)::int` }).from(rewards)
      .where(and(eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id), eq(rewards.active, true), sql`${rewards.endsAt} IS NULL`, ne(rewards.id, reward.id)));
    if (!others.count) throw new DomainError("LAST_ACTIVE_REWARD", "At least one active reward is required");
    const [ending] = await tx.update(rewards).set({ endsAt: noticeEnd(at) }).where(eq(rewards.id, reward.id)).returning({ endsAt: rewards.endsAt });
    await scheduleWalletProgramRefresh(tx, program.tenantId, program.id, noticeEnd(at));
    await enqueueWalletProgramRefresh(tx, program.tenantId, program.id);
    return { rewardId: reward.id, endsAt: ending.endsAt };
  });
}

/**
 * Programme rules as customers see them (card and sign-up): the owner's text, plus the win-back and birthday lines while
 * those bonuses are on (Legal). Win-back runs without Wallet messages (ENG-089); birthday stays with them. Points by
 * purchase amount open with the system's earning sentence, and the owner's text adds to it (ENG-099 3c).
 * `bonusExclusions: false` drops the bonus lines' exclusion sentence for a page that prints it once, last.
 */
function shownRules(program: typeof programs.$inferSelect, tenant: typeof tenants.$inferSelect, bonusExclusions = true) {
  const messages = !surfaceHidden("walletMessages");
  const type = program.type as "stamp" | "points";
  const lines = [program.rulesText];
  if (byPurchase(program.type, program.earningMode)) lines.unshift(purchaseRuleSentence(program.pointsPerCurrencyUnit, tenant.currency, tenant.locale === "fr" ? "fr" : "de"));
  if (program.winbackEnabled && program.winbackBonus > 0) lines.push(winbackRule(type, program.winbackDays, program.winbackBonus, messages, bonusExclusions));
  if (messages && program.birthdayEnabled && program.birthdayBonus > 0) lines.push(birthdayRule(type, program.birthdayBonus, bonusExclusions));
  return lines.filter(Boolean).join("\n\n");
}

/** The rules the sign-up page receives; signUpRules lays them out there and on the back of the Apple Wallet pass. */
export function publicRules(program: typeof programs.$inferSelect, tenant: typeof tenants.$inferSelect) {
  // German pages print Legal's exclusions once, at the end of the rules (signUpRules), so the bonus lines leave them out.
  return { locale: tenant.locale, rulesText: shownRules(program, tenant, tenant.locale === "fr"), pointsExpiryRule: program.pointsExpiryMonths ? expiryRuleText(program.pointsExpiryMonths) : undefined };
}

/** The owner screen's challenge: the terms in force now and a change that starts later („Gilt ab 1.11.“). */
function meChallenge(program: typeof programs.$inferSelect, timeZone: string) {
  const month = monthOf(new Date(), timeZone), current = challengeFor(program, month);
  return { challengeVisits: current.visits, challengeBonus: current.bonus, challengeNext: pendingChallenge(program, month) };
}

/**
 * The card's line for the running month: the challenge and the visit days so far (absent while the shop has none). With a
 * confirmed programme end (`programmeEnd`, YYYY-MM-DD) a month that ends after it shows no challenge (Product, 24 Oct).
 */
async function cardChallenge(tx: Parameters<typeof challengeProgress>[0], row: { member: typeof memberships.$inferSelect; program: typeof programs.$inferSelect; location: typeof locations.$inferSelect; tenant: typeof tenants.$inferSelect }, programmeEnd?: string, now = new Date()) {
  const rule = challengeFor(row.program, monthOf(now, row.location.timezone));
  if (!rule.visits) return undefined;
  const [y, m] = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: row.location.timezone }).format(now).split("-").map(Number);
  if (programmeEnd && new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) > programmeEnd) return undefined;
  const progress = await challengeProgress(tx, { tenantId: row.member.tenantId, membershipId: row.member.id, locationId: row.program.locationId, at: now });
  const intl = row.tenant.locale === "fr" ? "fr-FR" : "de-DE";
  const month = new Intl.DateTimeFormat(intl, { month: "long", timeZone: row.location.timezone }).format(now);
  const [year, monthNumber] = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: row.location.timezone }).format(now).split("-").map(Number);
  const endsOn = new Intl.DateTimeFormat(intl, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNumber, 0)));
  return { ...challengeSentence(rule.visits, rule.bonus, row.program.type, month, endsOn, row.tenant.locale), visits: Math.min(progress.visits, rule.visits), target: rule.visits, done: progress.bonuses.length > 0 };
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

/** The card's win-back window (ENG-089): the bonus and the window's last day (YYYY-MM-DD), capped at a confirmed programme end. */
async function cardWinback(tx: Parameters<typeof winbackState>[0], program: typeof programs.$inferSelect, membershipId: string, programmeEnd: string | undefined, now: Date) {
  const state = program.winbackBonus > 0 ? await winbackState(tx, membershipId, now) : null;
  return state ? { bonus: state.bonus, until: programmeEnd && state.deadline > programmeEnd ? programmeEnd : state.deadline } : undefined;
}

/** A level's „bis“ date (DD.MM.YYYY) never runs past a confirmed programme end (YYYY-MM-DD): it is capped at the end. */
export function capLevelUntil<T extends { until?: string }>(level: T | undefined, programmeEnd?: string): T | undefined {
  if (!level?.until || !programmeEnd) return level;
  const iso = `${level.until.slice(6, 10)}-${level.until.slice(3, 5)}-${level.until.slice(0, 2)}`;
  return iso > programmeEnd ? { ...level, until: germanDate(programmeEnd) } : level;
}

/** ENG-206: the card shows „Karte empfehlen“ from this many team-confirmed bookings on; the block opens once, with exactly this one. */
const REFERRAL_AFTER_BOOKINGS = 2;

export async function getCard(token: string, explicitNow?: Date) {
  const now = explicitNow ?? new Date();
  if (!validCardToken(token)) throw new DomainError("NOT_FOUND", "Diese Karte haben wir nicht gefunden.");
  // Balance, recent activity and reward progress must describe one committed state.
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ member: memberships, program: programs, location: locations, tenant: tenants })
      .from(memberships)
      .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
      .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.cardToken, token), sql`${memberships.closedAt} is null`));
    if (!row) throw new DomainError("NOT_FOUND", "Diese Karte haben wir nicht gefunden.");
    // The rule in force by the database clock, as saves and bookings decide it (a web server a few ms off would show the
    // switch-over late or early); `explicitNow` only for tests.
    const program = await programInForce(tx, row.program, explicitNow ?? sql`clock_timestamp()`);
    const activity = await tx.select({ delta: ledgerEntries.delta, kind: ledgerEntries.kind, source: ledgerEntries.source, createdAt: ledgerEntries.createdAt, purchaseLedgerId: purchaseAwards.ledgerEntryId }).from(ledgerEntries)
      .leftJoin(purchaseAwards, and(eq(purchaseAwards.ledgerEntryId, ledgerEntries.id), eq(purchaseAwards.tenantId, ledgerEntries.tenantId)))
      .where(and(eq(ledgerEntries.tenantId, row.member.tenantId), eq(ledgerEntries.membershipId, row.member.id)))
      .orderBy(desc(ledgerEntries.createdAt)).limit(10);
    // The review link is only a link: no reward, stamp, points or draw is ever tied to it.
    // ENG-206: while STAMP_ANIMATION_ENABLED is on the card page needs the same count for the referral block's timing; off, no extra read.
    const stampMoment = experienceFlag("STAMP_ANIMATION_ENABLED");
    const [visits] = row.program.reviewUrl || stampMoment ? await tx.select({ count: sql<number>`count(*)::int` }).from(ledgerEntries).where(and(
      eq(ledgerEntries.tenantId, row.member.tenantId), eq(ledgerEntries.membershipId, row.member.id), eq(ledgerEntries.kind, "award"),
      sql`${ledgerEntries.source} in ('staff_online','staff_offline')`,
      sql`not exists (select 1 from ledger_entries undo where undo.tenant_id = ${ledgerEntries.tenantId} and undo.reversal_of_id = ${ledgerEntries.id})`)) : [{ count: 0 }];
    // With a confirmed end date nothing dated after it shows: the end date, no later challenge month, level date or expiry batch.
    const programmeEnd = row.program.cancellationConfirmedAt ? row.program.cancellationEndDate ?? undefined : undefined;
    const demo = shopDemo(row.tenant, row.location.timezone);
    return { ...(demo ? { demoNotice: demo.line } : {}), ...(stampMoment ? { stampMoment: { referralDue: visits.count >= REFERRAL_AFTER_BOOKINGS, referralNew: visits.count === REFERRAL_AFTER_BOOKINGS } } : {}), programId: row.program.id, scanCode: row.member.scanCode, cardLocator: formatCardLocator(row.member.cardLocator), balance: row.member.balance, merchantName: row.tenant.name, locationName: row.location.name, programName: program.name, programType: program.type, earningMode: program.earningMode, locale: row.tenant.locale, brandColor: row.location.brandColor, endsOn: programmeEnd, rulesText: shownRules(program, row.tenant), pending: program.pending, pendingExpiry: program.pendingExpiry, news: row.program.cardNews || undefined, happyHourUntil: program.earningMode === "purchase" && program.type === "points" && row.program.happyHourEnabled ? activeHappyHour(row.program.happyHourWindows, new Date(), row.location.timezone)?.end : undefined, reviewUrl: row.program.reviewUrl && visits.count >= REVIEW_AFTER_VISITS ? row.program.reviewUrl : undefined, pointsExpiry: await cardExpiry(tx, row.member.tenantId, row.member.id, program, row.location.timezone, now, programmeEnd), challenge: await cardChallenge(tx, row, programmeEnd, now), level: capLevelUntil(await cardLevel(tx, row.member, row.program), programmeEnd), winback: await cardWinback(tx, row.program, row.member.id, programmeEnd, now), rewards: await currentRewards(row.member.tenantId, row.program.id, tx), activity: activity.map(({ purchaseLedgerId, source, ...entry }) => ({ ...entry, isPurchase: purchaseLedgerId !== null, isWelcomeBonus: source === "welcome_bonus", isHappyHour: source === "happy_hour", isWinbackBonus: source === "winback_bonus", isBirthdayBonus: source === "birthday_bonus", isChallengeBonus: source === "challenge_bonus" })) };
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
  if (locator && !actor) throw new DomainError("FORBIDDEN", "Du hast an diesem Standort keinen Kassenzugang.");
  const [row] = await db.select({ member: memberships, program: programs, tenant: tenants }).from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(locator ? and(eq(memberships.tenantId, actor.tenantId), eq(memberships.cardLocator, locator)) : eq(memberships.scanCode, code));
  if (!row || row.member.closedAt || row.program.locationId !== input.locationId || row.program.status !== "active") throw new DomainError("NOT_FOUND", "Diese Karte haben wir an diesem Standort nicht gefunden.");
  const [role] = await db.select().from(staffRoles).where(and(eq(staffRoles.tenantId, row.member.tenantId), eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
  if (!role || (role.role !== "owner" && role.locationId !== input.locationId)) throw new DomainError("FORBIDDEN", "Du hast an diesem Standort keinen Kassenzugang.");
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
  const card = await resolveCounterCard({ userId: input.userId, locationId: input.locationId, code: input.scanCode });
  const { member, tenant, by } = card;
  // The counter keeps the rule in force until a waiting change's date (ENG-100): no pending data here.
  const program = await programInForce(db, card.program);
  const now = new Date();
  // Bonuses the next award books on top, so the button can say so before the tap (ENG-133). Happy hour doubles purchase points only.
  const [location] = program.happyHourEnabled && program.earningMode === "purchase" ? await db.select({ timezone: locations.timezone }).from(locations).where(and(eq(locations.id, program.locationId), eq(locations.tenantId, program.tenantId))) : [];
  return { stage: "open" as const, welcomeBonus: await welcomeBonusDue(db, program, { tenantId: member.tenantId, membershipId: member.id }), happyHour: Boolean(location && activeHappyHour(program.happyHourWindows, now, location.timezone)), membershipId: member.id, cardLocator: formatCardLocator(member.cardLocator), matchedBy: by, balance: member.balance, programType: program.type, earningMode: program.earningMode, pointsPerCurrencyUnit: program.pointsPerCurrencyUnit, currency: tenant.currency, ruleVersionId: program.ruleVersionId, rewards: await currentRewards(member.tenantId, program.id), winbackBonus: program.winbackBonus > 0 && (await winbackState(db, member.id, now)) ? program.winbackBonus : 0, birthdayBonus: program.birthdayBonus > 0 && (await birthdayState(db, member.id, now)) ? program.birthdayBonus : 0, level: await cardLevel(db, member, program) };
}

export async function getPublicProgram(slug: string) {
  const [row] = await db.select({ program: programs, location: locations, tenant: tenants, active: sql<boolean>`${programs.effectiveAt} <= now()` }).from(programs)
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, programs.tenantId))
    .where(and(eq(programs.slug, slug), eq(programs.status, "active")));
  if (!row) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
  const program = await programInForce(db, row.program);
  const rewardList = await currentRewards(row.tenant.id, row.program.id);
  const [reward] = rewardList;
  // The day a change saved now would take effect (ENG-100, four weeks on, the shop's calendar), for the owner's screens before saving.
  const noticeOn = new Intl.DateTimeFormat("en-CA", { timeZone: row.location.timezone }).format(new Date(Date.now() + 28 * 86_400_000));
  // ENG-130: the join page has no card yet, so Apple Wallet is asked of the location (the same check a card's wallet status makes).
  const appleWallet = walletAvailability(await passFastEnv(row.tenant.id, row.location.id), row.tenant.id, row.location.id, row.program.id).apple === "available";
  // The join sends back the newest rule and reward versions it showed (D7); owner screens read pending ?? in force.
  // Demo environment only (Legal, 9 Nov): the notice line, the demo consent wording with its version, and no terms to accept.
  const demo = shopDemo(row.tenant, row.location.timezone);
  return { ...(demo ? { demo: { notice: demo.line, consentVersion: DEMO_CONSENT_TEXT_VERSION, consentText: demoConsentText(row.tenant.name, demo.end) } } : {}), noticeOn, appleWallet, walletMessages: !surfaceHidden("walletMessages"), businessName: row.tenant.name, locationName: row.location.name, programName: program.name, programType: program.type, earningMode: program.earningMode, pointsPerCurrencyUnit: program.pointsPerCurrencyUnit, currency: row.tenant.currency, ...publicRules(program, row.tenant), ownerRulesText: program.rulesText, pending: program.pending, pendingExpiry: program.pendingExpiry, ruleVersionId: program.newestRuleVersionId, rewardVersionIds: await newestRewardVersionIds(db, row.tenant.id, row.program.id), rewards: rewardList, rewardTitle: reward?.title, rewardCost: reward?.cost, brandColor: row.location.brandColor, active: row.active, referral: await publicReferralTerms(row.tenant.id, row.program.id) };
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
  const base = { userId, tenantId: tenant.id, locationId: location.id, role: staff.role, businessName: tenant.name, locationName: location.name, locale: tenant.locale, programId: program?.id, programSlug: program?.slug, programType: program?.type, earningMode: program?.earningMode, tapMode: program?.tapMode, tapAutomaticAllowed: automaticTapAllowed(), hiddenSurfaces: hiddenSurfaces(), tapCooldownSeconds: program?.tapCooldownSeconds, welcomeBonus: program.welcomeBonus, cardNews: program.cardNews, reviewUrl: program.reviewUrl, cancellationEndDate: program.cancellationEndDate, cancellationConfirmed: program.cancellationConfirmedAt !== null, happyHourEnabled: program.happyHourEnabled, happyHourWindows: program.happyHourWindows, birthdayEnabled: program.birthdayEnabled, pointsExpiryMonths: program.pointsExpiryMonths, ...meChallenge(program, location.timezone), levelsEnabled: program.levelsEnabled, levelSilverVisits: program.levelSilverVisits, levelGoldVisits: program.levelGoldVisits, levelBronzePerk: program.levelBronzePerk, levelSilverPerk: program.levelSilverPerk, levelGoldPerk: program.levelGoldPerk, averageVisitSpendMinor: program.averageVisitSpendMinor, rewardTitle: reward?.title, rewardCost: reward?.cost };
  if (staff.role === "cashier") return { ...base, brandColor: undefined, stats: undefined, activity: undefined };
  const [memberCount] = program ? await db.select({ count: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.tenantId, tenant.id), eq(memberships.programId, program.id))) : [{ count: 0 }];
  const [totals] = await db.select({ awards: sql<number>`count(*) filter (where ${ledgerEntries.kind} = 'award')::int`, redemptions: sql<number>`count(*) filter (where ${ledgerEntries.kind} = 'redeem')::int` }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenantId, tenant.id), eq(ledgerEntries.locationId, location.id)));
  const entries = await db.select({ id: ledgerEntries.id, kind: ledgerEntries.kind, delta: ledgerEntries.delta, createdAt: ledgerEntries.createdAt, cardLocator: memberships.cardLocator }).from(ledgerEntries)
    .innerJoin(memberships, and(eq(memberships.id, ledgerEntries.membershipId), eq(memberships.tenantId, ledgerEntries.tenantId)))
    .where(and(eq(ledgerEntries.tenantId, tenant.id), eq(ledgerEntries.locationId, location.id)))
    .orderBy(desc(ledgerEntries.createdAt)).limit(10);
  // For the owner's card previews: owner only, like the brand read (merchant-brand.ts), and without the logo.
  const brandColor = staff.role === "owner" && /^#[0-9a-fA-F]{6}$/.test(location.brandColor) ? location.brandColor : undefined;
  return { ...base, brandColor, stats: { members: memberCount.count, awards: totals.awards, redemptions: totals.redemptions, periodLabel: "Seit Programmstart" }, activity: entries.map((entry) => ({ id: entry.id, kind: entry.kind === "redeem" ? "redemption" : entry.kind, occurredAt: entry.createdAt.toLocaleString(tenant.locale === "fr" ? "fr-FR" : "de-DE", { timeZone: location.timezone }), amount: Math.abs(entry.delta), unit: program?.type === "points" ? "Punkte" : "Stempel", reference: `Karte ${formatCardLocator(entry.cardLocator)}` })) };
}
