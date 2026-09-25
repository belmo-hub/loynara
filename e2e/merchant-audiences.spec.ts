import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";

async function account(baseURL: string) {
  const context = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  const email = `audience-${randomUUID()}@example.test`;
  expect((await context.post("/api/auth/sign-up/email", { data: { name: "Synthetic audience tester", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  return context;
}

async function shop(context: APIRequestContext) {
  const response = await context.post("/api/merchant/onboard", { data: {
    businessName: "Synthetic Audience Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Synthetic audience card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5,
  } });
  expect(response.status()).toBe(201);
  return await response.json() as { programSlug: string };
}

async function card(baseURL: string, slug: string) {
  const guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  try {
    const joined = await guest.post("/api/enroll", { data: { slug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const response = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    expect(response.status()).toBe(200);
    return (await response.json() as { scanCode: string }).scanCode;
  } finally { await guest.dispose(); }
}

test("merchant audience count changes after a confirmed checkout and appears in the browser", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await account(url);
  const other = await account(url);
  try {
    const { programSlug } = await shop(owner);
    await shop(other);
    const firstScan = await card(url, programSlug);
    await card(url, programSlug);
    const previewPath = `/api/merchant/audiences/preview?programSlug=${encodeURIComponent(programSlug)}&kind=recently_active&withinDays=30`;
    expect((await owner.get(previewPath).then(response => response.json()) as { total: number }).total).toBe(0);
    expect((await other.get(previewPath)).status()).toBe(404);
    const lookup = await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(firstScan)}`);
    expect(lookup.status()).toBe(200);
    const { membershipId } = await lookup.json() as { membershipId: string };
    expect((await owner.post("/api/cashier/award", { data: { membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);
    expect((await owner.get(previewPath).then(response => response.json()) as { total: number }).total).toBe(1);

    const browserContext = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const page = await browserContext.newPage();
      await page.goto("/merchant/audiences");
      await expect(page.getByRole("heading", { name: "Segmente prüfen" })).toBeVisible();
      await page.getByLabel("Segment").selectOption("recently_active");
      await page.getByRole("button", { name: "Anzahl berechnen" }).click();
      await expect(page.getByTestId("audience-total")).toHaveText("1");
      await page.getByLabel("Segment").selectOption("new");
      await page.getByRole("button", { name: "Anzahl berechnen" }).click();
      await expect(page.getByTestId("audience-total")).toHaveText("2");
      await page.screenshot({ path: "screenshots/platform-after-audiences.png", fullPage: true });
    } finally { await browserContext.close(); }
  } finally { await owner.dispose(); await other.dispose(); }
});
