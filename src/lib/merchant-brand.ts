import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { locations, programs, staffRoles, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { enqueueWalletProgramRefresh } from "./wallet/enqueue";

const name = z.string().trim().min(2).max(180);
export const brandUpdateSchema = z.object({
  programSlug: z.string().min(1).max(120),
  businessName: name, locationName: name, brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoData: z.string().max(3_000_000).nullable().optional(),
}).strict();
const inputSchema = brandUpdateSchema.extend({ actorUserId: z.string().min(1) }).strict();

function checkedLogo(value: string | null | undefined) {
  if (value === undefined || value === null) return value;
  const match = /^data:(image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new DomainError("INVALID_LOGO", "Logo must be PNG, JPEG or WebP");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 16 || bytes.length > 2_000_000) throw new DomainError("INVALID_LOGO", "Logo must be at most 2 MB");
  const magic = bytes.subarray(0, 12).toString("hex");
  const valid = match[1] === "image/png" ? magic.startsWith("89504e470d0a1a0a")
    : match[1] === "image/jpeg" ? magic.startsWith("ffd8ff")
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new DomainError("INVALID_LOGO", "Logo format does not match its contents");
  return value;
}

type Query = Pick<typeof db, "select">;

async function ownerProgramme(query: Query, actorUserId: string, programSlug: string) {
  const [program] = await query.select({ tenantId: programs.tenantId, locationId: programs.locationId })
    .from(programs).where(and(eq(programs.slug, programSlug), eq(programs.status, "active"))).limit(1);
  if (!program) throw new DomainError("NOT_FOUND", "Programme not found");
  const [role] = await query.select({ userId: staffRoles.userId }).from(staffRoles)
    .where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!role) throw new DomainError("FORBIDDEN", "Owner access required");
  return program;
}

export async function getMerchantBrand(raw: { actorUserId: string; programSlug: string }) {
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120) }).strict().parse(raw);
  const program = await ownerProgramme(db, input.actorUserId, input.programSlug);
  const [brand] = await db.select({ businessName: tenants.name, locationName: locations.name, brandColor: locations.brandColor, logoData: locations.logoData })
    .from(locations).innerJoin(tenants, eq(tenants.id, locations.tenantId))
    .where(and(eq(locations.id, program.locationId), eq(locations.tenantId, program.tenantId))).limit(1);
  if (!brand) throw new DomainError("NOT_FOUND", "Location not found");
  return brand;
}

export async function updateMerchantBrand(raw: z.input<typeof inputSchema>) {
  const input = inputSchema.parse(raw);
  const logoData = checkedLogo(input.logoData);
  return db.transaction(async tx => {
    const program = await ownerProgramme(tx, input.actorUserId, input.programSlug);
    const [location] = await tx.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.id, program.locationId), eq(locations.tenantId, program.tenantId))).for("update").limit(1);
    if (!location) throw new DomainError("NOT_FOUND", "Location not found");
    await tx.update(tenants).set({ name: input.businessName }).where(eq(tenants.id, program.tenantId));
    await tx.update(locations).set({
      name: input.locationName, brandColor: input.brandColor,
      ...(logoData !== undefined ? { logoData } : {}),
    }).where(and(eq(locations.id, location.id), eq(locations.tenantId, program.tenantId)));
    // The merchant name appears on every programme's passes; colour and logo on this location's. Coalesced per card.
    await enqueueWalletProgramRefresh(tx, program.tenantId);
    const [brand] = await tx.select({ businessName: tenants.name, locationName: locations.name, brandColor: locations.brandColor, logoData: locations.logoData })
      .from(locations).innerJoin(tenants, eq(tenants.id, locations.tenantId))
      .where(eq(locations.id, location.id)).limit(1);
    return brand;
  });
}
