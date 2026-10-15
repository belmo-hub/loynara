import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cardToken: string };

test.describe("guest card on phones", () => {
  test("shows goal, balance and a scannable code on the first screen", async ({ page }) => {
    await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
    await expect(page.locator(".customer-balance-line strong")).toBeVisible();
    const qr = page.locator(".customer-qr img");
    await expect(qr).toBeVisible();
    const box = await qr.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.width).toBeGreaterThanOrEqual(188);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test("keeps every control at least 44 px tall", async ({ page }) => {
    await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
    await expect(page.locator(".customer-card")).toBeVisible();
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main a[href], main button, main input:not([type=hidden])")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40), h: el.getBoundingClientRect().height }))
      .filter(({ h }) => h < 44));
    expect(small).toEqual([]);
  });

  test.describe("dark appearance", () => {
    test.use({ colorScheme: "dark" });
    test("follows the system setting and keeps the code on white", async ({ page }) => {
      await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
      await expect(page.locator(".customer-qr img")).toBeVisible();
      expect(await page.locator(".ly-theme-auto", { has: page.locator("main") }).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(15, 23, 19)");
      expect(await page.locator(".customer-qr-panel").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    });
  });
});
