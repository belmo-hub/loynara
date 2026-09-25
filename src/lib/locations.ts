import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "@/db";
import { locations, programRuleVersions, programs, rewardVersions, rewards, staffRoles, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { MAX_POINTS_PER_CURRENCY_UNIT } from "./points";

const input = z.object({
  name: z.string().trim().min(2).max(180),
  city: z.string().trim().min(2).max(120),
  country: z.enum(["DE", "MA"]),
  timezone: z.string().min(3).max(80),
  programName: z.string().trim().min(2).max(180),
  programType: z.enum(["stamp", "points"]),
  earningMode: z.enum(["manual", "purchase"]).optional(),
  pointsPerCurrencyUnit: z.number().int().min(1).max(MAX_POINTS_PER_CURRENCY_UNIT).optional(),
  rulesText: z.string().trim().min(10).max(3000),
  rewardTitle: z.string().trim().min(2).max(180),
  rewardCost: z.number().int().min(1).max(100000),
}).strict();

type LocationRow = {
  id: string; name: string; city: string; country: string; timezone: string; createdAt: Date;
  programSlug: string | null; programName: string | null; programType: "stamp" | "points" | null;
  cards: number; awards: number; redemptions: number; activeStaff: number;
};

async function ownerRole(actorUserId: string) {
  const [owner] = await db.select({ tenantId: staffRoles.tenantId }).from(staffRoles)
    .where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
  return owner;
}

function slugOf(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "standort";
}

export async function createAdditionalLocation(actorUserId: string, raw: z.input<typeof input>) {
  const data = input.parse(raw);
  const earningMode = data.earningMode ?? (data.programType === "points" ? "purchase" : "manual");
  if (data.programType === "stamp" && earningMode !== "manual") throw new DomainError("INVALID_EARNING_MODE", "Stamp programmes use manual earning");
  try { new Intl.DateTimeFormat("de", { timeZone: data.timezone }); }
  catch { throw new DomainError("INVALID_TIMEZONE", "Unknown timezone"); }

  return db.transaction(async tx => {
    const [owner] = await tx.select({ tenantId: staffRoles.tenantId }).from(staffRoles)
      .where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
    if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, owner.tenantId)).for("update");
    if (!tenant) throw new DomainError("NOT_FOUND", "Merchant not found");
    if ((tenant.currency === "EUR" && data.country !== "DE") || (tenant.currency === "MAD" && data.country !== "MA")) {
      throw new DomainError("INVALID_COUNTRY", "Location country must match the merchant currency");
    }
    const [duplicate] = await tx.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.tenantId, tenant.id), sql`lower(${locations.name}) = lower(${data.name})`)).limit(1);
    if (duplicate) throw new DomainError("LOCATION_EXISTS", "A location with this name already exists");

    const [location] = await tx.insert(locations).values({
      tenantId: tenant.id, name: data.name, city: data.city, country: data.country, timezone: data.timezone,
    }).returning({ id: locations.id });
    const [program] = await tx.insert(programs).values({
      tenantId: tenant.id, locationId: location.id,
      slug: `${slugOf(data.programName)}-${randomBytes(10).toString("hex")}`,
      name: data.programName, type: data.programType, earningMode,
      pointsPerCurrencyUnit: data.pointsPerCurrencyUnit ?? 1, rulesText: data.rulesText,
    }).returning();
    await tx.insert(programRuleVersions).values({
      tenantId: tenant.id, programId: program.id, version: 1, name: program.name, type: program.type,
      rulesText: program.rulesText, earningMode: program.earningMode,
      pointsPerCurrencyUnit: program.pointsPerCurrencyUnit, effectiveAt: program.effectiveAt,
    });
    const [reward] = await tx.insert(rewards).values({ tenantId: tenant.id, programId: program.id }).returning({ id: rewards.id });
    await tx.insert(rewardVersions).values({ tenantId: tenant.id, rewardId: reward.id, version: 1, title: data.rewardTitle, cost: data.rewardCost });
    return { locationId: location.id, programId: program.id, programSlug: program.slug };
  });
}

export async function validateOwnerLocation(actorUserId: string, locationId: string) {
  const owner = await ownerRole(actorUserId);
  if (!z.uuid().safeParse(locationId).success) throw new DomainError("INVALID_LOCATION", "Invalid location");
  const [location] = await db.select({ id: locations.id, name: locations.name }).from(locations)
    .where(and(eq(locations.tenantId, owner.tenantId), eq(locations.id, locationId))).limit(1);
  if (!location) throw new DomainError("NOT_FOUND", "Location not found");
  return location;
}

export async function listMerchantLocations(actorUserId: string) {
  const owner = await ownerRole(actorUserId);
  const [tenant] = await db.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, owner.tenantId)).limit(1);
  if (!tenant) throw new DomainError("NOT_FOUND", "Merchant not found");
  const result = await pool.query<LocationRow>(`
    SELECT l.id, l.name, l.city, l.country, l.timezone, l.created_at AS "createdAt",
      p.slug AS "programSlug", p.name AS "programName", p.type AS "programType",
      (SELECT count(*)::int FROM memberships m JOIN programs card_program ON card_program.tenant_id = m.tenant_id AND card_program.id = m.program_id WHERE m.tenant_id = l.tenant_id AND card_program.location_id = l.id) AS cards,
      (SELECT count(*)::int FROM ledger_entries e WHERE e.tenant_id = l.tenant_id AND e.location_id = l.id AND e.kind = 'award' AND e.source in ('staff_online','staff_offline')) AS awards,
      (SELECT count(*)::int FROM ledger_entries e WHERE e.tenant_id = l.tenant_id AND e.location_id = l.id AND e.kind = 'redeem') AS redemptions,
      (SELECT count(*)::int FROM staff_roles s WHERE s.tenant_id = l.tenant_id AND s.location_id = l.id AND s.active = true) AS "activeStaff"
    FROM locations l
    LEFT JOIN programs p ON p.tenant_id = l.tenant_id AND p.location_id = l.id AND p.status = 'active'
    WHERE l.tenant_id = $1
    ORDER BY l.created_at, l.id
  `, [owner.tenantId]);
  const rows = result.rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
  return {
    scope: "all_merchant_locations" as const,
    currency: tenant.currency,
    totals: { locations: rows.length, cards: rows.reduce((sum, row) => sum + row.cards, 0), awards: rows.reduce((sum, row) => sum + row.awards, 0), redemptions: rows.reduce((sum, row) => sum + row.redemptions, 0) },
    locations: rows,
    countingRule: "Karten zählen alle Anmeldungen je Standort, auch aus archivierten Programmen. Gutschriften zählen Online-Vergabe-Einträge und Einlösungen zählen Einlöse-Einträge seit Programmstart. Diese Rohzahlen bleiben nach einer späteren Korrektur unverändert. Die Summen umfassen alle Standorte dieses Betriebs.",
  };
}

export function selectionCookieName(actorUserId: string) {
  return `looplocal_location_${createHash("sha256").update(actorUserId).digest("hex").slice(0, 20)}`;
}

export function selectedLocationFromRequest(request: Request, actorUserId: string): string | null {
  const prefix = `${selectionCookieName(actorUserId)}=`;
  const raw = request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

export function selectionCookie(actorUserId: string, locationId: string) {
  const secure = process.env.PUBLIC_BASE_URL?.startsWith("https://") ? "; Secure" : "";
  return `${selectionCookieName(actorUserId)}=${locationId}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${secure}`;
}
