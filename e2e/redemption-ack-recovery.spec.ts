import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { createMerchant } from "../src/lib/product";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid"), origin = "http://localhost:3000";
if (process.env.NODE_ENV === "production" || database.hostname !== "localhost" || database.port !== "55433" || database.pathname !== "/looplocal_browser_redemption_085") throw new Error("Owned synthetic redemption database required");
let merchant: Awaited<ReturnType<typeof createMerchant>>;
let storage: Awaited<ReturnType<BrowserContext["storageState"]>>;
test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== origin) throw new Error("Loopback application required");
  const email = `${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const owner = await auth.api.signUpEmail({ body: { name: "Synthetic redemption owner", email, password } });
  merchant = await createMerchant({ userId: owner.user.id, businessName: "Synthetic redemption Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Redemption test", programType: "points", rulesText: "Explicit synthetic points", rewardTitle: "Coffee", rewardCost: 3 });
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  try {
    expect((await context.request.post("/api/auth/sign-in/email", { data: { email, password } })).status()).toBe(200);
    expect((await context.request.post("/api/merchant/program/rewards", { data: { action: "create", programSlug: merchant.programSlug, title: "Tea", cost: 6 } })).status()).toBe(201);
    storage = await context.storageState();
  } finally { await context.close(); }
});
test.afterAll(async () => { await pool.end(); });
async function fixture(browser: Browser, baseURL: string | undefined, width: number) {
  const context = await browser.newContext({ baseURL, storageState: storage, extraHTTPHeaders: { Origin: origin }, viewport: { width, height: 844 } });
  const customer = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin }, viewport: { width, height: 844 } });
  const enrolled = await customer.request.post("/api/enroll", { data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } }); expect(enrolled.status()).toBe(201);
  const { cardToken } = await enrolled.json(), card = await (await customer.request.get(`/api/card/${cardToken}`)).json();
  const looked = await context.request.get(`/api/cashier/lookup?code=${encodeURIComponent(card.scanCode)}`); expect(looked.status()).toBe(200); const member = await looked.json();
  expect((await context.request.post("/api/cashier/award", { data: { membershipId: member.membershipId, quantity: 9, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);
  const customerPage = await customer.newPage(); await customerPage.goto(`/card/${cardToken}`);
  await customerPage.getByRole("button", { name: /^Coffee/ }).click();
  const page = await context.newPage(); await page.goto("/cashier"); await page.locator("#cashier-code").fill(card.scanCode); await page.locator("#cashier-code").press("Enter");
  const reward = page.locator(".reward-action-list").getByRole("button").filter({ hasText: "Coffee" }); await expect(reward).toBeEnabled();
  return { context, customer, customerPage, page, reward, member, cardToken };
}
async function persisted(membershipId: string) {
  return { member: (await pool.query("SELECT balance FROM memberships WHERE id=$1", [membershipId])).rows[0], entries: (await pool.query("SELECT id,idempotency_key,delta FROM ledger_entries WHERE membership_id=$1 AND kind='redeem'", [membershipId])).rows, redemptions: (await pool.query("SELECT ledger_entry_id,cost FROM redemptions WHERE membership_id=$1", [membershipId])).rows };
}
for (const [width, missingBody] of [[375, ""], [1280, "{"]] as const) test(`committed redemption with missing JSON acknowledgment reuses the same key on explicit confirmation (${width}px)`, async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, width), payloads: Array<Record<string, unknown>> = []; let replay: Record<string, unknown> | undefined;
  try {
    await f.page.route("**/api/cashier/redeem", async route => {
      payloads.push(route.request().postDataJSON()); const response = await route.fetch(); expect(response.status()).toBe(200); const result = await response.json();
      if (payloads.length === 1) {
        expect(result).toMatchObject({ balance: 6, duplicate: false }); const actual = await persisted(f.member.membershipId); expect(actual.member.balance).toBe(6); expect(actual.redemptions).toHaveLength(1);
        // Actual application commit precedes interrupted/invalid JSON; no fake success or mocked ledger.
        await route.fulfill({ response, body: missingBody });
      } else { replay = result; await route.fulfill({ response }); }
    });
    await f.reward.click(); await f.page.getByRole("button", { name: "Ja, einlösen", exact: true }).click(); await expect(f.reward).toBeEnabled();
    expect.soft(await f.page.locator(".cashier-status").textContent()).toContain("Ergebnis unklar");
    await expect(f.page.locator(".cashier-booked")).toHaveCount(0); expect(payloads).toHaveLength(1);
    const afterFirst = await persisted(f.member.membershipId); expect(afterFirst.member.balance).toBe(6); expect(afterFirst.redemptions).toHaveLength(1);
    // Only deliberate confirmation retries; eligibility still allows it, so a fresh key would spend again.
    await f.reward.click(); await f.page.getByRole("button", { name: "Ja, einlösen", exact: true }).click(); await expect(f.page.locator(".cashier-booked")).toContainText("Neuer Stand: 6 Punkte");
    await expect(f.page.locator(".cashier-booked")).toContainText("war bereits gebucht");
    expect(payloads).toHaveLength(2); expect.soft(payloads[1].idempotencyKey).toBe(payloads[0].idempotencyKey); expect.soft(payloads[1].requestId).toBe(payloads[0].requestId);
    expect.soft(replay).toMatchObject({ balance: 6, duplicate: true }); const actual = await persisted(f.member.membershipId);
    expect.soft(actual.member.balance).toBe(6); expect.soft(actual.entries).toHaveLength(1); expect.soft(actual.redemptions).toHaveLength(1);
    // Respect the existing five-second refresh gate and visible-page contract, without changing its clock.
    const refreshed = f.customerPage.waitForResponse(r => new URL(r.url()).pathname === `/api/card/${f.cardToken}`);
    await f.customerPage.waitForTimeout(5100);
    await f.customerPage.bringToFront();
    await f.customerPage.getByRole("button", { name: "Karte aktualisieren", exact: true }).click();
    expect(await (await refreshed).json()).toMatchObject({ balance: 6 });
    await expect(f.customerPage.locator(".customer-balance-line strong")).toHaveText(/6\s*Punkte/);
    const customerState = await (await f.customer.request.get(`/api/card/${f.cardToken}`)).json(); expect.soft(customerState.balance).toBe(6); expect.soft(customerState.activity.filter((r: { kind: string }) => r.kind === "redeem")).toHaveLength(1);
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await f.context.close(); await f.customer.close(); }
});
test("definitive archived-reward rejection leaves actual accounting unchanged and never displays success", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, 375);
  try {
    const created = await f.context.request.post("/api/merchant/program/rewards", { data: { action: "create", programSlug: merchant.programSlug, title: "Rejected reward", cost: 5 } }); expect(created.status()).toBe(201); const { rewardId } = await created.json();
    await f.page.getByRole("button", { name: "Andere Karte" }).click(); const card = await (await f.customer.request.get(`/api/card/${f.cardToken}`)).json(); await f.page.locator("#cashier-code").fill(card.scanCode); await f.page.locator("#cashier-code").press("Enter");
    const rejected = f.page.locator(".reward-action-list").getByRole("button").filter({ hasText: "Rejected reward" }); await expect(rejected).toBeEnabled();
    expect((await f.context.request.post("/api/merchant/program/rewards", { data: { action: "archive", programSlug: merchant.programSlug, rewardId } })).status()).toBe(200);
    const before = await persisted(f.member.membershipId), failed = f.page.waitForResponse(r => new URL(r.url()).pathname === "/api/cashier/redeem"); await rejected.click(); await f.page.getByRole("button", { name: "Ja, einlösen", exact: true }).click(); const response = await failed;
    expect(response.status()).toBe(400); expect(await response.json()).toMatchObject({ code: "INVALID_REWARD" });
    await expect(f.page.locator(".cashier-status--rejected")).toBeVisible(); await expect(f.page.locator(".cashier-booked")).toHaveCount(0); expect(await persisted(f.member.membershipId)).toEqual(before);
    await f.page.getByRole("button", { name: "Andere Karte" }).click(); await f.page.locator("#cashier-code").fill(card.scanCode); await f.page.locator("#cashier-code").press("Enter"); await expect(rejected).toHaveCount(0); await expect(f.reward).toBeEnabled();
  } finally { await f.context.close(); await f.customer.close(); }
});
