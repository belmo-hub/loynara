import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { ownerAcceptances, staffRoles, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { BOOKING_AVV_VERSION, BOOKING_TERMS_VERSION, OWNER_AVV, OWNER_TERMS } from "./owner-contract";
import { OWNER_PRIVACY_NOTICE } from "./owner-privacy";

/** The button's sentence in the app (ENG-339); a new wording gets a new version, like SIGNUP_ACCEPTANCE_TEXT_VERSION. */
export const BOOKING_AVV_ACCEPTANCE_TEXT_VERSION = "2026-11-24";
export const BOOKING_AVV_OWNER_ONLY = "Nur das Inhaberkonto kann die Auftragsverarbeitung annehmen.";

/** Only the Inhaberkonto is weisungsberechtigt (AVV header), so only an active owner role counts (Legal, 22 Nov). */
async function ownerTenant(userId: string, reader: Pick<typeof db, "select"> = db) {
  const [role] = await reader.select({ tenantId: staffRoles.tenantId }).from(staffRoles)
    .where(and(eq(staffRoles.userId, userId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!role) throw new DomainError("FORBIDDEN", BOOKING_AVV_OWNER_ONLY);
  return role.tenantId;
}

/** Both Fassungen with „Termin + Treue“ (or later ones) in one acceptance: the terms and the AVV (Legal § 5). The operator's switch asks the same. */
export const bookingAccepted = (tenantId: string) => and(eq(ownerAcceptances.tenantId, tenantId), gte(ownerAcceptances.avvVersion, BOOKING_AVV_VERSION), gte(ownerAcceptances.termsVersion, BOOKING_TERMS_VERSION));

/** When the business accepted them, or null; /api/me carries it for the owner, so the settings page never grows after it scrolls. */
export async function bookingAcceptedAt(tenantId: string) {
  const [row] = await db.select({ acceptedAt: ownerAcceptances.acceptedAt }).from(ownerAcceptances)
    .where(bookingAccepted(tenantId))
    .orderBy(desc(ownerAcceptances.acceptedAt)).limit(1);
  return row?.acceptedAt.toISOString() ?? null;
}

/** ENG-339: the owner accepts the current terms and AVV Fassung in the app: one append-only row with both versions; a repeat adds nothing. */
export async function acceptBookingAvv(userId: string) {
  const tenantId = await db.transaction(async tx => {
    const tenantId = await ownerTenant(userId, tx);
    // One acceptance per business is enough; the lock keeps two taps from writing two rows.
    await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).for("update");
    const [done] = await tx.select({ id: ownerAcceptances.id }).from(ownerAcceptances)
      .where(and(eq(ownerAcceptances.tenantId, tenantId), gte(ownerAcceptances.avvVersion, OWNER_AVV.version), gte(ownerAcceptances.termsVersion, OWNER_TERMS.version))).limit(1);
    if (done) return tenantId;
    // The time is the database's (insert trigger), the versions the server's, never the caller's.
    await tx.insert(ownerAcceptances).values({ userId, tenantId, path: "booking", termsVersion: OWNER_TERMS.version, avvVersion: OWNER_AVV.version,
      privacyVersion: OWNER_PRIVACY_NOTICE.version, textVersion: BOOKING_AVV_ACCEPTANCE_TEXT_VERSION });
    return tenantId;
  });
  return { acceptedAt: await bookingAcceptedAt(tenantId) };
}
