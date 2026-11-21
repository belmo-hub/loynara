import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { locations, tenants } from "@/db/schema";
import { refreshPlaceLocations } from "./place-refresh";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");
beforeEach(async () => { await pool.query("TRUNCATE TABLE tenants CASCADE"); });
afterAll(async () => { await pool.end(); });

const NOW = new Date("2026-12-31T03:00:00Z"), DAY = 24 * 60 * 60_000, KEY = { GOOGLE_MAPS_API_KEY: "synthetic-test-key" };
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
async function shop(fetchedDaysAgo: number | null, point: { latitude: number | null; longitude: number | null } = { latitude: 51.3, longitude: 9.4 }) {
  const [tenant] = await db.insert(tenants).values({ name: "Synthetic place shop", slug: randomUUID() }).returning();
  const [location] = await db.insert(locations).values({ tenantId: tenant.id, name: "Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", ...point, googlePlaceId: "ChIJ_synthetic-1", placeLocationFetchedAt: fetchedDaysAgo === null ? null : ago(fetchedDaysAgo) }).returning();
  return location.id;
}
const row = async (id: string) => (await db.select({ latitude: locations.latitude, longitude: locations.longitude, placeId: locations.googlePlaceId, fetchedAt: locations.placeLocationFetchedAt }).from(locations).where(eq(locations.id, id)))[0];
const answering = () => vi.fn<typeof fetch>(async () => Response.json({ location: { latitude: 51.4, longitude: 9.5 } }));
const failing = () => vi.fn<typeof fetch>(async () => new Response("quota", { status: 429 }));

describe("Google place points follow the 30-day limit (ENG-323, Legal P-1)", () => {
  it("refreshes only points older than 25 days, with the location field only, and restarts their clock", async () => {
    const fresh = await shop(24.9), due = await shop(25.01);
    const http = answering();
    expect(await refreshPlaceLocations(KEY, http, NOW)).toEqual({ refreshed: 1, cleared: 0 });
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0][0]).toBe("https://places.googleapis.com/v1/places/ChIJ_synthetic-1");
    expect(http.mock.calls[0][1]?.headers).toMatchObject({ "X-Goog-FieldMask": "location" });
    expect(await row(due)).toEqual({ latitude: 51.4, longitude: 9.5, placeId: "ChIJ_synthetic-1", fetchedAt: NOW });
    expect(await row(fresh)).toMatchObject({ latitude: 51.3, fetchedAt: ago(24.9) });
  });

  it("clears a point that could not be refreshed by day 29 and keeps the place id; before day 29 it stays", async () => {
    const day28 = await shop(28.99), day29 = await shop(29);
    expect(await refreshPlaceLocations(KEY, failing(), NOW)).toEqual({ refreshed: 0, cleared: 1 });
    expect(await row(day29)).toEqual({ latitude: null, longitude: null, placeId: "ChIJ_synthetic-1", fetchedAt: null });
    expect(await row(day28)).toMatchObject({ latitude: 51.3, fetchedAt: ago(28.99) });
  });

  it("counts from the last fetch only: an unrelated edit of the location does not reset the clock", async () => {
    const id = await shop(29.5);
    await db.update(locations).set({ name: "Neuer Name", brandColor: "#2F6B58" }).where(eq(locations.id, id));
    expect(await refreshPlaceLocations(KEY, failing(), NOW)).toEqual({ refreshed: 0, cleared: 1 });
    expect(await row(id)).toMatchObject({ latitude: null, longitude: null });
  });

  it("without a key only clears, and never calls Google", async () => {
    const day26 = await shop(26), day30 = await shop(30);
    const http = answering();
    expect(await refreshPlaceLocations({}, http, NOW)).toEqual({ refreshed: 0, cleared: 1 });
    expect(http).not.toHaveBeenCalled();
    expect(await row(day26)).toMatchObject({ latitude: 51.3 });
    expect(await row(day30)).toMatchObject({ latitude: null, placeId: "ChIJ_synthetic-1" });
  });

  it("brings a cleared point back once Google answers, and leaves the operator's own point alone", async () => {
    const cleared = await shop(null, { latitude: null, longitude: null }), own = await shop(null);
    const http = answering();
    expect(await refreshPlaceLocations(KEY, http, NOW)).toEqual({ refreshed: 1, cleared: 0 });
    expect(http).toHaveBeenCalledTimes(1);
    expect(await row(cleared)).toMatchObject({ latitude: 51.4, fetchedAt: NOW });
    expect(await row(own)).toEqual({ latitude: 51.3, longitude: 9.4, placeId: "ChIJ_synthetic-1", fetchedAt: null });
  });
});
