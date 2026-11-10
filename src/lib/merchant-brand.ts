import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { locations, programs, staffRoles, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { enqueueWalletProgramRefresh } from "./wallet/enqueue";
import { walletLogoView } from "./wallet/logo";
import { checkedLogoUpload } from "./wallet/logo-process";

const name = z.string().trim().min(2).max(180);
export const brandUpdateSchema = z.object({
  programSlug: z.string().min(1).max(120),
  businessName: name, locationName: name, brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoData: z.string().max(3_000_000).nullable().optional(),
}).strict();
const inputSchema = brandUpdateSchema.extend({ actorUserId: z.string().min(1) }).strict();

type Query = Pick<typeof db, "select">;

async function ownerProgramme(query: Query, actorUserId: string, programSlug: string) {
  const [program] = await query.select({ tenantId: programs.tenantId, locationId: programs.locationId })
    .from(programs).where(and(eq(programs.slug, programSlug), eq(programs.status, "active"))).limit(1);
  if (!program) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
  const [role] = await query.select({ userId: staffRoles.userId }).from(staffRoles)
    .where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!role) throw new DomainError("FORBIDDEN", "Das darf nur die Inhaberin oder der Inhaber.");
  return program;
}

export async function getMerchantBrand(raw: { actorUserId: string; programSlug: string }) {
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120) }).strict().parse(raw);
  const program = await ownerProgramme(db, input.actorUserId, input.programSlug);
  const [brand] = await db.select({ businessName: tenants.name, locationName: locations.name, brandColor: locations.brandColor, logoData: locations.logoData })
    .from(locations).innerJoin(tenants, eq(tenants.id, locations.tenantId))
    .where(and(eq(locations.id, program.locationId), eq(locations.tenantId, program.tenantId))).limit(1);
  if (!brand) throw new DomainError("NOT_FOUND", "Diesen Standort haben wir nicht gefunden. Bitte lade die Seite neu.");
  return { ...brand, logoWallet: await walletLogoView(brand.logoData, brand.brandColor) };
}

export async function updateMerchantBrand(raw: z.input<typeof inputSchema>) {
  const input = inputSchema.parse(raw);
  // Owners only reach the image decoder; the transaction checks again under the row lock.
  if (input.logoData != null) await ownerProgramme(db, input.actorUserId, input.programSlug);
  const logoData = input.logoData == null ? input.logoData : await checkedLogoUpload(input.logoData);
  const brand = await db.transaction(async tx => {
    const program = await ownerProgramme(tx, input.actorUserId, input.programSlug);
    const [location] = await tx.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.id, program.locationId), eq(locations.tenantId, program.tenantId))).for("update").limit(1);
    if (!location) throw new DomainError("NOT_FOUND", "Diesen Standort haben wir nicht gefunden. Bitte lade die Seite neu.");
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
  return { ...brand, logoWallet: await walletLogoView(brand.logoData, brand.brandColor) };
}
