import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("synthetic merchant adviser changes after a confirmed checkout", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const headers = { Origin: new URL(url).origin };
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  try {
    const email = `adviser-${randomUUID()}@example.test`;
    expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic adviser owner", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const onboard = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Synthetic Adviser Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Synthetic stamp card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5,
    } });
    expect(onboard.status()).toBe(201);
    const { programSlug } = await onboard.json() as { programSlug: string };
    const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const card = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    expect(card.status()).toBe(200);
    const { scanCode } = await card.json() as { scanCode: string };
    const lookup = await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`);
    expect(lookup.status()).toBe(200);
    const { membershipId } = await lookup.json() as { membershipId: string };
    const ownerBrowser = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const page = await ownerBrowser.newPage();
      await page.goto("/merchant/adviser");
      await expect(page.getByRole("heading", { name: "Beratung", exact: true })).toBeVisible();
      await expect(page.getByText("Regelbasiert", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Ersten Kassenvorgang prüfen" })).toBeVisible();
      expect((await owner.get("/api/merchant/adviser?window=30")).status()).toBe(200);
      const award = await owner.post("/api/cashier/award", { data: { membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } });
      expect(award.status()).toBe(200);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Ersten Kassenvorgang prüfen" })).toHaveCount(0);
      await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
      await page.screenshot({ path: "screenshots/platform-after-adviser.png", fullPage: true });
    } finally { await ownerBrowser.close(); }
  } finally { await owner.dispose(); await guest.dispose(); }
});
