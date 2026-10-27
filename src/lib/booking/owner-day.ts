import { and, desc, eq, inArray, min, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookingAppointments, bookingBlockedCustomers, bookingSettings, locations, memberships, programs } from "@/db/schema";
import { formatCardLocator } from "@/lib/card-locator";
import { instantToWall } from "./time";

type Scope = { tenantId: string; locationId: string };

/**
 * What the owner's day view needs beyond dayView(): the shop's timezone, which of these cards are paused for booking,
 * whether online booking is on (null = never set up) and the shop's day of the next open request.
 */
export async function dayExtras(scope: Scope, membershipIds: string[], now = new Date()) {
  const [location] = await db.select({ timezone: locations.timezone }).from(locations).where(and(eq(locations.tenantId, scope.tenantId), eq(locations.id, scope.locationId)));
  const timezone = location?.timezone ?? "Europe/Berlin";
  const blocked = membershipIds.length ? await db.select({ id: bookingBlockedCustomers.membershipId }).from(bookingBlockedCustomers)
    .where(and(eq(bookingBlockedCustomers.tenantId, scope.tenantId), inArray(bookingBlockedCustomers.membershipId, [...new Set(membershipIds)]))) : [];
  const [settings] = await db.select({ enabled: bookingSettings.enabled }).from(bookingSettings).where(and(eq(bookingSettings.tenantId, scope.tenantId), eq(bookingSettings.locationId, scope.locationId)));
  const [next] = await db.select({ start: min(sql<Date>`lower(${bookingAppointments.during})`) }).from(bookingAppointments)
    .where(and(eq(bookingAppointments.tenantId, scope.tenantId), eq(bookingAppointments.locationId, scope.locationId), eq(bookingAppointments.status, "requested"), sql`upper(${bookingAppointments.during}) > ${now.toISOString()}::timestamptz`));
  return {
    timezone, blockedMembershipIds: blocked.map(row => row.id), bookingEnabled: settings ? settings.enabled : null,
    nextRequestDate: next?.start ? instantToWall(new Date(next.start), timezone).date : null,
  };
}

/** The cards of this location paused for online booking, newest first; the name is the one on the card's latest appointment here. */
export async function blockedCustomers(scope: Scope) {
  const rows = await db.select({
    membershipId: bookingBlockedCustomers.membershipId, blockedAt: bookingBlockedCustomers.blockedAt, reason: bookingBlockedCustomers.reason, cardLocator: memberships.cardLocator,
    name: sql<string | null>`(SELECT a.customer_name FROM booking_appointments a WHERE a.tenant_id = ${bookingBlockedCustomers.tenantId} AND a.membership_id = ${bookingBlockedCustomers.membershipId}
      AND a.location_id = ${scope.locationId}::uuid ORDER BY lower(a.during) DESC LIMIT 1)`,
  }).from(bookingBlockedCustomers)
    .innerJoin(memberships, and(eq(memberships.tenantId, bookingBlockedCustomers.tenantId), eq(memberships.id, bookingBlockedCustomers.membershipId)))
    .innerJoin(programs, and(eq(programs.tenantId, memberships.tenantId), eq(programs.id, memberships.programId)))
    .where(and(eq(bookingBlockedCustomers.tenantId, scope.tenantId), eq(programs.locationId, scope.locationId)))
    .orderBy(desc(bookingBlockedCustomers.blockedAt)).limit(200);
  return rows.map(row => ({ membershipId: row.membershipId, name: row.name || "Kunde", cardLocator: formatCardLocator(row.cardLocator), blockedAt: row.blockedAt.toISOString(), reason: row.reason }));
}
