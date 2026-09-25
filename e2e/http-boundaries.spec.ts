import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";

type Merchant = { tenantId: string; locationId: string; programSlug: string };
type Card = { cardToken: string; scanCode: string; membershipId: string; rewardVersionId: string };

async function syntheticAccount(baseURL: string) {
  const origin = new URL(baseURL).origin;
  const context = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  const email = `http-${randomUUID()}@example.test`;
  const response = await context.post("/api/auth/sign-up/email", { data: { name: "Synthetic HTTP tester", email, password: `Local!${randomUUID()}Aa` } });
  expect(response.status()).toBe(200);
  return { context, email };
}

async function syntheticMerchant(context: APIRequestContext, name: string): Promise<Merchant> {
  const response = await context.post("/api/merchant/onboard", { data: {
    businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Synthetic card", programType: "stamp", rulesText: "One synthetic stamp per confirmed test visit.", rewardTitle: "Synthetic reward", rewardCost: 5,
  } });
  expect(response.status()).toBe(201);
  return await response.json() as Merchant;
}

async function syntheticCard(baseURL: string, slug: string): Promise<Card> {
  const guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  try {
    const joined = await guest.post("/api/enroll", { data: { slug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const card = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    expect(card.status()).toBe(200);
    const { scanCode, rewards } = await card.json() as { scanCode: string; rewards: { id: string }[] };
    const lookup = { cardToken, scanCode, membershipId: "", rewardVersionId: rewards[0].id };
    expect(lookup.scanCode).toMatch(/^sc_[A-Za-z0-9_-]{32}$/);
    expect(lookup.cardToken).toMatch(/^card_[A-Za-z0-9_-]{43}$/);
    return lookup;
  } finally { await guest.dispose(); }
}

test("HTTP sessions enforce tenant and staff boundaries, retries, redemption and exports", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const ownerA = await syntheticAccount(url);
  const ownerB = await syntheticAccount(url);
  const cashier = await syntheticAccount(url);
  try {
    const merchantA = await syntheticMerchant(ownerA.context, "Synthetic HTTP Café A");
    const merchantB = await syntheticMerchant(ownerB.context, "Synthetic HTTP Café B");
    const cardA = await syntheticCard(url, merchantA.programSlug);
    const cardB = await syntheticCard(url, merchantB.programSlug);

    const lookupA = await ownerA.context.get(`/api/cashier/lookup?code=${encodeURIComponent(cardA.scanCode)}`);
    expect(lookupA.status()).toBe(200);
    cardA.membershipId = (await lookupA.json() as { membershipId: string }).membershipId;
    const lookupB = await ownerB.context.get(`/api/cashier/lookup?code=${encodeURIComponent(cardB.scanCode)}`);
    expect(lookupB.status()).toBe(200);
    cardB.membershipId = (await lookupB.json() as { membershipId: string }).membershipId;
    expect((await ownerB.context.get(`/api/cashier/lookup?code=${encodeURIComponent(cardA.scanCode)}`)).status()).toBe(404);
    expect((await ownerA.context.get(`/api/cashier/lookup?code=${encodeURIComponent(cardB.scanCode)}`)).status()).toBe(404);

    const invite = await ownerA.context.post("/api/staff/invite", { data: { locationId: merchantA.locationId, email: cashier.email, role: "cashier" } });
    expect(invite.status()).toBe(201);
    const { token: inviteToken } = await invite.json() as { token: string };
    expect((await cashier.context.post("/api/staff/accept", { data: { token: inviteToken } })).status()).toBe(200);
    expect((await cashier.context.get(`/api/cashier/lookup?code=${encodeURIComponent(cardA.scanCode)}`)).status()).toBe(200);
    expect((await cashier.context.get("/api/staff")).status()).toBe(403);
    expect((await cashier.context.get("/api/merchant/export")).status()).toBe(403);

    const merchantExport = await ownerA.context.get("/api/merchant/export");
    expect(merchantExport.status()).toBe(200);
    expect(merchantExport.headers()["content-disposition"]).toContain("attachment");
    const merchantData = await merchantExport.json() as { tenant: { id: string }; memberships: { id: string }[]; ledger: unknown[] };
    expect(merchantData.tenant.id).toBe(merchantA.tenantId);
    expect(merchantData.memberships.map(row => row.id)).toContain(cardA.membershipId);
    expect(merchantData.memberships.map(row => row.id)).not.toContain(cardB.membershipId);
    expect(JSON.stringify(merchantData)).not.toContain(cardA.cardToken);
    expect(JSON.stringify(merchantData)).not.toContain(cardA.scanCode);

    const cardExport = await ownerA.context.get(`/api/card/${encodeURIComponent(cardA.cardToken)}/export`);
    expect(cardExport.status()).toBe(200);
    expect(cardExport.headers()["content-disposition"]).toContain("attachment");
    const customerData = await cardExport.json() as { membership: { id: string }; ledger: unknown[] };
    expect(customerData.membership.id).toBe(cardA.membershipId);
    expect(JSON.stringify(customerData)).not.toContain(cardA.cardToken);
    expect(JSON.stringify(customerData)).not.toContain(cardA.scanCode);
    expect((await ownerA.context.get(`/api/card/${encodeURIComponent(cardA.scanCode)}`)).status()).toBe(404);

    const ownerBrowser = await browser.newContext({ baseURL: url, storageState: await ownerA.context.storageState(), acceptDownloads: true });
    try {
      const page = await ownerBrowser.newPage();
      await page.goto("/merchant");
      const merchantDownloadEvent = page.waitForEvent("download");
      await page.locator('a[href="/api/merchant/export"]').click();
      const merchantDownload = await merchantDownloadEvent;
      expect(merchantDownload.suggestedFilename()).toBe("looplocal-merchant-export.json");
      const downloadedMerchant = JSON.parse(await readFile(await merchantDownload.path(), "utf8")) as { tenant: { id: string } };
      expect(downloadedMerchant.tenant.id).toBe(merchantA.tenantId);

      await page.goto(`/card/${encodeURIComponent(cardA.cardToken)}`);
      const cardDownloadEvent = page.waitForEvent("download");
      await page.locator(`a[href="/api/card/${encodeURIComponent(cardA.cardToken)}/export"]`).click();
      const cardDownload = await cardDownloadEvent;
      expect(cardDownload.suggestedFilename()).toBe("looplocal-card-export.json");
      const downloadedCard = JSON.parse(await readFile(await cardDownload.path(), "utf8")) as { membership: { id: string } };
      expect(downloadedCard.membership.id).toBe(cardA.membershipId);
    } finally { await ownerBrowser.close(); }

    const awardInput = { membershipId: cardA.membershipId, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() };
    const first = await cashier.context.post("/api/cashier/award", { data: awardInput });
    expect(first.status()).toBe(200);
    const firstAward = await first.json() as { balance: number; duplicate: boolean; entryId: string };
    expect(firstAward).toMatchObject({ balance: 5, duplicate: false });
    const retry = await cashier.context.post("/api/cashier/award", { data: awardInput });
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toMatchObject({ balance: 5, duplicate: true, entryId: firstAward.entryId });
    const crossTenantAward = await ownerB.context.post("/api/cashier/award", { data: { ...awardInput, idempotencyKey: randomUUID(), requestId: randomUUID() } });
    expect([403, 404]).toContain(crossTenantAward.status());

    const redemption = { membershipId: cardA.membershipId, rewardVersionId: cardA.rewardVersionId };
    const [redemptionA, redemptionB] = await Promise.all([
      cashier.context.post("/api/cashier/redeem", { data: { ...redemption, idempotencyKey: randomUUID(), requestId: randomUUID() } }),
      cashier.context.post("/api/cashier/redeem", { data: { ...redemption, idempotencyKey: randomUUID(), requestId: randomUUID() } }),
    ]);
    expect([redemptionA.status(), redemptionB.status()].sort()).toEqual([200, 409]);
    const cardAfter = await ownerA.context.get(`/api/card/${encodeURIComponent(cardA.cardToken)}`);
    expect(cardAfter.status()).toBe(200);
    expect((await cardAfter.json() as { balance: number }).balance).toBe(0);

    const staffList = await ownerA.context.get("/api/staff");
    expect(staffList.status()).toBe(200);
    const staff = await staffList.json() as { staff: { userId: string; email: string }[] };
    const cashierId = staff.staff.find(row => row.email === cashier.email)?.userId;
    expect(cashierId).toBeTruthy();
    expect((await ownerA.context.post("/api/staff/revoke", { data: { userId: cashierId } })).status()).toBe(200);
    expect((await cashier.context.get(`/api/cashier/lookup?code=${encodeURIComponent(cardA.scanCode)}`)).status()).toBe(403);
    expect((await cashier.context.post("/api/cashier/award", { data: { ...awardInput, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(403);

    const retained = await ownerA.context.get("/api/merchant/export");
    expect(retained.status()).toBe(200);
    expect((await retained.json() as { ledger: unknown[] }).ledger).toHaveLength(2);

    const missingConfirmation = await ownerA.context.post(`/api/card/${encodeURIComponent(cardA.cardToken)}/close`, { data: { confirm: "no" } });
    expect(missingConfirmation.status()).toBe(400);
    const closure = await ownerA.context.post(`/api/card/${encodeURIComponent(cardA.cardToken)}/close`, { data: { confirm: "CLOSE_CARD" } });
    expect(closure.status()).toBe(200);
    expect(await closure.json()).toMatchObject({ closed: true, retention: "pseudonymous-ledger-and-consent-pending-policy" });
    expect((await ownerA.context.get(`/api/card/${encodeURIComponent(cardA.cardToken)}`)).status()).toBe(404);
    expect((await ownerA.context.get(`/api/card/${encodeURIComponent(cardA.cardToken)}/export`)).status()).toBe(404);
    expect((await ownerA.context.get(`/api/cashier/lookup?code=${encodeURIComponent(cardA.scanCode)}`)).status()).toBe(404);
    const afterClosure = await ownerA.context.get("/api/merchant/export");
    expect(afterClosure.status()).toBe(200);
    const afterData = await afterClosure.json() as { memberships: { id: string; closedAt: string | null }[]; ledger: unknown[] };
    expect(afterData.memberships.find(row => row.id === cardA.membershipId)?.closedAt).toBeTruthy();
    expect(afterData.ledger).toHaveLength(2);
  } finally {
    await Promise.all([ownerA.context.dispose(), ownerB.context.dispose(), cashier.context.dispose()]);
  }
});
