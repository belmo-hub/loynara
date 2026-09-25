import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cardToken: string };

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
