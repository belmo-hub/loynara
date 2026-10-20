import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { staffRoles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createMerchant, enroll } from "@/lib/product";
import { POST as googleIssue } from "@/app/api/wallet/google/route";
import { POST as cashierAward } from "@/app/api/cashier/award/route";
import { GET as card } from "@/app/api/card/[token]/route";
import { fakeGoogleApi, googleFixture, withEnv } from "./test-support";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/looplocal_test") throw new Error("Owned synthetic database required");
const origin = "http://localhost:3000";
beforeEach(async () => { await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE'); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => { await pool.end(); });
function request(path: string, body?: object, cookie = "") {
  return new Request(origin + path, { method: body ? "POST" : "GET", headers: { origin, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function identity() {
  const email = randomUUID() + "@example.test", password = "Synthetic-Wallet-Outage-098-Only!";
  const account = await auth.api.signUpEmail({ body: { name: "Synthetic outage", email, password } });
  const signed = await auth.handler(request("/api/auth/sign-in/email", { email, password }));
  expect(signed.status).toBe(200);
  const cookie = signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  expect(cookie).not.toBe("");
  return { id: account.user.id, cookie };
}
async function merchant() {
  const owner = await identity();
  const setup = await createMerchant({ userId: owner.id, businessName: "Synthetic outage café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic card", programType: "stamp", rulesText: "One synthetic stamp", rewardTitle: "Synthetic reward", rewardCost: 3 });
  return { setup, member: await enroll({ slug: setup.programSlug, acceptedTerms: true }) };
}

it("keeps cashier earning authoritative across Google permission rejection and explicit same-identity recovery", async () => {
  const google = googleFixture("demo");
  try {
    await withEnv({ ...google.env, PUBLIC_BASE_URL: origin, PUBLIC_REGISTRATION_ENABLED: "true", GOOGLE_WALLET_PROVIDER: "GOOGLE_DIRECT", PASSFAST_ENABLED: "false" }, async () => {
      const own = await merchant(), foreign = await merchant(), cashier = await identity();
      await db.insert(staffRoles).values({ tenantId: own.setup.tenantId, locationId: own.setup.locationId, userId: cashier.id, role: "cashier" });
      const issuer = "3388000000023201754";
      await withEnv({ GOOGLE_WALLET_ISSUER_ID: issuer, GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([{ tenantId: own.setup.tenantId, locationId: own.setup.locationId, programId: own.setup.programId, classId: `${issuer}.program_${own.setup.programId}`, issuanceEnabled: true, testAccountsApproved: true }]) }, async () => {
        const api = fakeGoogleApi(); let rejected = true, denied = 0;
        const transport: typeof fetch = async (input, init) => {
          if (rejected && String(input).startsWith("https://walletobjects.googleapis.com/")) { denied++; return Response.json({ privateDiagnostic: "synthetic-provider-private-098" }, { status: 403 }); }
          return api.fetcher(input, init);
        };
        vi.stubGlobal("fetch", transport);
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const fail = await googleIssue(request("/api/wallet/google", { token: own.member.cardToken }));
        expect(fail.status).toBe(502); expect(denied).toBe(1);
        expect(await fail.json()).toEqual({ code: "WALLET_PROVIDER_ERROR", error: "Wallet ist gerade nicht erreichbar. Bitte versuche es später erneut." });
        expect(fail.headers.get("cache-control")).toBe("no-store");
        const prior = (await pool.query("SELECT id, provider_object_id, status, synced_at FROM wallet_passes WHERE membership_id=$1", [own.member.id])).rows;
        expect(prior).toHaveLength(1); expect(prior[0]).toMatchObject({ status: "pending", synced_at: null });
        expect(api.objects.size).toBe(0);
        const input = { membershipId: own.member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() };
        expect((await cashierAward(request("/api/cashier/award", input))).status).toBe(401);
        for (let replay = 0; replay < 2; replay++) expect((await cashierAward(request("/api/cashier/award", input, cashier.cookie))).status).toBe(200);
        expect((await pool.query("SELECT delta FROM ledger_entries WHERE membership_id=$1", [own.member.id])).rows).toEqual([{ delta: 1 }]);
        const active = await card(request("/api/card/synthetic"), { params: Promise.resolve({ token: own.member.cardToken }) });
        expect(active.status).toBe(200); expect(await active.json()).toMatchObject({ balance: 1 });
        expect((await pool.query("SELECT status, attempts FROM outbox_jobs WHERE kind='wallet.refresh' AND tenant_id=$1", [own.setup.tenantId])).rows).toEqual([{ status: "pending", attempts: 0 }]);
        expect((await googleIssue(request("/api/wallet/google", { token: foreign.member.cardToken }))).status).toBe(503);
        rejected = false;
        const retry = await googleIssue(request("/api/wallet/google", { token: own.member.cardToken }));
        expect(retry.status).toBe(200); expect((await retry.json()).url).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);
        expect((await pool.query("SELECT id,provider_object_id,status FROM wallet_passes WHERE membership_id=$1", [own.member.id])).rows).toEqual([{ id: prior[0].id, provider_object_id: prior[0].provider_object_id, status: "created" }]);
        expect(api.objects.size).toBe(1); expect(api.objects.get(prior[0].provider_object_id)?.loyaltyPoints).toMatchObject({ balance: { string: "1 / 3" } });
        expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [foreign.member.id])).rows).toEqual([{ balance: 0 }]);
        expect((await pool.query("SELECT id FROM wallet_passes WHERE membership_id=$1", [foreign.member.id])).rows).toEqual([]);
        expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-provider-private-098");
        expect(JSON.stringify(log.mock.calls)).not.toContain(own.member.cardToken);
        expect(log.mock.calls).toEqual([["Wallet issuance failed"]]);
      });
    });
  } finally { google.cleanup(); }
});
