import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { consentEvents, ledgerEntries, locations, membershipContacts, memberships, programs, rewardVersions, rewards, staffRoles, subscriptions, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { draftPriceMinor } from "./pricing";

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
  try { new Intl.DateTimeFormat("de", { timeZone: input.timezone }); } catch { throw new DomainError("INVALID_TIMEZONE", "Unknown timezone"); }
  if ((input.country === "DE" && input.currency !== "EUR") || (input.country === "MA" && input.currency !== "MAD")) throw new DomainError("INVALID_CURRENCY", "Currency and country differ");
  if ((input.latitude === undefined) !== (input.longitude === undefined)) throw new DomainError("INVALID_COORDINATES", "Latitude and longitude are required together");
  const logoData = checkedLogo(input.logoData);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(staffRoles).where(eq(staffRoles.userId, input.userId)).limit(1);
    if (existing) throw new DomainError("ALREADY_ONBOARDED", "User already belongs to a merchant");
    const suffix = randomCode(5).toLowerCase().replace(/[^a-z0-9]/g, "");
    const [tenant] = await tx.insert(tenants).values({ name: input.businessName, slug: `${slugOf(input.businessName)}-${suffix}`, currency: input.currency, locale: input.locale }).returning();
    const [location] = await tx.insert(locations).values({ tenantId: tenant.id, name: input.locationName ?? input.businessName, city: input.city, country: input.country, timezone: input.timezone, contactEmail: input.contactEmail, brandColor: input.brandColor, logoData, latitude: input.latitude, longitude: input.longitude }).returning();
    const assigned = await tx.insert(staffRoles).values({ tenantId: tenant.id, userId: input.userId, role: "owner" })
      .onConflictDoNothing({ target: staffRoles.userId }).returning({ userId: staffRoles.userId });
    if (!assigned.length) throw new DomainError("ALREADY_ONBOARDED", "User already belongs to a merchant");
    const [program] = await tx.insert(programs).values({ tenantId: tenant.id, locationId: location.id, slug: `${slugOf(input.programName)}-${suffix}`, name: input.programName, type: input.programType, rulesText: input.rulesText, effectiveAt: input.effectiveDate ? new Date(`${input.effectiveDate}T00:00:00Z`) : undefined }).returning();
    const [reward] = await tx.insert(rewards).values({ tenantId: tenant.id, programId: program.id }).returning();
    await tx.insert(rewardVersions).values({ tenantId: tenant.id, rewardId: reward.id, version: 1, title: input.rewardTitle, cost: input.rewardCost });
    await tx.insert(subscriptions).values({ tenantId: tenant.id, currency: input.currency, priceMinor: draftPriceMinor(input.currency) });
    return { tenantId: tenant.id, locationId: location.id, programId: program.id, programSlug: program.slug, city: location.city, programType: program.type };
  });
}

const updateProgramInput = z.object({
  actorUserId: z.string().min(1),
  programSlug: z.string().min(1).max(120),
  name: shortText,
  rulesText: z.string().trim().min(10).max(3000),
  rewardTitle: shortText,
  rewardCost: z.number().int().min(1).max(100000),
  programType: z.enum(["stamp", "points"]).optional(),
}).strict();

export async function updateProgram(raw: z.input<typeof updateProgramInput>) {
  const input = updateProgramInput.parse(raw);
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(programs).where(and(eq(programs.slug, input.programSlug), eq(programs.status, "active"))).for("update");
    if (!program) throw new DomainError("NOT_FOUND", "Program not found");
    const [owner] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, input.actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
    if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
    const nextType = input.programType ?? program.type;
    if (nextType !== program.type) {
      const [activity] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, program.tenantId), eq(ledgerEntries.locationId, program.locationId))).limit(1);
      if (activity) throw new DomainError("TYPE_LOCKED", "Program type cannot change after transactions");
    }
    const [reward] = await tx.select().from(rewards).where(and(eq(rewards.tenantId, program.tenantId), eq(rewards.programId, program.id), eq(rewards.active, true))).for("update");
    if (!reward) throw new DomainError("NOT_FOUND", "Reward not found");
    const [latest] = await tx.select().from(rewardVersions).where(and(eq(rewardVersions.tenantId, program.tenantId), eq(rewardVersions.rewardId, reward.id))).orderBy(desc(rewardVersions.version)).limit(1);
    if (!latest) throw new DomainError("NOT_FOUND", "Reward rule not found");
    await tx.update(programs).set({ name: input.name, rulesText: input.rulesText, type: nextType }).where(eq(programs.id, program.id));
    if (latest.title !== input.rewardTitle || latest.cost !== input.rewardCost) {
      await tx.insert(rewardVersions).values({ tenantId: program.tenantId, rewardId: reward.id, version: latest.version + 1, title: input.rewardTitle, cost: input.rewardCost, termsText: latest.termsText });
    }
    return { programSlug: program.slug, programType: nextType, rewardVersion: latest.version + Number(latest.title !== input.rewardTitle || latest.cost !== input.rewardCost) };
  });
}

const enrollInput = z.object({
  slug: z.string().min(1).max(120),
  acceptedTerms: z.literal(true),
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
    const [member] = await tx.insert(memberships).values({ tenantId: program.tenantId, programId: program.id, scanCode: `sc_${randomCode(24)}`, cardToken: `card_${randomCode(32)}` }).returning();
    if (input.email) await tx.insert(membershipContacts).values({ tenantId: program.tenantId, membershipId: member.id, email: input.email.toLowerCase() });
    if (input.marketingOptIn) await tx.insert(consentEvents).values({ tenantId: program.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: true, noticeVersion: "2026-09", source: "enrollment" });
    return { id: member.id, cardToken: member.cardToken, scanCode: member.scanCode };
  });
}

async function currentRewards(tenantId: string, programId: string) {
  const rows = await db.select({ reward: rewards, version: rewardVersions }).from(rewards)
    .innerJoin(rewardVersions, and(eq(rewardVersions.rewardId, rewards.id), eq(rewardVersions.tenantId, rewards.tenantId)))
    .where(and(eq(rewards.tenantId, tenantId), eq(rewards.programId, programId), eq(rewards.active, true), sql`${rewardVersions.effectiveAt} <= now()`))
    .orderBy(desc(rewardVersions.version));
  const seen = new Set<string>();
  return rows.filter(({ reward }) => { if (seen.has(reward.id)) return false; seen.add(reward.id); return true; })
    .map(({ version }) => ({ id: version.id, title: version.title, cost: version.cost, termsText: version.termsText }));
}

export async function getCard(token: string) {
  const [row] = await db.select({ member: memberships, program: programs, location: locations, tenant: tenants })
    .from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.cardToken, token));
  if (!row) throw new DomainError("NOT_FOUND", "Card not found");
  const activity = await db.select({ delta: ledgerEntries.delta, kind: ledgerEntries.kind, createdAt: ledgerEntries.createdAt }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenantId, row.member.tenantId), eq(ledgerEntries.membershipId, row.member.id)))
    .orderBy(desc(ledgerEntries.createdAt)).limit(10);
  return { scanCode: row.member.scanCode, balance: row.member.balance, merchantName: row.tenant.name, locationName: row.location.name, programName: row.program.name, programType: row.program.type, locale: row.tenant.locale, brandColor: row.location.brandColor, rulesText: row.program.rulesText, rewards: await currentRewards(row.member.tenantId, row.program.id), activity };
}

export async function lookupCard(input: { userId: string; locationId: string; scanCode: string }) {
  const [row] = await db.select({ member: memberships, program: programs }).from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .where(eq(memberships.scanCode, input.scanCode));
  if (!row || row.program.locationId !== input.locationId || row.program.status !== "active") throw new DomainError("NOT_FOUND", "Card not found at this location");
  const [role] = await db.select().from(staffRoles).where(and(eq(staffRoles.tenantId, row.member.tenantId), eq(staffRoles.userId, input.userId), eq(staffRoles.active, true)));
  if (!role || (role.role !== "owner" && role.locationId !== input.locationId)) throw new DomainError("FORBIDDEN", "No checkout access");
  return { membershipId: row.member.id, balance: row.member.balance, programType: row.program.type, rewards: await currentRewards(row.member.tenantId, row.program.id) };
}

export async function getPublicProgram(slug: string) {
  const [row] = await db.select({ program: programs, location: locations, tenant: tenants, active: sql<boolean>`${programs.effectiveAt} <= now()` }).from(programs)
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, programs.tenantId))
    .where(and(eq(programs.slug, slug), eq(programs.status, "active")));
  if (!row) throw new DomainError("NOT_FOUND", "Program not found");
  const [reward] = await currentRewards(row.tenant.id, row.program.id);
  return { businessName: row.tenant.name, locationName: row.location.name, programName: row.program.name, programType: row.program.type, locale: row.tenant.locale, rulesText: row.program.rulesText, rewardTitle: reward?.title, rewardCost: reward?.cost, brandColor: row.location.brandColor, active: row.active };
}

export async function getMerchantContext(userId: string) {
  const [staff] = await db.select().from(staffRoles).where(and(eq(staffRoles.userId, userId), eq(staffRoles.active, true))).limit(1);
  if (!staff) return null;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, staff.tenantId));
  const [location] = await db.select().from(locations).where(and(eq(locations.tenantId, staff.tenantId), staff.locationId ? eq(locations.id, staff.locationId) : sql`true`)).limit(1);
  if (!tenant || !location) return null;
  const [program] = await db.select().from(programs).where(and(eq(programs.tenantId, tenant.id), eq(programs.locationId, location.id), eq(programs.status, "active"))).limit(1);
  const [reward] = program ? await currentRewards(tenant.id, program.id) : [];
  const base = { userId, tenantId: tenant.id, locationId: location.id, role: staff.role, businessName: tenant.name, locationName: location.name, locale: tenant.locale, programSlug: program?.slug, programType: program?.type, rewardTitle: reward?.title, rewardCost: reward?.cost };
  if (staff.role === "cashier") return { ...base, stats: undefined, activity: undefined };
  const [memberCount] = program ? await db.select({ count: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.tenantId, tenant.id), eq(memberships.programId, program.id))) : [{ count: 0 }];
  const [totals] = await db.select({ awards: sql<number>`count(*) filter (where ${ledgerEntries.kind} = 'award')::int`, redemptions: sql<number>`count(*) filter (where ${ledgerEntries.kind} = 'redeem')::int` }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenantId, tenant.id), eq(ledgerEntries.locationId, location.id)));
  const entries = await db.select({ id: ledgerEntries.id, kind: ledgerEntries.kind, delta: ledgerEntries.delta, createdAt: ledgerEntries.createdAt, membershipId: ledgerEntries.membershipId }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenantId, tenant.id), eq(ledgerEntries.locationId, location.id)))
    .orderBy(desc(ledgerEntries.createdAt)).limit(10);
  return { ...base, stats: { members: memberCount.count, awards: totals.awards, redemptions: totals.redemptions, periodLabel: "Seit Programmstart" }, activity: entries.map((entry) => ({ id: entry.id, kind: entry.kind === "redeem" ? "redemption" : entry.kind, occurredAt: entry.createdAt.toLocaleString(tenant.locale === "fr" ? "fr-FR" : "de-DE", { timeZone: location.timezone }), amount: Math.abs(entry.delta), unit: program?.type === "points" ? "Punkte" : "Stempel", reference: `Karte ${entry.membershipId.slice(0, 8)}` })) };
}
