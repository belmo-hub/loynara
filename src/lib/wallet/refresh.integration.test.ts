import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { outboxJobs, walletPasses } from "@/db/schema";
import { closeCard } from "@/lib/card-lifecycle";
import { reissueCardByStaff } from "@/lib/card-reissue";
import { award, redeem, reverseEntry } from "@/lib/loyalty";
import { updateMerchantBrand } from "@/lib/merchant-brand";
import { createMerchant, editReward, enroll, getMerchantRewards, lookupCard } from "@/lib/product";
import { configureReferrals, getCardReferralShare } from "@/lib/referrals";
import { applePassToken } from "./apple";
import { registerAppleDevice } from "./apple-service";
import { walletPassDataByMembershipId } from "./data";
import { googleObjectId, GoogleWalletClient } from "./google";
import { issueWalletPass } from "./issue";
import { refreshWalletForMembership, supersedeOlderWalletRefreshes } from "./refresh";
import { approveSyntheticGoogleScope, appleFixture, fakeGoogleApi, googleFixture, withEnv } from "./test-support";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices CASCADE'); });
afterAll(async () => { await pool.query("TRUNCATE TABLE apple_devices CASCADE"); await pool.end(); });

const key = () => randomUUID();
async function createMember() {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Wallet fixture", `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName: "Wallet Fixture Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 3 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  return { owner: userId, merchant, member, issuer: process.env.GOOGLE_WALLET_PROVIDER === "GOOGLE_DIRECT" && process.env.GOOGLE_WALLET_ENABLED === "true" ? approveSyntheticGoogleScope(merchant) : undefined };
}
const stamp = (owner: string, locationId: string, membershipId: string, quantity = 1) => award({ userId: owner, locationId, membershipId, quantity, idempotencyKey: key(), requestId: randomUUID() });
const pendingRefreshes = (membershipId?: string) => db.select().from(outboxJobs).where(and(eq(outboxJobs.kind, "wallet.refresh"), eq(outboxJobs.status, "pending")))
  .then(rows => rows.filter(row => !membershipId || row.payload.membershipId === membershipId));

/** Runs fn with Google configured against an in-process fake API. */
async function withGoogle<T>(fn: (api: ReturnType<typeof fakeGoogleApi>, client: GoogleWalletClient) => Promise<T>, options: { failWith?: number; wrap?: (fetcher: typeof fetch) => typeof fetch } = {}) {
  const google = googleFixture("demo");
  try {
    return await withEnv({ ...google.env, PUBLIC_BASE_URL: "http://localhost:3000" }, async () => {
      const api = fakeGoogleApi(options);
      return fn(api, new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: google.privateKey }, options.wrap?.(api.fetcher) ?? api.fetcher));
    });
  } finally { google.cleanup(); }
}

describe("wallet refresh queue", () => {
  it("queues nothing for cards without a saved pass, and completes trivially", async () => {
    const { owner, merchant, member } = await createMember();
    await stamp(owner, merchant.locationId, member.id);
    expect(await pendingRefreshes()).toHaveLength(0);
    expect(await refreshWalletForMembership(member.id)).toEqual({ status: "complete" });
  });

  it("coalesces: many loyalty changes before the worker runs cause ONE provider refresh", async () => {
    const google = googleFixture("demo");
    try { await withEnv(google.env, async () => {
    const { owner, merchant, member, issuer } = await createMember();
    await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
    for (let i = 0; i < 5; i++) await stamp(owner, merchant.locationId, member.id);
    expect(await pendingRefreshes(member.id)).toHaveLength(1);
    // Once the job is claimed, the next change queues a fresh one (the running job may already have read older state).
    await pool.query("UPDATE outbox_jobs SET status = 'processing' WHERE kind = 'wallet.refresh'");
    await stamp(owner, merchant.locationId, member.id);
    expect(await pendingRefreshes(member.id)).toHaveLength(1);
    }); } finally { google.cleanup(); }
  });

  it("blocks an issued pass while its provider is disabled, without touching the committed balance", async () => {
    const google = googleFixture("demo");
    try { await withEnv(google.env, async () => {
    const { owner, merchant, member, issuer } = await createMember();
    await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
    await stamp(owner, merchant.locationId, member.id, 2);
    const result = await withEnv({ GOOGLE_WALLET_ENABLED: "false" }, () => refreshWalletForMembership(member.id));
    expect(result).toMatchObject({ status: "blocked" });
    expect((await walletPassDataByMembershipId(member.id)).balance).toBe(2);
    }); } finally { google.cleanup(); }
  });

  it("reads merchant relevance coordinates without collecting customer location", async () => {
    const { merchant, member } = await createMember();
    await pool.query("UPDATE locations SET latitude = 51.3127, longitude = 9.4797 WHERE id = $1", [merchant.locationId]);
    const pass = await walletPassDataByMembershipId(member.id);
    expect(pass).toMatchObject({ latitude: 51.3127, longitude: 9.4797, cardLocator: expect.stringMatching(/^K-[A-Z2-9]{6}$/), reward: { title: "Kaffee", cost: 3 } });
    expect(JSON.stringify(pass)).not.toContain("customerLocation");
  });
});

describe("Google Wallet follows every loyalty change (fake provider)", () => {
  it("a worker job belonging to another tenant cannot refresh this membership", async () => {
    await withGoogle(async (api, client) => {
      const first = await createMember();
      const other = await createMember();
      const pass = await issueWalletPass(first.member.cardToken, "google", id => googleObjectId(id, first.issuer!));
      expect(await refreshWalletForMembership(first.member.id, { google: client, expectedTenantId: other.merchant.tenantId })).toEqual({ status: "complete" });
      expect(api.objects.size).toBe(0);
      expect(api.calls).toHaveLength(0);
      expect((await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id)))[0]).toMatchObject({ status: "pending", syncedAt: null });
    });
  });

  it("award, redemption, correction and referral bonus are reflected from Loynara state", async () => {
    await withGoogle(async (api, client) => {
      const { owner, merchant, member, issuer } = await createMember();
      const pass = await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
      const objectId = googleObjectId(pass.id, issuer!);
      const shown = () => api.objects.get(objectId) as { loyaltyPoints: { balance: { string: string } }; textModulesData: Array<{ header: string }>; state: string };

      await refreshWalletForMembership(member.id, { google: client });
      expect(shown().loyaltyPoints.balance.string).toBe("0 / 3");
      const first = await stamp(owner, merchant.locationId, member.id, 3);
      await refreshWalletForMembership(member.id, { google: client });
      expect(shown().loyaltyPoints.balance.string).toBe("3 / 3");
      expect(shown().textModulesData[0].header).toBe("Prämie bereit");

      const open = await lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: member.scanCode });
      await redeem({ userId: owner, locationId: merchant.locationId, membershipId: member.id, rewardVersionId: open.rewards[0].id, idempotencyKey: key(), requestId: randomUUID() });
      await refreshWalletForMembership(member.id, { google: client });
      expect(shown().loyaltyPoints.balance.string).toBe("0 / 3");
      expect(shown().textModulesData[0].header).toBe("Nächste Prämie");

      await stamp(owner, merchant.locationId, member.id, 2);
      const second = await stamp(owner, merchant.locationId, member.id, 1);
      await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: second.entryId, reason: "Doppelt gebucht, korrigiert", idempotencyKey: key(), requestId: randomUUID() });
      await refreshWalletForMembership(member.id, { google: client });
      expect(shown().loyaltyPoints.balance.string).toBe("2 / 3");
      expect(first.duplicate).toBe(false);

      // Referral bonus: the referrer's saved pass is refreshed when the referred friend's first checkout qualifies.
      await pool.query("UPDATE outbox_jobs SET status = 'complete' WHERE kind = 'wallet.refresh'");
      await configureReferrals({ actorUserId: owner, programSlug: merchant.programSlug, enabled: true, referrerBonus: 1, referredBonus: 1 });
      const code = new URL((await getCardReferralShare(member.cardToken)).shareUrl).searchParams.get("ref")!;
      const friend = await enroll({ slug: merchant.programSlug, acceptedTerms: true, referralCode: code });
      await stamp(owner, merchant.locationId, friend.id);
      expect(await pendingRefreshes(member.id)).toHaveLength(1);
      await refreshWalletForMembership(member.id, { google: client });
      expect(shown().loyaltyPoints.balance.string).toBe("3 / 3");
      expect(shown().state).toBe("ACTIVE");
      // Every displayed number came from Loynara; Google was never asked for a balance.
      expect(api.calls.filter(call => call.method === "GET" && call.url.includes("loyaltyObject/")).every(call => call.body === undefined)).toBe(true);
    });
  });

  it("reissue: the old object is deactivated without barcode and NEVER receives the new QR code; a new object carries it", async () => {
    await withGoogle(async (api, client) => {
      const { owner, merchant, member, issuer } = await createMember();
      const oldPass = await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
      await refreshWalletForMembership(member.id, { google: client });
      const oldObject = googleObjectId(oldPass.id, issuer!);
      const { cardToken } = await reissueCardByStaff({ actorUserId: owner, locationId: merchant.locationId, membershipId: member.id, reason: "Neues Handy, Kartennummer genannt", verificationMethod: "card_link", entitlementConfirmed: true, idempotencyKey: key() });
      const [{ scanCode: fresh }] = await pool.query<{ scanCode: string }>("SELECT scan_code AS \"scanCode\" FROM memberships WHERE id = $1", [member.id]).then(result => result.rows);
      expect(await refreshWalletForMembership(member.id, { google: client })).toEqual({ status: "complete" });
      expect(api.objects.get(oldObject)).toMatchObject({ state: "INACTIVE" });
      expect(api.objects.get(oldObject)?.barcode).toBeNull();
      const toOldObject = api.calls.filter(call => call.url.includes(encodeURIComponent(oldObject)) && call.body);
      expect(JSON.stringify(toOldObject)).not.toContain(fresh);
      expect((await db.select().from(walletPasses).where(eq(walletPasses.id, oldPass.id)))[0]).toMatchObject({ status: "revoked", revokeReason: "reissued" });
      // A later award does not resurrect the old object.
      await stamp(owner, merchant.locationId, member.id);
      await refreshWalletForMembership(member.id, { google: client });
      expect(api.objects.get(oldObject)).toMatchObject({ state: "INACTIVE" });
      // The new link issues a new object with the new QR code.
      const newPass = await issueWalletPass(cardToken, "google", id => googleObjectId(id, issuer!));
      expect(newPass.id).not.toBe(oldPass.id);
      await refreshWalletForMembership(member.id, { google: client });
      expect(api.objects.get(googleObjectId(newPass.id, issuer!))).toMatchObject({ state: "ACTIVE", barcode: { value: fresh }, loyaltyPoints: { balance: { string: "1 / 3" } } });
    });
  });

  it("closure: the object is deactivated; history rows stay", async () => {
    await withGoogle(async (api, client) => {
      const { member, issuer } = await createMember();
      const pass = await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
      await refreshWalletForMembership(member.id, { google: client });
      await closeCard(member.cardToken);
      expect(await pendingRefreshes(member.id)).toHaveLength(1);
      expect(await refreshWalletForMembership(member.id, { google: client })).toEqual({ status: "complete" });
      expect(api.objects.get(googleObjectId(pass.id, issuer!))).toMatchObject({ state: "INACTIVE", textModulesData: [{ header: "Karte ungültig" }] });
      expect(await db.select().from(walletPasses).where(eq(walletPasses.membershipId, member.id))).toMatchObject([{ status: "revoked", revokeReason: "closed" }]);
    });
  });

  it("programme and branding changes reach every saved pass of the programme", async () => {
    await withGoogle(async (api, client) => {
      const { owner, merchant, member, issuer } = await createMember();
      const other = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
      const pass = await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
      await refreshWalletForMembership(member.id, { google: client });
      const [reward] = await getMerchantRewards({ actorUserId: owner, programSlug: merchant.programSlug });
      await editReward({ actorUserId: owner, programSlug: merchant.programSlug, rewardId: reward.rewardId, title: "Kuchen", cost: 4, termsText: "" });
      expect(await pendingRefreshes(member.id)).toHaveLength(1);
      expect(await pendingRefreshes(other.id)).toHaveLength(0); // no saved pass, nothing to update
      await refreshWalletForMembership(member.id, { google: client });
      expect(api.objects.get(googleObjectId(pass.id, issuer!))).toMatchObject({ loyaltyPoints: { balance: { string: "0 / 4" } }, textModulesData: [{ body: "Kuchen · Noch 4 Stempel" }, { id: "note" }] });
      await pool.query("UPDATE outbox_jobs SET status = 'complete'");
      await updateMerchantBrand({ actorUserId: owner, programSlug: merchant.programSlug, businessName: "Neuer Name", locationName: "Mitte", brandColor: "#7a2e1f" });
      expect(await pendingRefreshes(member.id)).toHaveLength(1);
      await refreshWalletForMembership(member.id, { google: client });
      expect(api.classes.get(`${issuer!.issuerId}.program_${merchant.programId}`)).toMatchObject({ issuerName: "Neuer Name", hexBackgroundColor: "#7a2e1f" });
    });
  });

  it("a provider outage never undoes loyalty: the award stands and the refresh fails for the worker to retry", async () => {
    await withGoogle(async (_api, client) => {
      const { owner, merchant, member, issuer } = await createMember();
      await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
      const result = await stamp(owner, merchant.locationId, member.id, 2);
      expect(result.balance).toBe(2);
      await expect(refreshWalletForMembership(member.id, { google: client })).rejects.toMatchObject({ name: "GoogleWalletError", status: 503 });
      expect((await walletPassDataByMembershipId(member.id)).balance).toBe(2);
      expect(await db.select().from(walletPasses).where(eq(walletPasses.membershipId, member.id))).toMatchObject([{ status: "pending", revokedAt: null }]);
    }, { failWith: 503 });
  });
});

describe("Google 'Prämie bereit' message (fake provider)", () => {
  beforeEach(() => { vi.stubEnv("GOOGLE_WALLET_SERVICE_MESSAGES_ENABLED", "true"); });
  afterEach(() => { vi.unstubAllEnvs(); });
  const addMessageCalls = (api: ReturnType<typeof fakeGoogleApi>) => api.calls.filter(call => call.url.endsWith("/addMessage"));
  const messagesOf = (api: ReturnType<typeof fakeGoogleApi>, objectId: string) => (api.objects.get(objectId)?.messages ?? []) as Array<Record<string, unknown>>;
  const redeemFirst = async (owner: string, locationId: string, member: { id: string; scanCode: string }) => {
    const open = await lookupCard({ userId: owner, locationId, scanCode: member.scanCode });
    await redeem({ userId: owner, locationId, membershipId: member.id, rewardVersionId: open.rewards[0].id, idempotencyKey: key(), requestId: randomUUID() });
  };

  it("crossing into reward-ready adds one TEXT_AND_NOTIFY message per reward cycle; retries, later stamps and redemptions add none", async () => {
    await withGoogle(async (api, client) => {
      const { owner, merchant, member, issuer } = await createMember();
      const pass = await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
      const objectId = googleObjectId(pass.id, issuer!);
      const refresh = () => refreshWalletForMembership(member.id, { google: client });
      await stamp(owner, merchant.locationId, member.id, 2);
      await refresh();
      expect(addMessageCalls(api)).toHaveLength(0);

      await stamp(owner, merchant.locationId, member.id, 1);
      expect(await refresh()).toEqual({ status: "complete" });
      const [message] = messagesOf(api, objectId);
      expect(messagesOf(api, objectId)).toEqual([{ id: expect.stringMatching(/^reward_[0-9a-f]{64}$/), header: "Prämie bereit", body: "Deine Prämie ist bereit: Kaffee", messageType: "TEXT_AND_NOTIFY" }]);
      expect(JSON.stringify(message)).not.toMatch(/https?:|\/c\/|card_|sc_|K-/);

      await refresh(); // the same job retried
      await stamp(owner, merchant.locationId, member.id, 3); // 6 / 3: still the same cycle
      await refresh();
      await redeemFirst(owner, merchant.locationId, member); // 3 / 3 left: still ready, never on redeem
      await refresh();
      await redeemFirst(owner, merchant.locationId, member); // 0 / 3
      await refresh();
      expect(addMessageCalls(api)).toHaveLength(1);

      await stamp(owner, merchant.locationId, member.id, 3); // a new cycle
      await refresh();
      expect(addMessageCalls(api)).toHaveLength(2);
      const ids = messagesOf(api, objectId).map(item => item.id);
      expect(new Set(ids).size).toBe(2);
    });
  });

  it("with GOOGLE_WALLET_SERVICE_MESSAGES_ENABLED off (the default) the balance still updates but no message is added", async () => {
    vi.stubEnv("GOOGLE_WALLET_SERVICE_MESSAGES_ENABLED", undefined);
    await withGoogle(async (api, client) => {
      const { owner, merchant, member, issuer } = await createMember();
      const pass = await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
      await stamp(owner, merchant.locationId, member.id, 3);
      expect(await refreshWalletForMembership(member.id, { google: client })).toEqual({ status: "complete" });
      expect(api.objects.get(googleObjectId(pass.id, issuer!))).toMatchObject({ loyaltyPoints: { balance: { string: "3 / 3" } } });
      expect(addMessageCalls(api)).toHaveLength(0);
    });
  });

  it("a retried job does not send twice when Google stored the message but the answer was lost", async () => {
    let lose = true;
    await withGoogle(async (api, client) => {
      const { owner, merchant, member, issuer } = await createMember();
      const pass = await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
      await stamp(owner, merchant.locationId, member.id, 3);
      await expect(refreshWalletForMembership(member.id, { google: client })).rejects.toMatchObject({ name: "GoogleWalletError", status: 503 });
      expect(await refreshWalletForMembership(member.id, { google: client })).toEqual({ status: "complete" });
      expect(addMessageCalls(api)).toHaveLength(1);
      expect(messagesOf(api, googleObjectId(pass.id, issuer!))).toHaveLength(1);
    }, { wrap: fetcher => async (input, init) => {
      const response = await fetcher(input, init);
      if (lose && String(input).endsWith("/addMessage")) { lose = false; return new Response(null, { status: 503 }); }
      return response;
    } });
  });

  it.each([[429, ""], [400, '{"error":{"message":"QuotaExceededException"}}']])("Google's notification limit (%s) skips the message and never fails the refresh", async (status, body) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withGoogle(async (api, client) => {
        const { owner, merchant, member, issuer } = await createMember();
        const pass = await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
        await stamp(owner, merchant.locationId, member.id, 3);
        expect(await refreshWalletForMembership(member.id, { google: client })).toEqual({ status: "complete" });
        expect(api.objects.get(googleObjectId(pass.id, issuer!))).toMatchObject({ loyaltyPoints: { balance: { string: "3 / 3" } } });
        expect(api.objects.get(googleObjectId(pass.id, issuer!))?.messages).toBeUndefined();
        expect((await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id)))[0]).toMatchObject({ status: "created", syncedAt: expect.any(Date) });
        expect(warn).toHaveBeenCalledWith("Google Wallet reward message skipped: notification limit reached");
      }, { wrap: fetcher => async (input, init) => String(input).endsWith("/addMessage") ? new Response(body, { status }) : fetcher(input, init) });
    } finally { warn.mockRestore(); }
  });

  it("sends nothing when an owner edit makes the card ready", async () => {
    await withGoogle(async (api, client) => {
      const { owner, merchant, member, issuer } = await createMember();
      await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
      await stamp(owner, merchant.locationId, member.id, 2);
      await refreshWalletForMembership(member.id, { google: client });
      const [reward] = await getMerchantRewards({ actorUserId: owner, programSlug: merchant.programSlug });
      await editReward({ actorUserId: owner, programSlug: merchant.programSlug, rewardId: reward.rewardId, title: "Kaffee", cost: 2, termsText: "" });
      await refreshWalletForMembership(member.id, { google: client });
      expect(addMessageCalls(api)).toHaveLength(0);
    });
  });

  it("sends nothing to a pass added after the card was already ready, including the new pass after a reissue", async () => {
    await withGoogle(async (api, client) => {
      const { owner, merchant, member, issuer } = await createMember();
      await stamp(owner, merchant.locationId, member.id, 3);
      await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, issuer!));
      await refreshWalletForMembership(member.id, { google: client });
      const { cardToken } = await reissueCardByStaff({ actorUserId: owner, locationId: merchant.locationId, membershipId: member.id, reason: "Neues Handy, Kartennummer genannt", verificationMethod: "card_link", entitlementConfirmed: true, idempotencyKey: key() });
      await refreshWalletForMembership(member.id, { google: client });
      await issueWalletPass(cardToken, "google", id => googleObjectId(id, issuer!));
      await refreshWalletForMembership(member.id, { google: client });
      expect(api.objects.size).toBe(2);
      expect(addMessageCalls(api)).toHaveLength(0);
    });
  });
});

describe("Apple Wallet refresh pushes registered devices (injected APNs)", () => {
  it("pushes on change, then voids the old pass on reissue and closes out the revocation", async () => {
    const apple = appleFixture();
    try {
      await withEnv(apple.env, async () => {
        const { owner, merchant, member } = await createMember();
        const pass = await issueWalletPass(member.cardToken, "apple", id => id);
        await registerAppleDevice({ deviceId: "phone", passTypeId: apple.config.passTypeId, serial: pass.id, authorization: `ApplePass ${applePassToken(pass.id, apple.config)}`, pushToken: "a".repeat(64) }, apple.config);
        const pushed: string[][] = [];
        const applePush = async (devices: Array<{ deviceId: string }>) => { pushed.push(devices.map(device => device.deviceId)); return []; };
        const before = (await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id)))[0].updatedAt;
        await stamp(owner, merchant.locationId, member.id);
        expect(await refreshWalletForMembership(member.id, { applePush })).toEqual({ status: "complete" });
        expect(pushed).toEqual([["phone"]]);
        const after = (await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id)))[0];
        expect(after.updatedAt.getTime()).toBeGreaterThan(before.getTime());
        expect(after.syncedAt).toBeInstanceOf(Date);

        await reissueCardByStaff({ actorUserId: owner, locationId: merchant.locationId, membershipId: member.id, reason: "Handy verloren, Kontakt geprüft", verificationMethod: "stored_contact", entitlementConfirmed: true, idempotencyKey: key() });
        await refreshWalletForMembership(member.id, { applePush });
        expect(pushed).toEqual([["phone"], ["phone"]]); // the lost phone is told to fetch its (now voided) pass
        expect((await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id)))[0]).toMatchObject({ status: "revoked", revokeReason: "reissued" });
        // Nothing left to do for the card afterwards.
        await refreshWalletForMembership(member.id, { applePush });
        expect(pushed).toHaveLength(2);
      });
    } finally { apple.cleanup(); }
  });

  it("an Apple pass that was never downloaded is closed out on revocation without any push", async () => {
    const { owner, merchant, member } = await createMember();
    const pass = await issueWalletPass(member.cardToken, "apple", id => id);
    await reissueCardByStaff({ actorUserId: owner, locationId: merchant.locationId, membershipId: member.id, reason: "Handy verloren, Kontakt geprüft", verificationMethod: "stored_contact", entitlementConfirmed: true, idempotencyKey: key() });
    expect((await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id)))[0]).toMatchObject({ status: "revoked", revokeReason: "reissued" });
    expect(await refreshWalletForMembership(member.id)).toEqual({ status: "complete" }); // Apple disabled here: nothing was pending
  });
});

describe("monitoring stays meaningful", () => {
  it("a later successful refresh supersedes older failed or blocked refreshes of the same card only", async () => {
    const { merchant, member } = await createMember();
    const other = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const insert = (membershipId: string, status: string) => db.insert(outboxJobs).values({ tenantId: merchant.tenantId, kind: "wallet.refresh", payload: { membershipId }, status }).returning().then(rows => rows[0]);
    const failed = await insert(member.id, "failed");
    const blocked = await insert(member.id, "blocked");
    const otherFailed = await insert(other.id, "failed");
    const later = await insert(member.id, "complete");
    await supersedeOlderWalletRefreshes(pool, later);
    const status = async (id: string) => (await db.select().from(outboxJobs).where(eq(outboxJobs.id, id)))[0].status;
    expect(await status(failed.id)).toBe("suppressed");
    expect(await status(blocked.id)).toBe("suppressed");
    expect(await status(otherFailed.id)).toBe("failed");
  });
});
