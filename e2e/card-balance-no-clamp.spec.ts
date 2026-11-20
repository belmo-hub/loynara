import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";

// ENG-273: a card above its goal shows the true count, never the goal, on the owner's card page and the guest's card.
let owner: APIRequestContext, guest: APIRequestContext, cardToken: string, membershipId: string;
test.beforeAll(async ({ baseURL }) => {
  const url = baseURL ?? "http://localhost:3000", options = { baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } };
  owner = await apiRequest.newContext(options); guest = await apiRequest.newContext(options);
  expect((await owner.post("/api/auth/sign-up/email", { headers: { "x-loynara-acceptance": "2026-11-20" }, data: { name: "Synthetic balance owner", email: `owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Pizzeria", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Pizza card", programType: "stamp", rulesText: "One confirmed visit", rewardTitle: "Pizza", rewardCost: 8 } });
  expect(setup.status()).toBe(201);
  const { programSlug } = await setup.json() as { programSlug: string };
  const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } });
  expect(joined.status()).toBe(201);
  ({ cardToken } = await joined.json() as { cardToken: string });
  const { scanCode } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
  ({ membershipId } = await (await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`)).json() as { membershipId: string });
});
test.afterAll(async () => { await owner.dispose(); await guest.dispose(); });

async function award(quantity: number) {
  expect((await owner.post("/api/cashier/award", { data: { membershipId, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);
}

test("below, at and above the goal, the owner's card page and the guest's card show one true number", async ({ browser, baseURL }) => {
  const ownerPage = await (await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 390, height: 844 } })).newPage();
  const guestPage = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage();
  for (const [quantity, shown, label] of [[5, "5 von 8", "5 von 8 Stempeln"], [3, "8 von 8", "8 von 8 Stempeln"], [1, "9 Stempel", "9 Stempel"]] as const) {
    await award(quantity);
    await ownerPage.goto(`/merchant/customers?card=${membershipId}`);
    const mix = ownerPage.locator("section", { has: ownerPage.getByRole("img", { name: label, exact: true }) });
    await expect(mix).toBeVisible();
    await expect(mix).toContainText(shown === "9 Stempel" ? "Stempel" : "von 8");
    if (shown === "9 Stempel") await expect(mix).not.toContainText("von 8");
    await guestPage.goto(`/card/${cardToken}`);
    await expect(guestPage.locator(".customer-balance-line strong")).toHaveText(shown);
    await expect(guestPage.getByRole("list", { name: label, exact: true }).or(guestPage.getByRole("img", { name: label, exact: true }))).toBeVisible();
  }
  await ownerPage.screenshot({ path: "var/playwright-results/273-owner-9-of-8.png", fullPage: true });
  await guestPage.screenshot({ path: "var/playwright-results/273-guest-9-of-8.png", fullPage: true });
});
