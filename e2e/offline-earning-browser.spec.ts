import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("cashier queues an explicit offline award without credit, reloads, and syncs once online", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const headers = { Origin: new URL(url).origin };
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  try {
    expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic offline owner", email: `offline-ui-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const setup = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Synthetic Offline Bakery", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Offline browser test", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Bread", rewardCost: 5,
    } });
    expect(setup.status()).toBe(201);
    const { programSlug } = await setup.json() as { programSlug: string };
    const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const { scanCode } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
    const context = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const page = await context.newPage();
      await page.goto("/cashier");
      await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
      const leased = page.waitForResponse(response => response.url().includes("/api/cashier/offline/lease") && response.ok());
      await page.getByRole("button", { name: "Prüfen", exact: true }).click();
      await leased;
      // Online, the offline fallback is not offered at all.
      await expect(page.getByText("Offline-Puffer bereit", { exact: false })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Offline-Vergaben" })).toHaveCount(0);
      // Online, one stamp is booked with one tap; there is no offline choice to make.
      await expect(page.locator(".cashier-award-now")).toHaveText("1 Stempel vergeben");
      await expect(page.getByRole("button", { name: "Offline-Vergabe vormerken" })).toHaveCount(0);
      await context.setOffline(true);
      await expect(page.getByText("Offline-Puffer bereit", { exact: false })).toBeVisible();
      await page.locator(".cashier-award-now").click();
      await expect(page.getByText("Verbindung gestört.", { exact: false })).toBeVisible();
      await page.getByRole("button", { name: "Offline-Vergabe vormerken" }).click();
      await expect(page.getByText("1 ausstehend", { exact: false })).toBeVisible();
      await expect(page.locator(".cashier-booked")).toContainText("Vorgemerkt, noch nicht gebucht");
      await expect(page.locator(".cashier-award-now")).toHaveCount(0);
      await page.screenshot({ path: "screenshots/platform-after-offline-pending.png", fullPage: true });
      expect((await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json()).balance).toBe(0);
      await context.setOffline(false);
      await page.reload();
      await expect(page.getByText("1 ausstehend", { exact: false })).toBeVisible();
      await page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren" }).click();
      await expect(page.getByText("Vom Server angenommen", { exact: false })).toBeVisible();
      await page.screenshot({ path: "screenshots/platform-after-offline-accepted.png", fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByText("Vom Server angenommen", { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: "screenshots/platform-after-offline-mobile.png", fullPage: true });
      expect((await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json()).balance).toBe(1);
      const report = await (await owner.get("/api/merchant/analytics?window=30")).json() as { qualifyingCheckouts: number };
      expect(report.qualifyingCheckouts).toBe(1);
      const audience = await (await owner.get(`/api/merchant/audiences/preview?programSlug=${encodeURIComponent(programSlug)}&kind=recently_active&withinDays=30`)).json() as { total: number };
      expect(audience.total).toBe(1);
    } finally { await context.close(); }
  } finally { await Promise.all([owner.dispose(), guest.dispose()]); }
});
