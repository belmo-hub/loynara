import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";

// Synthetic local acceptance only. Provider capability is mocked at the browser boundary; flags stay OFF.
const sizes = [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 844 }];

test("combined join, card refresh, Wallet and next-customer/offline counter fit release viewports", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const origin = baseURL ?? "http://localhost:3000";
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const owner = await apiRequest.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic combined owner", email: `${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Combined Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Combined Card", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Besuch.", rewardTitle: "Kaffee gratis", rewardCost: 5 } });
  expect(setup.status()).toBe(201);
  const { programSlug } = await setup.json();
  const capture = async (page: Page, name: string, width: number) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth), name).toBeLessThanOrEqual(width);
    await expect(page.locator("body")).not.toContainText("sc_");
    await expect(page.locator("body")).not.toContainText("PassFast");
    const controlsFit = await page.locator("main button:visible, main input:visible").evaluateAll(elements => elements.every(element => {
      const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth;
    }));
    expect(controlsFit, `${name} controls fit`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${width}-${name}.png`), fullPage: true, mask: [page.locator(".customer-qr img")] });
  };
  try {
    for (const viewport of sizes) {
      const phone = await browser.newContext({ baseURL: origin, viewport });
      const counter = await browser.newContext({ baseURL: origin, viewport, storageState: await owner.storageState() });
      for (const context of [phone, counter]) await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      try {
        const page = await phone.newPage();
        await page.clock.install();
        await page.goto(`/join/${programSlug}`);
        await expect(page.getByRole("button", { name: "Meine Karte erstellen" })).toBeVisible();
        await capture(page, "new-join", viewport.width);
        await page.getByRole("checkbox").first().check();
        await page.getByRole("button", { name: "Meine Karte erstellen" }).click();
        await expect(page.locator(".customer-card-number strong")).toBeVisible();
        const token = new URL(page.url()).pathname.split("/").at(-1)!;
        const card = await (await phone.request.get(`/api/card/${token}`)).json();
        expect(card.cardLocator).toMatch(/^K-[A-Z2-9]{6}$/);
        await expect(page.locator(".customer-wallet-add")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Kontostand aktualisieren", exact: true })).toBeVisible();
        await capture(page, "card-wallet-off", viewport.width);
        const lookup = await (await owner.get(`/api/cashier/lookup?code=${card.scanCode}`)).json();
        expect((await owner.post("/api/cashier/award", { data: { membershipId: lookup.membershipId, quantity: 1, requestId: randomUUID(), idempotencyKey: randomUUID() } })).status()).toBe(200);
        await page.clock.fastForward(5100);
        await page.getByRole("button", { name: "Kontostand aktualisieren", exact: true }).click();
        await expect(page.locator(".customer-balance-line strong")).toContainText("1");
        await capture(page, "manual-refresh", viewport.width);
        await page.goto(`/join/${programSlug}`);
        await expect(page.getByRole("heading", { name: "Willkommen zurück." })).toBeVisible();
        await expect(page.locator(".join-card-number strong")).toHaveText(card.cardLocator);
        await capture(page, "returning-join", viewport.width);
        await page.getByRole("link", { name: "Meine Karte öffnen" }).click();
        await expect(page.locator(".customer-card-number strong")).toHaveText(card.cardLocator);
        await page.route("**/api/wallet/status", route => route.fulfill({ json: { apple: "available", google: "available" } }));
        await page.reload();
        await expect(page.locator(".customer-wallet-add")).toBeVisible();
        await expect(page.getByRole("button", { name: "Kontostand aktualisieren", exact: true })).toBeVisible();
        await capture(page, "card-wallet-mocked-ready", viewport.width);
        const second = await owner.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, additionalCard: true } });
        expect(second.status()).toBe(201);
        const secondToken = (await second.json()).cardToken;
        const cardB = await (await owner.get(`/api/card/${secondToken}`)).json();
        const cashier = await counter.newPage();
        await cashier.goto("/cashier");
        await expect(cashier.getByLabel("Kartennummer oder Kartencode")).toBeVisible();
        await capture(cashier, "cashier-scan", viewport.width);
        await cashier.getByLabel("Kartennummer oder Kartencode").fill(card.scanCode);
        await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
        await expect(cashier.getByRole("heading", { name: card.cardLocator })).toBeVisible();
        await capture(cashier, "cashier-card", viewport.width);
        await cashier.getByRole("button", { name: "Vergabe prüfen" }).click();
        await cashier.getByRole("button", { name: "Ja, vergeben" }).click();
        await expect(cashier.locator(".cashier-booked")).toContainText(card.cardLocator);
        await expect(cashier.getByRole("button", { name: "Vergabe prüfen" })).toHaveCount(0);
        await capture(cashier, "cashier-success", viewport.width);
        await cashier.getByLabel("Kartennummer oder Kartencode").fill(cardB.scanCode);
        const leased = cashier.waitForResponse(response => response.url().includes("/api/cashier/offline/lease") && response.ok());
        await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
        await leased;
        await expect(cashier.getByRole("heading", { name: cardB.cardLocator })).toBeVisible();
        await capture(cashier, "cashier-immediate-next", viewport.width);
        await counter.setOffline(true);
        await expect(cashier.getByRole("region", { name: "Offline-Vergaben" })).toBeVisible();
        await cashier.getByRole("button", { name: "Vergabe prüfen" }).click();
        await expect(cashier.getByRole("button", { name: "Offline-Vergabe vormerken" })).toBeVisible();
        await capture(cashier, "cashier-offline-fallback", viewport.width);
        await counter.setOffline(false);
        await cashier.goto("/merchant/program/card");
        await expect(cashier.getByRole("heading", { name: "Kundenkarte", level: 1 })).toBeVisible();
        await expect(cashier.locator(".ow-wallet-ready")).toContainText("Noch nicht aktiv");
        await capture(cashier, "owner-readiness-off", viewport.width);
      } finally { await phone.close(); await counter.close(); }
    }
  } finally { await owner.dispose(); }
});
