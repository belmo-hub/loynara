import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { locations, memberships, outboxJobs, tenants, walletPasses } from "@/db/schema";
import { nfcFixture } from "./nfc-test-db";
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

  it("clears a point that could not be refreshed from day 27 and keeps the place id; before day 27 it stays", async () => {
    const day26 = await shop(26.99), day27 = await shop(27);
    expect(await refreshPlaceLocations(KEY, failing(), NOW)).toEqual({ refreshed: 0, cleared: 1 });
    expect(await row(day27)).toEqual({ latitude: null, longitude: null, placeId: "ChIJ_synthetic-1", fetchedAt: null });
    expect(await row(day26)).toMatchObject({ latitude: 51.3, fetchedAt: ago(26.99) });
  });

  it("counts from the last fetch only: an unrelated edit of the location does not reset the clock", async () => {
    const id = await shop(27.5);
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

  it("never overwrites a point the operator sets while Google is being asked (review J6b)", async () => {
    const id = await shop(26);
    const http = vi.fn<typeof fetch>(async () => {
      await db.update(locations).set({ latitude: 52, longitude: 10, placeLocationFetchedAt: null }).where(eq(locations.id, id));
      return Response.json({ location: { latitude: 51.4, longitude: 9.5 } });
    });
    expect(await refreshPlaceLocations(KEY, http, NOW)).toEqual({ refreshed: 0, cleared: 0 });
    expect(await row(id)).toEqual({ latitude: 52, longitude: 10, placeId: "ChIJ_synthetic-1", fetchedAt: null });
  });

  it("queues one wallet refresh per live pass of that location only, and none on a second run the same day (review J8)", async () => {
    const f = await nfcFixture(), other = await nfcFixture();
    const card = async (closed: boolean) => (await db.insert(memberships).values({ tenantId: f.tenant.id, programId: f.program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID().replaceAll("-", "")}`, closedAt: closed ? new Date() : null }).returning())[0];
    const pass = (tenantId: string, membershipId: string, revoked = false) => db.insert(walletPasses).values({ tenantId, membershipId, provider: "apple", status: revoked ? "revoked" : "active", revokedAt: revoked ? new Date() : null, revokeReason: revoked ? "reissued" : null, providerObjectId: randomUUID() });
    await pass(f.tenant.id, f.member.id);
    await pass(f.tenant.id, (await card(false)).id, true);
    await pass(f.tenant.id, (await card(true)).id);
    await pass(other.tenant.id, other.member.id);
    const point = { latitude: 51.3, longitude: 9.4, googlePlaceId: "ChIJ_synthetic-1" };
    await db.update(locations).set({ ...point, placeLocationFetchedAt: ago(26) }).where(eq(locations.id, f.location.id));
    await db.update(locations).set({ ...point, placeLocationFetchedAt: ago(3) }).where(eq(locations.id, other.location.id));
    const queued = async () => (await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "wallet.refresh"))).map(job => (job.payload as { membershipId: string }).membershipId);
    expect(await refreshPlaceLocations(KEY, answering(), NOW)).toEqual({ refreshed: 1, cleared: 0 });
    expect(await queued()).toEqual([f.member.id]);
    expect(await refreshPlaceLocations(KEY, answering(), NOW)).toEqual({ refreshed: 0, cleared: 0 });
    expect(await queued()).toEqual([f.member.id]);
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
