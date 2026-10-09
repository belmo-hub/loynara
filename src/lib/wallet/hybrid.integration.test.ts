import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { POST as googleIssue } from "@/app/api/wallet/google/route";
import { closeCard } from "@/lib/card-lifecycle";
import { award, reverseEntry } from "@/lib/loyalty";
import { createMerchant, enroll } from "@/lib/product";
import { googleDirectConfig } from "./google-direct";
import { GoogleWalletClient } from "./google";
import { refreshWalletForMembership } from "./refresh";
import { claimOutboxJob, markOutboxJob } from "@/lib/outbox";
import { fakeGoogleApi, googleFixture, withEnv } from "./test-support";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");
const issuer = "3388000000023201754", origin = "https://demo.example.test";
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices, rate_limits CASCADE'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
afterAll(async () => { await pool.end(); });
async function memberFixture() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [owner, "Hybrid fixture", `${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Loynara Synthetic", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Synthetic only", rewardTitle: "Testprämie", rewardCost: 3 });
  return { owner, merchant, member: await enroll({ slug: merchant.programSlug, acceptedTerms: true }) };
}
function scope(merchant: Awaited<ReturnType<typeof memberFixture>>["merchant"]) {
  return { tenantId: merchant.tenantId, locationId: merchant.locationId, programId: merchant.programId, classId: `${issuer}.program_${merchant.programId}`, issuanceEnabled: true, testAccountsApproved: true };
}
const request = (token: string) => new Request(`${origin}/api/wallet/google`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token }) });
function envFor(google: ReturnType<typeof googleFixture>, merchant: Awaited<ReturnType<typeof memberFixture>>["merchant"]) {
  return { ...google.env, PUBLIC_BASE_URL: origin, GOOGLE_WALLET_PROVIDER: "GOOGLE_DIRECT", GOOGLE_WALLET_ISSUER_ID: issuer, GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([scope(merchant)]),
    PASSFAST_ENABLED: "true", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: "11111111-1111-4111-8111-111111111111", PASSFAST_WALLET_TYPES: "apple", PASSFAST_TENANT_TEMPLATES: JSON.stringify([{ tenantId: merchant.tenantId, locationId: merchant.locationId, templateId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }]) };
}

describe("Google Direct issuance and ledger projection beside PassFast Apple", () => {
  it("cancels a stalled upload within the same deadline before database or provider work", async () => {
    const google = googleFixture("demo"), { merchant } = await memberFixture();
    try {
      await withEnv(envFor(google, merchant), async () => {
        const api = fakeGoogleApi(); vi.stubGlobal("fetch", api.fetcher);
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
        const upload = new Request(`${origin}/api/wallet/google`, { method: "POST", headers: { origin, "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
        vi.useFakeTimers();
        const response = googleIssue(upload);
        await vi.advanceTimersByTimeAsync(65_000);
        expect((await response).status).toBe(502);
        expect(cancelled).toBe(true); expect(api.calls).toHaveLength(0);
      });
    } finally { google.cleanup(); }
  });
  it("keeps existing pass withdrawal authorized when new issuance is paused", async () => {
    const google = googleFixture("demo"), { merchant, member } = await memberFixture();
    try {
      await withEnv(envFor(google, merchant), async () => {
        const api = fakeGoogleApi(); vi.stubGlobal("fetch", api.fetcher);
        expect((await googleIssue(request(member.cardToken))).status).toBe(200);
        const objectId = [...api.objects.keys()][0];
        const client = new GoogleWalletClient(googleDirectConfig(process.env, merchant.tenantId, merchant.locationId, merchant.programId), api.fetcher);
        await withEnv({ GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([{ ...scope(merchant), issuanceEnabled: false }]) }, async () => {
          expect((await googleIssue(request(member.cardToken))).status).toBe(503);
          await closeCard(member.cardToken);
          expect(await refreshWalletForMembership(member.id, { google: client })).toEqual({ status: "complete" });
          expect(api.objects.get(objectId)).toMatchObject({ state: "INACTIVE", barcode: null });
        });
      });
    } finally { google.cleanup(); }
  });
  it("recovers an uncertain create through a durable retry with the same object after a fresh worker starts", async () => {
    const google = googleFixture("demo"), { owner, merchant, member } = await memberFixture();
    try {
      await withEnv(envFor(google, merchant), async () => {
        const api = fakeGoogleApi(); let lost = false;
        vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
          const response = await api.fetcher(input, init);
          if (!lost && init?.method === "POST" && String(input).endsWith("/loyaltyObject")) { lost = true; throw new DOMException("Synthetic lost response", "TimeoutError"); }
          return response;
        });
        expect((await googleIssue(request(member.cardToken))).status).toBe(502);
        expect(api.objects.size).toBe(1);
        const job = (await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 }))!;
        expect(job.kind).toBe("wallet.refresh");
        await award({ userId: owner, locationId: merchant.locationId, membershipId: member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
        await markOutboxJob(pool, job, "retry", "Synthetic timeout", 1);
        await pool.query("UPDATE outbox_jobs SET next_attempt_at=now() WHERE id=$1", [job.id]);
        const recovered = (await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 }))!;
        const freshClient = new GoogleWalletClient(googleDirectConfig(process.env, merchant.tenantId, merchant.locationId, merchant.programId), api.fetcher);
        expect(await refreshWalletForMembership(member.id, { google: freshClient, expectedTenantId: recovered.tenantId })).toEqual({ status: "complete" });
        expect(await markOutboxJob(pool, recovered, "complete")).toBe(true);
        expect(api.objects.size).toBe(1);
        expect([...api.objects.values()][0].loyaltyPoints).toMatchObject({ balance: { string: "1 / 3" } });
        expect(api.calls.filter(call => call.method === "POST" && call.url.endsWith("/loyaltyObject"))).toHaveLength(1);
      });
    } finally { google.cleanup(); }
  });
  it("bounds a blocked customer projection lock before any provider attempt", async () => {
    const google = googleFixture("demo"), { merchant, member } = await memberFixture();
    try {
      await withEnv(envFor(google, merchant), async () => {
        const api = fakeGoogleApi(); vi.stubGlobal("fetch", api.fetcher);
        expect((await googleIssue(request(member.cardToken))).status).toBe(200);
        const lock = await pool.connect();
        await lock.query("BEGIN"); await lock.query("SELECT id FROM wallet_passes WHERE membership_id=$1 FOR UPDATE", [member.id]);
        const before = api.calls.length;
        try {
          const result = await googleIssue(request(member.cardToken));
          expect(result.status).toBe(502); expect(api.calls).toHaveLength(before);
        } finally { await lock.query("ROLLBACK"); lock.release(); }
      });
    } finally { google.cleanup(); }
  }, 9000);
  it("issues only through Google and reuses one projection on repeated customer requests", async () => {
    const google = googleFixture("demo"), { merchant, member } = await memberFixture();
    try {
      await withEnv(envFor(google, merchant), async () => {
        const api = fakeGoogleApi(); vi.stubGlobal("fetch", api.fetcher);
        const issued = await googleIssue(request(member.cardToken));
        expect(issued.status).toBe(200);
        const { url } = await issued.json();
        const jwt = JSON.parse(Buffer.from(url.split("/").pop().split(".")[1], "base64url").toString());
        expect(jwt.payload.loyaltyObjects[0].classId).toBe(`${issuer}.program_${merchant.programId}`);
        expect(JSON.stringify(jwt)).not.toContain(member.cardToken);
        expect(JSON.stringify(jwt)).not.toContain(member.scanCode);
        expect((await googleIssue(request(member.cardToken))).status).toBe(200);
        expect(api.objects.size).toBe(1);
        expect(api.calls.some(call => call.url.includes("passfa.st"))).toBe(false);
        expect((await pool.query("SELECT provider,provider_object_id FROM wallet_passes WHERE membership_id=$1", [member.id])).rows).toEqual([expect.objectContaining({ provider: "google", provider_object_id: expect.stringMatching(/^3388000000023201754\.loynara_/) })]);
      });
    } finally { google.cleanup(); }
  });

  it("projects +1 and same-key replay once, then correction and closure, without changing another card", async () => {
    const google = googleFixture("demo"), { owner, merchant, member } = await memberFixture();
    const unrelated = await memberFixture();
    try {
      await withEnv(envFor(google, merchant), async () => {
        const api = fakeGoogleApi(); vi.stubGlobal("fetch", api.fetcher);
        expect((await googleIssue(request(unrelated.member.cardToken))).status).toBe(503);
        expect((await googleIssue(request(member.cardToken))).status).toBe(200);
        const objectId = [...api.objects.keys()][0];
        const client = new GoogleWalletClient(googleDirectConfig(process.env, merchant.tenantId, merchant.locationId, merchant.programId), api.fetcher);
        const booking = { userId: owner, locationId: merchant.locationId, membershipId: member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() };
        const first = await award(booking); await award(booking);
        expect(await refreshWalletForMembership(member.id, { google: client, expectedTenantId: merchant.tenantId })).toEqual({ status: "complete" });
        expect(api.objects.get(objectId)?.loyaltyPoints).toMatchObject({ balance: { string: "1 / 3" } });
        await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: first.entryId, reason: "Synthetic correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
        await refreshWalletForMembership(member.id, { google: client });
        expect(api.objects.get(objectId)?.loyaltyPoints).toMatchObject({ balance: { string: "0 / 3" } });
        await closeCard(member.cardToken);
        await refreshWalletForMembership(member.id, { google: client });
        expect(api.objects.get(objectId)).toMatchObject({ state: "INACTIVE", barcode: null, loyaltyPoints: null, accountId: "" });
        expect(api.objects.size).toBe(1);
        expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [unrelated.member.id])).rows[0].balance).toBe(0);
        expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1 AND kind='award'", [member.id])).rows[0].n).toBe(1);
      });
    } finally { google.cleanup(); }
  });

  it("refuses a remapped class before changing an existing pass or contacting Google", async () => {
    const google = googleFixture("demo"), { merchant, member } = await memberFixture();
    try {
      await withEnv(envFor(google, merchant), async () => {
        const api = fakeGoogleApi(); vi.stubGlobal("fetch", api.fetcher);
        expect((await googleIssue(request(member.cardToken))).status).toBe(200);
        const before = (await pool.query("SELECT * FROM wallet_passes WHERE membership_id=$1", [member.id])).rows;
        await withEnv({ GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([{ ...scope(merchant), classId: `${issuer}.changed` }]) }, async () => {
          const calls = api.calls.length;
          expect((await googleIssue(request(member.cardToken))).status).not.toBe(200);
          expect(api.calls).toHaveLength(calls);
          expect((await pool.query("SELECT * FROM wallet_passes WHERE membership_id=$1", [member.id])).rows).toEqual(before);
        });
      });
    } finally { google.cleanup(); }
  });
});
