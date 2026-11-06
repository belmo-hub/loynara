import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { locations, walletGoogleClasses, walletPasses } from "@/db/schema";
import { award } from "@/lib/loyalty";
import { updateMerchantBrand } from "@/lib/merchant-brand";
import { createMerchant, enroll } from "@/lib/product";
import { walletAvailability } from "./capability";
import { walletPassDataByMembershipId } from "./data";
import { walletCardEligibility } from "./eligibility";
import { googleObjectId, GoogleWalletClient } from "./google";
import { googleDirectEnv, overwriteGoogleClasses, syncGoogleClasses } from "./google-classes";
import { googleDirectConfig, googleDirectStatus } from "./google-direct";
import { issueWalletPass } from "./issue";
import { refreshWalletForMembership } from "./refresh";
import { appleFixture, fakeGoogleApi, googleFixture, withEnv } from "./test-support";

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

  it("sends a set, moved or removed shop pin to the class, with or without a pass (ENG-176 sets coordinates)", async () => {
    const s = await shop();
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      await syncGoogleClasses(process.env, api.fetcher);
      approve(api, s);
      await syncGoogleClasses(process.env, api.fetcher);
      const pin = (latitude: number | null, longitude: number | null) => db.update(locations).set({ latitude, longitude }).where(eq(locations.id, s.locationId));
      await pin(51.3127, 9.4797);
      await syncGoogleClasses(process.env, api.fetcher);
      expect(api.calls.at(-1)).toMatchObject({ method: "PATCH", body: { merchantLocations: [{ latitude: 51.3127, longitude: 9.4797 }], reviewStatus: "UNDER_REVIEW" } });
      approve(api, s);
      await pin(51.32, 9.5);
      await syncGoogleClasses(process.env, api.fetcher);
      expect(api.calls.at(-1)).toMatchObject({ method: "PATCH", body: { merchantLocations: [{ latitude: 51.32, longitude: 9.5 }] } });
      await pin(null, null);
      await syncGoogleClasses(process.env, api.fetcher);
      expect(api.calls.at(-1)).toMatchObject({ method: "PATCH", body: { merchantLocations: null } });
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

  it("clears an old failure note on an unchanged approved class, with no Google call", async () => {
    const s = await shop();
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      await syncGoogleClasses(process.env, api.fetcher);
      approve(api, s);
      await syncGoogleClasses(process.env, api.fetcher);
      await db.update(walletGoogleClasses).set({ lastError: "class lookup" }).where(eq(walletGoogleClasses.programId, s.programId));
      const before = api.calls.length;
      await syncGoogleClasses(process.env, api.fetcher);
      expect(await rowOf(s)).toMatchObject({ status: "approved", lastError: null });
      expect(api.calls.slice(before)).toEqual([]);
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

  it("overwrites an erased shop's class until nothing names the shop, and only then counts it done (Legal)", async () => {
    const s = await shop("Pizzeria Tappi");
    await db.update(locations).set({ latitude: 51.3127, longitude: 9.4797 }).where(eq(locations.id, s.locationId));
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      await syncGoogleClasses(process.env, api.fetcher);
      approve(api, s);
      await syncGoogleClasses(process.env, api.fetcher);
      api.classes.set(classIdOf(s), { ...api.classes.get(classIdOf(s)), wideProgramLogo: { sourceUri: { uri: "https://assets.example.test/wide.png" } } });
      expect(JSON.stringify(api.classes.get(classIdOf(s)))).toContain("Pizzeria Tappi");

      // Google reviews the overwrite: not done yet, recorded, and the shop's name is gone everywhere, the alt text included.
      await expect(overwriteGoogleClasses(s.tenantId, process.env, api.fetcher)).rejects.toMatchObject({ code: "EXTERNAL_PENDING" });
      const overwritten = api.classes.get(classIdOf(s))!;
      expect(JSON.stringify(overwritten)).not.toContain("Pizzeria Tappi");
      expect(overwritten).toMatchObject({ issuerName: "Programm beendet", programName: "Programm beendet", reviewStatus: "UNDER_REVIEW", wideProgramLogo: null, merchantLocations: null });
      expect((overwritten.programLogo as { sourceUri: { uri: string } }).sourceUri.uri).toBe(process.env.GOOGLE_WALLET_PROGRAM_LOGO_URL);
      expect(await rowOf(s)).toMatchObject({ status: "under_review", lastError: null }); // waiting, not a failure

      // The rerun only looks; once Google approves, it is done with no second write.
      approve(api, s);
      const before = api.calls.length;
      expect(await overwriteGoogleClasses(s.tenantId, process.env, api.fetcher)).toBe(1);
      expect(classCalls(api, before).map(call => call.method)).toEqual(["GET"]);
    });
  });

  it("holds the erasure when Google refuses or is off, and changes nothing for a shop without a class (Legal)", async () => {
    const s = await shop();
    const none = await shop("No class yet");
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      await syncGoogleClasses(process.env, api.fetcher);
      await expect(overwriteGoogleClasses(s.tenantId, process.env, fakeGoogleApi({ failWith: 503 }).fetcher)).rejects.toMatchObject({ code: "EXTERNAL_PENDING" });
      expect((await rowOf(s)).lastError).toBe("erasure class lookup");
      await db.delete(walletGoogleClasses).where(eq(walletGoogleClasses.programId, none.programId));
      const before = api.calls.length;
      expect(await overwriteGoogleClasses(none.tenantId, process.env, api.fetcher)).toBe(0);
      expect(api.calls.slice(before)).toEqual([]);
    });
    await withEnv({ GOOGLE_WALLET_ENABLED: undefined }, async () => {
      expect(await overwriteGoogleClasses(none.tenantId)).toBe(0);
      await expect(overwriteGoogleClasses(s.tenantId)).rejects.toMatchObject({ code: "EXTERNAL_PENDING" });
    });
    // A class Google no longer has is done: nothing is left to overwrite.
    await withGoogle(async () => { expect(await overwriteGoogleClasses(s.tenantId, process.env, fakeGoogleApi().fetcher)).toBe(1); });
  });

  /** An approved class with one card holding a Google pass, already out. */
  async function cardWithGooglePass(s: Shop, api: ReturnType<typeof fakeGoogleApi>) {
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await syncGoogleClasses(process.env, api.fetcher);
    approve(api, s);
    await syncGoogleClasses(process.env, api.fetcher);
    const config = googleDirectConfig(await googleDirectEnv(s.tenantId, s.locationId, s.programId), s.tenantId, s.locationId, s.programId);
    return { card, config, pass: await issueWalletPass(card.cardToken, "google", id => googleObjectId(id, config)) };
  }
  const clientFor = (fetcher: typeof fetch) => new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: readServiceKey() }, fetcher);
  const readServiceKey = () => JSON.parse(readFileSync(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!, "utf8")).private_key as string;
  const stamp = (s: Shop, membershipId: string) => award({ userId: s.userId, locationId: s.locationId, membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const setClass = async (api: ReturnType<typeof fakeGoogleApi>, s: Shop, status: "under_review" | "rejected", reviewStatus: string) => {
    api.classes.set(classIdOf(s), { ...api.classes.get(classIdOf(s)), reviewStatus });
    await db.update(walletGoogleClasses).set({ status }).where(eq(walletGoogleClasses.programId, s.programId));
  };

  it("keeps passes already out updated while the class is under review or rejected, and issues none (review R-1)", async () => {
    const s = await shop();
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      const { card, config, pass } = await cardWithGooglePass(s, api);
      const client = clientFor(api.fetcher);
      await refreshWalletForMembership(card.id, { google: client });
      for (const [status, review] of [["under_review", "underReview"], ["rejected", "rejected"]] as const) {
        await setClass(api, s, status, review);
        const before = JSON.stringify(api.objects.get(pass.providerObjectId)?.loyaltyPoints);
        await stamp(s, card.id);
        expect(await refreshWalletForMembership(card.id, { google: client })).toEqual({ status: "complete" });
        expect(JSON.stringify(api.objects.get(pass.providerObjectId)?.loyaltyPoints)).not.toBe(before);
        expect(api.classes.get(classIdOf(s))?.reviewStatus).toBe(review);
      }
      // The issue path keeps the check.
      await expect(client.upsert(await walletPassDataByMembershipId(card.id), pass.id, config)).rejects.toThrow("class eligibility");
    });
  });

  it("pushes Apple on a card with both passes while Google fails, Google first, and the job still retries (review R-1)", async () => {
    const s = await shop();
    const apple = appleFixture();
    try {
      await withGoogle(async () => {
        const api = fakeGoogleApi();
        const { card, pass } = await cardWithGooglePass(s, api);
        await issueWalletPass(card.cardToken, "apple", id => id);
        expect((await db.select().from(walletPasses).where(eq(walletPasses.membershipId, card.id))).map(row => row.provider)).toEqual(["google", "apple"]);
        let pushes = 0;
        const applePush = async () => { pushes++; return []; };
        await expect(refreshWalletForMembership(card.id, { applePush, google: clientFor(fakeGoogleApi({ failWith: 503 }).fetcher) })).rejects.toThrow("class lookup");
        expect(pushes).toBe(1);
        expect(await refreshWalletForMembership(card.id, { applePush, google: clientFor(api.fetcher) })).toEqual({ status: "complete" });
        expect(api.objects.get(pass.providerObjectId)).toMatchObject({ state: "ACTIVE" });
      }, "published", apple.env);
    } finally { apple.cleanup(); }
  });

  it("a refresh never creates a class: an approved class gone at Google stops with no POST (review B8)", async () => {
    const s = await shop();
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      const { card } = await cardWithGooglePass(s, api);
      api.classes.delete(classIdOf(s));
      const before = api.calls.length;
      await expect(refreshWalletForMembership(card.id, { google: clientFor(api.fetcher) })).rejects.toThrow("approved class missing");
      expect(classCalls(api, before).map(call => call.method)).toEqual(["GET"]);
    });
  });

  it("a row beats an env binding of its exact scope and fails closed; another programme gets no row (review B3, B17)", async () => {
    const s = await shop();
    const binding = { tenantId: s.tenantId, locationId: s.locationId, programId: s.programId, classId: `${ISSUER}.legacy_class`, issuanceEnabled: true, testAccountsApproved: false };
    await db.insert(walletGoogleClasses).values({ tenantId: s.tenantId, locationId: s.locationId, programId: s.programId, classId: classIdOf(s), status: "under_review" });
    await withGoogle(async () => {
      const env = await googleDirectEnv(s.tenantId, s.locationId, s.programId);
      expect(JSON.parse(env.GOOGLE_WALLET_LOCATION_CLASSES!)).toEqual([expect.objectContaining({ classId: classIdOf(s), issuanceEnabled: false })]);
      expect((await scoped(s)).ready).toBe(false);
      expect(await googleDirectEnv(s.tenantId, s.locationId, randomUUID())).toBe(process.env);
    }, "published", { GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([binding]) });
  });

  it("overwrites a class only the env binds, which has no row (review B16)", async () => {
    const s = await shop();
    const classId = `${ISSUER}.legacy_class`;
    const binding = { tenantId: s.tenantId, locationId: s.locationId, programId: s.programId, classId, issuanceEnabled: true, testAccountsApproved: false };
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      api.classes.set(classId, { id: classId, issuerName: "Pizzeria Tappi", programName: "Karte", reviewStatus: "approved" });
      await expect(overwriteGoogleClasses(s.tenantId, process.env, api.fetcher)).rejects.toMatchObject({ code: "EXTERNAL_PENDING" });
      expect(api.classes.get(classId)).toMatchObject({ issuerName: "Programm beendet" });
      api.classes.set(classId, { ...api.classes.get(classId), reviewStatus: "approved" });
      expect(await overwriteGoogleClasses(s.tenantId, process.env, api.fetcher)).toBe(1);
    }, "published", { GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([binding]) });
  });

  it("shows a rejected overwrite as rejected, sends nothing again, and finishes once Google approves (review N-1)", async () => {
    const s = await shop();
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      await syncGoogleClasses(process.env, api.fetcher);
      await expect(overwriteGoogleClasses(s.tenantId, process.env, api.fetcher)).rejects.toMatchObject({ code: "EXTERNAL_PENDING" });
      api.classes.set(classIdOf(s), { ...api.classes.get(classIdOf(s)), reviewStatus: "rejected" });
      const before = api.calls.length;
      await expect(overwriteGoogleClasses(s.tenantId, process.env, api.fetcher)).rejects.toThrow("rejected");
      expect(await rowOf(s)).toMatchObject({ status: "rejected", lastError: null });
      expect(classCalls(api, before).map(call => call.method)).toEqual(["GET"]);
      approve(api, s);
      expect(await overwriteGoogleClasses(s.tenantId, process.env, api.fetcher)).toBe(1);
    });
  });

  it("the sweep stops at its budget and on shutdown, and takes the least recently touched class first (review N-3)", async () => {
    const [a, b] = [await shop("Shop A"), await shop("Shop B")];
    await withGoogle(async () => {
      const api = fakeGoogleApi();
      expect(await syncGoogleClasses(process.env, api.fetcher, { budgetMs: 0 })).toEqual({ synced: 0, failed: 0 });
      expect(await syncGoogleClasses(process.env, api.fetcher, { signal: AbortSignal.abort() })).toEqual({ synced: 0, failed: 0 });
      expect(api.calls).toEqual([]);

      await syncGoogleClasses(process.env, api.fetcher);
      for (const [older, newer] of [[b, a], [a, b]]) {
        // The older row is written last, so storage order alone would put the newer one first.
        await db.update(walletGoogleClasses).set({ updatedAt: new Date() }).where(eq(walletGoogleClasses.programId, newer.programId));
        await db.update(walletGoogleClasses).set({ updatedAt: new Date(Date.now() - 60_000) }).where(eq(walletGoogleClasses.programId, older.programId));
        const stop = new AbortController();
        const before = api.calls.length;
        const stopping: typeof fetch = async (input, init) => { stop.abort(); return api.fetcher(input, init); };
        expect(await syncGoogleClasses(process.env, stopping, { signal: stop.signal })).toEqual({ synced: 1, failed: 0 });
        expect(classCalls(api, before).map(call => decodeURIComponent(call.url))).toEqual([expect.stringContaining(classIdOf(older))]);
      }
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
