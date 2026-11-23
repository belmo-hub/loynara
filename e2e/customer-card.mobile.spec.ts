import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { smallTargets } from "./support/targets";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cardToken: string };

test.describe("guest card on phones", () => {
  test("shows goal, balance and a scannable code on the first screen", async ({ page }) => {
    await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
    await expect(page.locator(".customer-card [aria-label*=\" von \"]")).toBeVisible();
    const qr = page.locator(".customer-qr img");
    await expect(qr).toBeVisible();
    const box = await qr.boundingBox();
    const viewport = page.viewportSize()!;
    // 120 px beside the number from 360 up (Design, 18 Nov: the ticket's line keeps two lines), 128 alone below 360.
    expect(box!.width).toBeGreaterThanOrEqual(viewport.width < 360 ? 128 : 120);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  // Web audit finding 1, option C (CTO, 22 Nov): the QR, the page's largest element, is named in the first HTML as a
  // high-priority preload, so it is already loaded when the card's read lands; the placeholder is unchanged.
  test("loads the QR from the first HTML and draws it with the card, from memory", async ({ page, request }) => {
    const html = await (await request.get(`/card/${encodeURIComponent(demo.cardToken)}`)).text();
    const link = /<link[^>]*rel="preload"[^>]*>/g;
    const preloads = (html.match(link) ?? []).filter(tag => tag.includes("/api/qr?value=sc_"));
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toMatch(/as="image"/);
    expect(preloads[0]).toMatch(/fetchpriority="high"/i);
    expect(await (await request.get("/card/card__unknownunknownunknownunknownunknown12")).text()).not.toContain("/api/qr");
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const qrLoads: string[] = [];
    page.on("request", r => { if (r.url().includes("/api/qr?value=sc_")) qrLoads.push(r.url()); });
    await page.route("**/api/enroll/card/**", async route => { await held; await route.continue(); });
    await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
    // The image is fetched while the read is still out, and the placeholder stays the placeholder.
    await expect.poll(() => qrLoads.length).toBe(1);
    expect(await page.locator(".customer-card").count()).toBe(0);
    release();
    await expect(page.locator(".customer-card [aria-label*=\" von \"]")).toBeVisible();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const qr = page.locator(".customer-qr img");
    await expect.poll(() => qr.evaluate(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);
    expect(new URL(qrLoads[0]).pathname + new URL(qrLoads[0]).search).toBe(await qr.getAttribute("src"));
  });

  test("keeps every control at least 44 × 44 px", async ({ page }) => {
    await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
    await expect(page.locator(".customer-card")).toBeVisible();
    expect(await smallTargets(page, { scope: "main" })).toEqual([]);
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
