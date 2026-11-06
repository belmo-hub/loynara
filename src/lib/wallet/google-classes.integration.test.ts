import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { walletGoogleClasses } from "@/db/schema";
import { updateMerchantBrand } from "@/lib/merchant-brand";
import { createMerchant, enroll } from "@/lib/product";
import { walletAvailability } from "./capability";
import { walletCardEligibility } from "./eligibility";
import { googleObjectId, GoogleWalletClient } from "./google";
import { googleDirectEnv, syncGoogleClasses } from "./google-classes";
import { googleDirectConfig, googleDirectStatus } from "./google-direct";
import { issueWalletPass } from "./issue";
import { refreshWalletForMembership } from "./refresh";
import { fakeGoogleApi, googleFixture, withEnv } from "./test-support";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Requires isolated looplocal_test");
const ISSUER = "3388000000023201754";
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function shop(name = "Synthetic Café") {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Synthetic owner", `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName: name, locationName: "Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Stamps", programType: "stamp", rulesText: "One stamp per purchase.", rewardTitle: "Coffee", rewardCost: 8 });
  return { userId, ...merchant };
}
type Shop = Awaited<ReturnType<typeof shop>>;
const classIdOf = (s: Shop) => `${ISSUER}.program_${s.programId}`;
const rowOf = async (s: Shop) => (await db.select().from(walletGoogleClasses).where(eq(walletGoogleClasses.programId, s.programId)))[0];
const approve = (api: ReturnType<typeof fakeGoogleApi>, s: Shop) => api.classes.set(classIdOf(s), { ...api.classes.get(classIdOf(s)), reviewStatus: "approved" });
const scoped = async (s: Shop) => googleDirectStatus(await googleDirectEnv(s.tenantId, s.locationId, s.programId), s.tenantId, s.locationId, s.programId);
const classCalls = (api: ReturnType<typeof fakeGoogleApi>, from = 0) => api.calls.slice(from).filter(call => call.url.includes("/loyaltyClass"));
async function withGoogle<T>(fn: () => Promise<T>, publishing: "published" | "demo" = "published", extra: Record<string, string | undefined> = {}) {
  const google = googleFixture(publishing);
  try { return await withEnv({ ...google.env, ...extra }, fn); } finally { google.cleanup(); }
}

describe("Google Wallet classes per shop (ENG-175)", () => {
  it("creates a class once, issues only after Google approves it, and then costs no call", async () => {
    const s = await shop();
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      expect(await syncGoogleClasses(process.env, api.fetcher)).toEqual({ synced: 1, failed: 0 });
      expect(classCalls(api).map(call => call.method)).toEqual(["GET", "POST"]);
      expect(api.classes.get(classIdOf(s))).toMatchObject({ issuerName: "Synthetic Café", reviewStatus: "UNDER_REVIEW" });
      expect(await rowOf(s)).toMatchObject({ classId: classIdOf(s), status: "under_review", lastError: null });
      expect((await scoped(s)).ready).toBe(false); // the customer sees no Google button yet

      let before = api.calls.length;
      await syncGoogleClasses(process.env, api.fetcher); // Google still reviewing: look, never create again
      expect(classCalls(api, before).map(call => call.method)).toEqual(["GET"]);

      approve(api, s);
      await syncGoogleClasses(process.env, api.fetcher);
      expect((await rowOf(s)).status).toBe("approved");
      expect((await scoped(s)).ready).toBe(true);
      expect(walletAvailability(await googleDirectEnv(s.tenantId, s.locationId, s.programId), s.tenantId, s.locationId, s.programId).google).toBe("available");

      before = api.calls.length;
      expect(await syncGoogleClasses(process.env, api.fetcher)).toEqual({ synced: 0, failed: 0 });
      expect(api.calls.slice(before)).toEqual([]);
    });
  });

  it("carries a card from the table alone, no env binding: eligibility, issue and refresh all read the row", async () => {
    const s = await shop();
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    const google = googleFixture();
    try {
      await withEnv({ ...google.env, PUBLIC_BASE_URL: "http://localhost:3000" }, async () => {
        const api = fakeGoogleApi();
        expect((await walletCardEligibility(card.cardToken)).availability.google).toBe("unavailable");
        await syncGoogleClasses(process.env, api.fetcher);
        approve(api, s);
        await syncGoogleClasses(process.env, api.fetcher);
        expect((await walletCardEligibility(card.cardToken)).availability.google).toBe("available");
        const config = googleDirectConfig(await googleDirectEnv(s.tenantId, s.locationId, s.programId), s.tenantId, s.locationId, s.programId);
        const pass = await issueWalletPass(card.cardToken, "google", id => googleObjectId(id, config));
        expect(await refreshWalletForMembership(card.id, { google: new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: google.privateKey }, api.fetcher) })).toMatchObject({ status: "complete" });
        expect(api.objects.get(pass.providerObjectId)).toMatchObject({ classId: classIdOf(s), state: "ACTIVE" });
      });
    } finally { google.cleanup(); }
  });

  it("survives a racing create: a class that already exists is adopted, not duplicated", async () => {
    const s = await shop();
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      api.classes.set(classIdOf(s), { id: classIdOf(s), reviewStatus: "approved", issuerName: "Old name" });
      await syncGoogleClasses(process.env, api.fetcher);
      expect(classCalls(api).some(call => call.method === "POST")).toBe(false);
      expect(api.classes.get(classIdOf(s))).toMatchObject({ issuerName: "Synthetic Café" });
    });
  });

  it("keeps the class in step with the shop: a changed name and colour go to Google, under review", async () => {
    const s = await shop();
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      await syncGoogleClasses(process.env, api.fetcher);
      approve(api, s);
      await syncGoogleClasses(process.env, api.fetcher);
      await updateMerchantBrand({ actorUserId: s.userId, programSlug: s.programSlug, businessName: "New Name Café", locationName: "Mitte", brandColor: "#2f6b58" });
      await syncGoogleClasses(process.env, api.fetcher);
      expect(api.calls.at(-1)).toMatchObject({ method: "PATCH", body: { issuerName: "New Name Café", hexBackgroundColor: "#2f6b58", reviewStatus: "UNDER_REVIEW" } });
      expect((await rowOf(s)).status).toBe("under_review");
    });
  });

  it("a Google failure is recorded for the operator, blocks no card, and the next run recovers", async () => {
    const s = await shop();
    await withGoogle(async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await syncGoogleClasses(process.env, fakeGoogleApi({ failWith: 503 }).fetcher)).toEqual({ synced: 0, failed: 1 });
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();
      expect(await rowOf(s)).toMatchObject({ status: "pending", lastError: "class lookup" });
      expect((await scoped(s)).ready).toBe(false);
      expect(await enroll({ slug: s.programSlug, acceptedTerms: true })).toMatchObject({ cardToken: expect.any(String) });
      await syncGoogleClasses(process.env, fakeGoogleApi().fetcher);
      expect(await rowOf(s)).toMatchObject({ status: "under_review", lastError: null });
    });
  });

  it("leaves a rejected class alone until the shop changes it", async () => {
    const s = await shop();
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      await syncGoogleClasses(process.env, api.fetcher);
      api.classes.set(classIdOf(s), { ...api.classes.get(classIdOf(s)), reviewStatus: "rejected" });
      await syncGoogleClasses(process.env, api.fetcher);
      expect((await rowOf(s)).status).toBe("rejected");
      expect((await scoped(s)).ready).toBe(false);
      const before = api.calls.length;
      await syncGoogleClasses(process.env, api.fetcher);
      expect(api.calls.slice(before)).toEqual([]);
    });
  });

  it("keeps shops apart: own class each, one shop's failure stops no other, and no scope borrows another's row", async () => {
    const [a, b] = [await shop("Shop A"), await shop("Shop B")];
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const failingA: typeof fetch = async (input, init) => String(input).includes(encodeURIComponent(classIdOf(a))) ? new Response(null, { status: 500 }) : api.fetcher(input, init);
      expect(await syncGoogleClasses(process.env, failingA)).toEqual({ synced: 1, failed: 1 });
      error.mockRestore();
      expect(await rowOf(a)).toMatchObject({ status: "pending", lastError: "class lookup" });
      expect(await rowOf(b)).toMatchObject({ status: "under_review", lastError: null });
      expect(api.classes.get(classIdOf(b))).toMatchObject({ issuerName: "Shop B" });
      approve(api, b);
      await syncGoogleClasses(process.env, api.fetcher);
      expect(await googleDirectEnv(a.tenantId, b.locationId, b.programId)).toBe(process.env); // another tenant's location and programme: no row, no binding
      expect(googleDirectStatus(await googleDirectEnv(a.tenantId, b.locationId, b.programId), a.tenantId, b.locationId, b.programId).ready).toBe(false);
      expect((await scoped(b)).ready).toBe(true);
    });
  });

  it("creates nothing in Demo Mode or with Google off: the demo class stays an explicit env binding", async () => {
    await shop();
    const api = fakeGoogleApi();
    await withGoogle(async () => { expect(await syncGoogleClasses(process.env, api.fetcher)).toEqual({ synced: 0, failed: 0 }); }, "demo");
    await withGoogle(async () => { expect(await syncGoogleClasses(process.env, api.fetcher)).toEqual({ synced: 0, failed: 0 }); }, "published", { GOOGLE_WALLET_ENABLED: undefined });
    expect(api.calls).toEqual([]);
    expect(await db.select().from(walletGoogleClasses)).toEqual([]);
  });

  it("never touches the managed PassFast issuer, and leaves a scope the env binds to the env", async () => {
    const s = await shop();
    const api = fakeGoogleApi();
    await withGoogle(async () => { await syncGoogleClasses(process.env, api.fetcher); }, "published", { GOOGLE_WALLET_ISSUER_ID: "3388000000023094673" });
    expect(api.calls).toEqual([]);
    const binding = { tenantId: s.tenantId, locationId: s.locationId, programId: s.programId, classId: `${ISSUER}.legacy_class`, issuanceEnabled: true, testAccountsApproved: false };
    await withGoogle(async () => {
      await syncGoogleClasses(process.env, api.fetcher);
      expect((await scoped(s)).ready).toBe(true);
    }, "published", { GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([binding]) });
    expect(api.calls).toEqual([]);
    expect(await db.select().from(walletGoogleClasses)).toEqual([]);
  });
});
