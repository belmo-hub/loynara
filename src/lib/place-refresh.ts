import { and, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { locations, programs } from "@/db/schema";
import { placeLocation } from "./place-search";
import { enqueueWalletProgramRefresh } from "./wallet/enqueue";

const DAY = 24 * 60 * 60_000;
// Google's EEA terms keep a Places point at most 30 days from its fetch (Legal P-1). Refreshed after 25; cleared from day 27
// (Legal, after the review: runs drift by their own length and a calendar reading counts the fetch day). Counted from
// place_location_fetched_at only, never from other edits.
export const REFRESH_AFTER_DAYS = 25, CLEAR_AFTER_DAYS = 27;

/** Daily (ENG-323): refresh due Google points via Place Details (`location` only), clear those that could not be refreshed in
 *  time, and bring back a cleared one once Google answers again. The place id stays. Without a key it only clears. */
export async function refreshPlaceLocations(env: Readonly<Record<string, string | undefined>> = process.env, http: typeof fetch = fetch, now = new Date()) {
  const refreshBefore = new Date(now.getTime() - REFRESH_AFTER_DAYS * DAY), clearBefore = new Date(now.getTime() - CLEAR_AFTER_DAYS * DAY);
  const due = await db.select({ id: locations.id, tenantId: locations.tenantId, placeId: locations.googlePlaceId }).from(locations)
    .where(and(isNotNull(locations.googlePlaceId), or(lt(locations.placeLocationFetchedAt, refreshBefore), and(isNull(locations.latitude), isNull(locations.placeLocationFetchedAt)))));
  let refreshed = 0, cleared = 0;
  for (const location of due) {
    const point = env.GOOGLE_MAPS_API_KEY ? await placeLocation(location.placeId!, undefined, env, http) : null;
    // Re-checked in the update: a point the owner or operator set meanwhile (fetched-at null, a point kept) is never touched.
    const still = point ? or(lt(locations.placeLocationFetchedAt, refreshBefore), and(isNull(locations.latitude), isNull(locations.placeLocationFetchedAt))) : lte(locations.placeLocationFetchedAt, clearBefore);
    const changed = await db.transaction(async tx => {
      const rows = await tx.update(locations).set(point ? { ...point, placeLocationFetchedAt: now } : { latitude: null, longitude: null, placeLocationFetchedAt: null })
        .where(and(eq(locations.id, location.id), still)).returning({ id: locations.id });
      if (!rows.length) return false;
      // Passes carry the point: they follow the refresh or the clearing.
      const held = await tx.select({ id: programs.id }).from(programs).where(and(eq(programs.tenantId, location.tenantId), eq(programs.locationId, location.id)));
      for (const program of held) await enqueueWalletProgramRefresh(tx, location.tenantId, program.id);
      return true;
    });
    if (changed && point) refreshed++; else if (changed) cleared++;
  }
  return { refreshed, cleared };
}
