import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { ownerAcceptances, staffRoles, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { BOOKING_AVV_VERSION, OWNER_AVV, OWNER_TERMS } from "./owner-contract";
import { OWNER_PRIVACY_NOTICE } from "./owner-privacy";

/** The button's sentence in the app (ENG-339); a new wording gets a new version, like SIGNUP_ACCEPTANCE_TEXT_VERSION. */
export const BOOKING_AVV_ACCEPTANCE_TEXT_VERSION = "2026-11-23";
export const BOOKING_AVV_OWNER_ONLY = "Nur das Inhaberkonto kann die Auftragsverarbeitung annehmen.";

/** Only the Inhaberkonto is weisungsberechtigt (AVV header), so only an active owner role counts (Legal, 22 Nov). */
async function ownerTenant(userId: string, reader: Pick<typeof db, "select"> = db) {
  const [role] = await reader.select({ tenantId: staffRoles.tenantId }).from(staffRoles)
    .where(and(eq(staffRoles.userId, userId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!role) throw new DomainError("FORBIDDEN", BOOKING_AVV_OWNER_ONLY);
  return role.tenantId;
}

/** When the business accepted the AVV Fassung with Terminbuchung (or a later one), or null. The same test as the operator's switch. */
export async function bookingAvvStatus(userId: string) {
  const tenantId = await ownerTenant(userId);
  const [row] = await db.select({ acceptedAt: ownerAcceptances.acceptedAt }).from(ownerAcceptances)
    .where(and(eq(ownerAcceptances.tenantId, tenantId), gte(ownerAcceptances.avvVersion, BOOKING_AVV_VERSION)))
    .orderBy(desc(ownerAcceptances.acceptedAt)).limit(1);
  return { version: OWNER_AVV.version, stand: OWNER_AVV.stand, acceptedAt: row?.acceptedAt.toISOString() ?? null };
}

/** ENG-339: the owner accepts the current AVV Fassung (and terms) in the app: one append-only row; a repeat adds nothing. */
export async function acceptBookingAvv(userId: string) {
  await db.transaction(async tx => {
    const tenantId = await ownerTenant(userId, tx);
    // One acceptance per business is enough; the lock keeps two taps from writing two rows.
    await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).for("update");
    const [done] = await tx.select({ id: ownerAcceptances.id }).from(ownerAcceptances)
      .where(and(eq(ownerAcceptances.tenantId, tenantId), gte(ownerAcceptances.avvVersion, OWNER_AVV.version))).limit(1);
    if (done) return;
    // The time is the database's (insert trigger), the versions the server's, never the caller's.
    await tx.insert(ownerAcceptances).values({ userId, tenantId, path: "booking", termsVersion: OWNER_TERMS.version, avvVersion: OWNER_AVV.version,
      privacyVersion: OWNER_PRIVACY_NOTICE.version, textVersion: BOOKING_AVV_ACCEPTANCE_TEXT_VERSION });
  });
  return bookingAvvStatus(userId);
}
