import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";

async function account(baseURL: string) {
  const context = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  const email = `members-${randomUUID()}@example.test`;
  expect((await context.post("/api/auth/sign-up/email", { data: { name: "Synthetic merchant tester", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  return { context, email };
}

async function shop(context: APIRequestContext, name: string) {
  const response = await context.post("/api/merchant/onboard", { data: {
    businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Synthetic card", programType: "stamp", rulesText: "One synthetic stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5,
  } });
  expect(response.status()).toBe(201);
  return await response.json() as { tenantId: string; locationId: string; programSlug: string };
}

async function card(baseURL: string, slug: string) {
  const guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  try {
    const joined = await guest.post("/api/enroll", { data: { slug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const response = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    expect(response.status()).toBe(200);
    const { scanCode } = await response.json() as { scanCode: string };
    return { cardToken, scanCode };
  } finally { await guest.dispose(); }
}

test("merchant customers are pseudonymous, scoped and reachable through their timeline", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const ownerA = await account(url);
  const ownerB = await account(url);
  const manager = await account(url);
  const cashier = await account(url);
  try {
    const a = await shop(ownerA.context, "Synthetic Customer Café A");
    const b = await shop(ownerB.context, "Synthetic Customer Café B");
    const cardA = await card(url, a.programSlug);
    const cardB = await card(url, b.programSlug);
    const lookupA = await ownerA.context.get(`/api/cashier/lookup?code=${encodeURIComponent(cardA.scanCode)}`);
    expect(lookupA.status()).toBe(200);
    const { membershipId } = await lookupA.json() as { membershipId: string };
    const lookupB = await ownerB.context.get(`/api/cashier/lookup?code=${encodeURIComponent(cardB.scanCode)}`);
    expect(lookupB.status()).toBe(200);
    const { membershipId: membershipB } = await lookupB.json() as { membershipId: string };
    expect((await ownerA.context.post("/api/cashier/award", { data: { membershipId, quantity: 3, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);

    const ownList = await ownerA.context.get("/api/merchant/customers");
    expect(ownList.status()).toBe(200);
    const ownData = await ownList.json() as { members: Array<{ id: string; balance: number; qualifyingCheckouts: number; purchaseCount: number | null; emailMarketingEligible: boolean }> };
    expect(ownData.members).toMatchObject([{ id: membershipId, balance: 3, qualifyingCheckouts: 1, purchaseCount: null, emailMarketingEligible: false }]);
    expect(JSON.stringify(ownData)).not.toContain(cardA.cardToken);
    expect(JSON.stringify(ownData)).not.toContain(cardA.scanCode);
    expect((await ownerA.context.get(`/api/merchant/customers?q=${membershipId.slice(0, 12)}&status=active`)).status()).toBe(200);
    const recorded = await ownerA.context.get("/api/merchant/customers?activity=recorded");
    expect((await recorded.json() as { members: Array<{ id: string }> }).members.map(row => row.id)).toEqual([membershipId]);
    const none = await ownerA.context.get("/api/merchant/customers?activity=none");
    expect((await none.json() as { members: Array<{ id: string }> }).members).toEqual([]);

    const ownDetail = await ownerA.context.get(`/api/merchant/customers/${membershipId}`);
    expect(ownDetail.status()).toBe(200);
    expect((await ownDetail.json() as { timeline: Array<{ delta: number }> }).timeline.map(entry => entry.delta)).toEqual([3]);
    expect((await ownerA.context.get("/api/merchant/customers/import-preview")).status()).toBe(200);
    const importResponse = await ownerA.context.post("/api/merchant/customers/import-preview", { data: {
      csv: "legacy,email,balance,consent,source,date\nSYN-001,test@example.test,4,yes,paper_form,2026-09-20\nSYN-001,other@example.test,2,no,,",
      mapping: { externalId: "legacy", email: "email", balance: "balance", marketingConsent: "consent", consentSource: "source", consentDate: "date" },
    } });
    expect(importResponse.status()).toBe(200);
    const importPreview = await importResponse.json() as { total: number; ready: number; duplicates: number; writesPerformed: boolean; rows: Array<{ status: string }> };
    expect(importPreview).toMatchObject({ total: 2, ready: 1, duplicates: 1, writesPerformed: false });
    expect(JSON.stringify(importPreview)).not.toContain("test@example.test");
    expect((await ownerA.context.get(`/api/merchant/customers/${membershipId}`).then(response => response.json()) as { member: { balance: number; emailMarketingEligible: boolean } }).member).toMatchObject({ balance: 3, emailMarketingEligible: false });
    expect((await ownerB.context.get(`/api/merchant/customers/${membershipId}`)).status()).toBe(404);
    const otherList = await ownerB.context.get("/api/merchant/customers");
    expect(otherList.status()).toBe(200);
    const otherData = await otherList.json() as { members: Array<{ id: string }> };
    expect(otherData.members.map(row => row.id)).toContain(membershipB);
    expect(otherData.members.map(row => row.id)).not.toContain(membershipId);
    expect((await apiRequest.newContext({ baseURL: url }).then(async unauth => { try { return (await unauth.get("/api/merchant/customers")).status(); } finally { await unauth.dispose(); } }))).toBe(401);

    for (const [person, role] of [[manager, "manager"], [cashier, "cashier"]] as const) {
      const invite = await ownerA.context.post("/api/staff/invite", { data: { locationId: a.locationId, email: person.email, role } });
      expect(invite.status()).toBe(201);
      const { token } = await invite.json() as { token: string };
      expect((await person.context.post("/api/staff/accept", { data: { token } })).status()).toBe(200);
    }
    expect((await manager.context.get("/api/merchant/customers")).status()).toBe(200);
    expect((await manager.context.get("/api/merchant/customers/import-preview")).status()).toBe(403);
    expect((await cashier.context.get("/api/merchant/customers")).status()).toBe(403);
    expect((await cashier.context.get(`/api/merchant/customers/${membershipId}`)).status()).toBe(403);
    expect((await cashier.context.get("/api/merchant/customers/import-preview")).status()).toBe(403);

    const ownerBrowser = await browser.newContext({ baseURL: url, storageState: await ownerA.context.storageState() });
    try {
      const page = await ownerBrowser.newPage();
      await page.goto("/merchant/customers");
      await expect(page.getByRole("heading", { name: "Kundenkarten" })).toBeVisible();
      // Cards are listed by their short card number, never by name.
      const { member } = await (await ownerA.context.get(`/api/merchant/customers/${membershipId}`)).json() as { member: { cardNumber: string } };
      expect(member.cardNumber).toMatch(/^K-\d{4,}$/);
      await page.getByRole("button", { name: new RegExp(`Karte ${member.cardNumber}`) }).click();
      await expect(page.getByRole("heading", { name: "Kartenverlauf" })).toBeVisible();
      await expect(page.getByText("+3 Stempel")).toBeVisible();
      await page.getByRole("link", { name: "CSV-Vorschau" }).click();
      await expect(page.getByRole("heading", { name: "CSV-Vorschau" })).toBeVisible();
      await page.getByRole("button", { name: "Vorschau prüfen" }).click();
      await expect(page.getByRole("heading", { name: "Prüfergebnis" })).toBeVisible();
    } finally { await ownerBrowser.close(); }

    const staffList = await ownerA.context.get("/api/staff");
    const staff = await staffList.json() as { staff: Array<{ userId: string; email: string }> };
    const managerId = staff.staff.find(row => row.email === manager.email)?.userId;
    expect(managerId).toBeTruthy();
    expect((await ownerA.context.post("/api/staff/revoke", { data: { userId: managerId } })).status()).toBe(200);
    expect((await manager.context.get("/api/merchant/customers")).status()).toBe(403);
    expect((await manager.context.get(`/api/merchant/customers/${membershipId}`)).status()).toBe(403);
  } finally {
    await Promise.all([ownerA.context.dispose(), ownerB.context.dispose(), manager.context.dispose(), cashier.context.dispose()]);
  }
});
