import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cardToken: string; ownerEmail: string; ownerPassword: string };

for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }]) {
  test(`card checkout essentials fit ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
    await expect(page.locator(".customer-card-business strong")).toBeVisible();
    await expect(page.locator(".customer-balance-line strong")).toBeVisible();
    const qr = page.locator(".customer-qr img");
    await expect(qr).toBeVisible();
    await expect.poll(() => qr.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const qrBox = await qr.boundingBox();
    const merchantBox = await page.locator(".customer-card-business strong").boundingBox();
    const balanceBox = await page.locator(".customer-balance-line strong").boundingBox();
    expect(qrBox).not.toBeNull();
    expect(merchantBox).not.toBeNull();
    expect(balanceBox).not.toBeNull();
    expect(qrBox!.width).toBeGreaterThanOrEqual(188);
    expect(qrBox!.height).toBeGreaterThanOrEqual(188);
    expect(qrBox!.y).toBeGreaterThan(0);
    expect(qrBox!.y + qrBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(merchantBox!.y + merchantBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(balanceBox!.y + balanceBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; document.body.style.zoom = "1.5"; window.scrollTo(0, document.documentElement.scrollHeight); });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
}

test("card foregrounds the merchant, states the remaining stamps, and can be reopened from a copied link", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const response = await page.request.get(`/api/card/${encodeURIComponent(demo.cardToken)}`);
  expect(response.ok()).toBe(true);
  const card = await response.json() as { merchantName: string; balance: number; rewards: { title: string; cost: number }[] };
  const reward = card.rewards[0];
  await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
  await expect(page.locator(".customer-header-merchant")).toHaveText(card.merchantName);
  await expect(page.locator(".customer-card-business strong")).toHaveText(card.merchantName);
  await expect(page.getByRole("link", { name: "Apple Wallet" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Google Wallet" })).toHaveCount(0);
  if (reward && card.balance < reward.cost) {
    await expect(page.locator(".reward-remaining")).toContainText(`Noch ${reward.cost - card.balance} Stempel für „${reward.title}“`);
  }
  await expect(page.locator(".customer-wallet")).toContainText("Nach einer Berechtigungsprüfung");
  await expect(page.locator(".customer-wallet")).not.toContainText("nicht wiederherstellbar");
  await page.getByRole("button", { name: "Kartenlink kopieren" }).click();
  await expect(page.getByRole("status")).toContainText("Kartenlink kopiert");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).pathname).toBe(`/card/${demo.cardToken}`);
  expect(new URL(copied).search).toBe("");
  const reopened = await context.newPage();
  await reopened.goto(copied);
  await expect(reopened.locator(".customer-card-business strong")).toHaveText(card.merchantName);
  await expect(reopened.locator(".customer-balance-line strong")).toContainText(String(card.balance));
  await reopened.close();
});

test("long merchant and location names remain readable without horizontal overflow", async ({ page }) => {
  const token = encodeURIComponent(demo.cardToken);
  const response = await page.request.get(`/api/card/${token}`);
  expect(response.ok()).toBe(true);
  const card = await response.json() as Record<string, unknown>;
  const merchantName = "Lange Geschäftsbezeichnung mit mehreren Wörtern für eine Filiale im Viertel am Hauptbahnhof";
  const locationName = "W".repeat(120);
  await page.route(`**/api/card/${token}`, route => route.fulfill({ json: { ...card, merchantName, locationName } }));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/card/${token}`);
  const heading = page.locator(".customer-header-merchant");
  await expect(heading).toHaveText(merchantName);
  await expect(page.locator(".customer-card-business span")).toHaveText(locationName);
  const headerBox = await page.locator(".customer-header").boundingBox();
  const headingBox = await heading.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(headingBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
  expect(headingBox!.y + headingBox!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const qr = page.locator(".customer-qr img");
  await expect(qr).toBeVisible();
  await expect.poll(() => qr.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

// Run separately against the compiled local app with public registration off and invite signup on.
test("invite-only signup stays inside narrow viewports and enters the invited cashier scope", async ({ baseURL, browser }, testInfo) => {
  test.skip(process.env.E2E_INVITE_SIGNUP !== "true", "Requires the guarded local invite-only server configuration");
  const url = baseURL ?? "http://localhost:3000";
  expect(["localhost", "127.0.0.1"]).toContain(new URL(url).hostname);
  const api = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    expect((await api.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword } })).status()).toBe(200);
    const owner = await (await api.get("/api/me")).json() as { tenantId: string; locationId: string };
    const email = `invite-review-${randomUUID()}@example.test`;
    const invited = await api.post("/api/staff/invite", { data: { email, locationId: owner.locationId, role: "cashier" } });
    expect(invited.status()).toBe(201);
    const { token } = await invited.json() as { token: string };
    expect((await guest.post("/api/auth/sign-up/email", { data: { name: "Synthetic public probe", email: `closed-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(403);
    for (const [width, height] of [[1440, 900], [1280, 800], [768, 1024], [390, 844], [320, 568]]) {
      const context = await browser.newContext({ baseURL: url, viewport: { width, height } });
      try {
        const page = await context.newPage();
        await page.goto(`/invite/${token}`);
        await expect(page.getByLabel("Dein Name")).toBeVisible();
        await expect(page.getByLabel("E-Mail-Adresse")).toHaveValue(email);
        await page.screenshot({ path: testInfo.outputPath(`invite-${width}.png`), fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const form = page.locator(".invite-card .auth-form");
        expect(await form.evaluate(element => [...element.querySelectorAll("input, button")].every(control => {
          const box = control.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth;
        }))).toBe(true);
        if (width === 320) {
          await page.getByLabel("Dein Name").fill("Synthetic Invited Cashier");
          const password = `Local!${randomUUID()}Aa`;
          await page.getByLabel("Passwort", { exact: true }).fill(password);
          await page.getByLabel("Passwort wiederholen").fill(password);
          await page.getByRole("button", { name: "Konto erstellen und Einladung annehmen" }).click();
          await expect(page.getByText("Willkommen im Team.")).toBeVisible();
          await page.getByRole("link", { name: /Zur Kasse/ }).click();
          await expect(page.getByRole("heading", { name: /Karte scannen/ })).toBeVisible();
          const staff = await (await context.request.get("/api/me")).json() as { role: string; tenantId: string; locationId: string };
          expect(staff).toMatchObject({ role: "cashier", tenantId: owner.tenantId, locationId: owner.locationId });
        }
      } finally { await context.close(); }
    }
  } finally { await api.dispose(); await guest.dispose(); }
});
