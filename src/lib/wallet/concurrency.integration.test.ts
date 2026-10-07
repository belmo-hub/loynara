import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { POST as googleIssue } from "@/app/api/wallet/google/route";
import { closeCard } from "@/lib/card-lifecycle";
import { reissueCardByStaff } from "@/lib/card-reissue";
import { award } from "@/lib/loyalty";
import { createMerchant, enroll } from "@/lib/product";
import { googleObjectId, GoogleWalletClient } from "./google";
import { issueWalletPass } from "./issue";
import { refreshWalletForMembership } from "./refresh";
import { fakeGoogleApi, googleFixture, withEnv } from "./test-support";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices, rate_limits CASCADE'); });
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await pool.end(); });

async function fixture() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Concurrent Wallet", `${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Race Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 5 });
  return { owner, merchant, member: await enroll({ slug: merchant.programSlug, acceptedTerms: true }) };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Pause exactly the first matching write, before the fake provider changes its stored object. */
function gateWrite(api: ReturnType<typeof fakeGoogleApi>, method: string) {
  const entered = deferred();
  const release = deferred();
  let gated = false;
  const fetcher: typeof fetch = async (input, init) => {
    if (!gated && init?.method === method && String(input).includes("/loyaltyObject")) {
      gated = true;
      entered.resolve();
      await release.promise;
    }
    return api.fetcher(input, init);
  };
  return { fetcher, entered: entered.promise, release: release.resolve };
}

/** Wait for a competing operation to finish (buggy code) or block behind the in-flight pass write (fixed code). */
async function settledOrPassLocked(operation: Promise<unknown>) {
  let settled = false;
  operation.finally(() => { settled = true; }).catch(() => {});
  const deadline = Date.now() + 5000;
  while (!settled) {
    const result = await pool.query<{ waiting: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0 AND query ILIKE '%wallet_passes%') AS waiting");
    if (result.rows[0].waiting) return;
    if (Date.now() >= deadline) throw new Error("Competing Wallet operation neither completed nor acquired a waiting pass lock");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await operation;
}

describe("Google provider writes retain lifecycle ordering", () => {
  for (const lifecycle of ["closed", "reissued"] as const) {
    for (const write of ["issuance", "refresh"] as const) {
    it(`cannot leave an ACTIVE object after an in-flight ${write} is ${lifecycle}`, async () => {
      const google = googleFixture();
      try {
        await withEnv({ ...google.env, PUBLIC_BASE_URL: "http://localhost:3000", TRUSTED_INGRESS: "local" }, async () => {
          const { owner, merchant, member } = await fixture();
          const api = fakeGoogleApi();
          const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: google.privateKey }, api.fetcher);
          if (write === "refresh") {
            await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, { issuerId: "123456" }));
            await refreshWalletForMembership(member.id, { google: client });
          }
          const gate = gateWrite(api, write === "issuance" ? "POST" : "PATCH");
          vi.stubGlobal("fetch", gate.fetcher);
          const writing = write === "issuance"
            ? googleIssue(new Request("http://localhost:3000/api/wallet/google", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ token: member.cardToken }) }))
            : refreshWalletForMembership(member.id, { google: new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: google.privateKey }, gate.fetcher) });
          await gate.entered;
          const revoke = lifecycle === "closed" ? closeCard(member.cardToken) : reissueCardByStaff({ actorUserId: owner, locationId: merchant.locationId, membershipId: member.id, reason: "Lost phone, ownership checked", verificationMethod: "card_link", entitlementConfirmed: true, idempotencyKey: randomUUID() });
          const withdrawal = revoke.then(() => refreshWalletForMembership(member.id, { google: client }));
          try { await settledOrPassLocked(withdrawal); } finally { gate.release(); }
          await Promise.all([writing, withdrawal]);
          const [object] = [...api.objects.values()];
          expect(object).toMatchObject({ state: "INACTIVE" });
          expect(object).not.toHaveProperty("barcode");
          const result = await pool.query("SELECT status, revoked_at FROM wallet_passes WHERE membership_id = $1", [member.id]);
          expect(result.rows[0]).toMatchObject({ status: "revoked", revoked_at: expect.any(Date) });
          await refreshWalletForMembership(member.id, { google: client });
          expect([...api.objects.values()][0]).toMatchObject({ state: "INACTIVE" });
        });
      } finally { google.cleanup(); }
    });
    }
  }

  it("a delayed older refresh cannot overwrite a newer worker's balance", async () => {
    const google = googleFixture();
    try {
      await withEnv(google.env, async () => {
        const { owner, merchant, member } = await fixture();
        const api = fakeGoogleApi();
        const credentials = { clientEmail: "issuer@example.test", privateKey: google.privateKey };
        const pass = await issueWalletPass(member.cardToken, "google", id => googleObjectId(id, { issuerId: "123456" }));
        await refreshWalletForMembership(member.id, { google: new GoogleWalletClient(credentials, api.fetcher) });
        const gate = gateWrite(api, "PATCH");
        const older = refreshWalletForMembership(member.id, { google: new GoogleWalletClient(credentials, gate.fetcher) });
        await gate.entered;
        await award({ userId: owner, locationId: merchant.locationId, membershipId: member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
        const newer = refreshWalletForMembership(member.id, { google: new GoogleWalletClient(credentials, api.fetcher) });
        try { await settledOrPassLocked(newer); } finally { gate.release(); }
        await Promise.all([older, newer]);
        expect(api.objects.get(googleObjectId(pass.id, { issuerId: "123456" }))).toMatchObject({ loyaltyPoints: { balance: { string: "2 / 5" } } });
      });
    } finally { google.cleanup(); }
  });
});
