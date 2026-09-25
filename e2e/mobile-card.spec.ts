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
