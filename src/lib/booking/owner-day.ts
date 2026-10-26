import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bookingBlockedCustomers, locations } from "@/db/schema";

/** What the owner's day view needs beyond dayView(): the shop's timezone and which of these cards are paused for booking. */
export async function dayExtras(scope: { tenantId: string; locationId: string }, membershipIds: string[]) {
  const [location] = await db.select({ timezone: locations.timezone }).from(locations).where(and(eq(locations.tenantId, scope.tenantId), eq(locations.id, scope.locationId)));
  const blocked = membershipIds.length ? await db.select({ id: bookingBlockedCustomers.membershipId }).from(bookingBlockedCustomers)
    .where(and(eq(bookingBlockedCustomers.tenantId, scope.tenantId), inArray(bookingBlockedCustomers.membershipId, [...new Set(membershipIds)]))) : [];
  return { timezone: location?.timezone ?? "Europe/Berlin", blockedMembershipIds: blocked.map(row => row.id) };
}
