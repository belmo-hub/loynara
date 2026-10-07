import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CustomerCardView } from "./loyalty-ui";

let browser: Browser;
const css = readFileSync(resolve("src/app/globals.css"), "utf8");
beforeAll(async () => { browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL }); });
afterAll(async () => { await browser?.close(); });

describe("official Wallet badge layout", () => {
  it.each([
    ["de", 320], ["fr", 320], ["de", 390], ["fr", 768],
  ] as const)("keeps %s badges readable with clear space at %ipx", async (locale, width) => {
    const page = await browser.newPage({ viewport: { width, height: 1200 } });
    try {
      // An inert SSR fixture exercises the real component and stylesheet without
      // a server, credentials, provider calls, or a production browser session.
      await page.route("**/*", route => route.abort());
      let html = renderToStaticMarkup(createElement(CustomerCardView, {
        businessName: "Example shop", locationName: "Counter", programType: "stamps", balance: 1,
        locale, onAppleWallet: () => {}, onGoogleWallet: () => {}, walletBusy: "apple",
      }));
      html = html.replace(/src="(\/wallet\/[^\"]+\.svg)"/g, (_match, path: string) => `src="data:image/svg+xml;base64,${readFileSync(resolve(`public${path}`)).toString("base64")}"`);
      await page.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`);
      const images = page.locator(".wallet-add img");
      await images.first().evaluate((image: HTMLImageElement) => image.decode());
      await images.last().evaluate((image: HTMLImageElement) => image.decode());
      const geometry = await images.evaluateAll(nodes => nodes.map(node => {
        const image = node as HTMLImageElement;
        const rect = image.getBoundingClientRect();
        const button = image.parentElement!;
        const bounds = button.getBoundingClientRect();
        return { height: rect.height, width: rect.width, ratio: image.naturalWidth / image.naturalHeight,
          clearSpace: Math.min(rect.left - bounds.left, bounds.right - rect.right, rect.top - bounds.top, bounds.bottom - rect.bottom),
          opacity: getComputedStyle(button).opacity, disabled: (button as HTMLButtonElement).disabled };
      }));
      expect(geometry).toHaveLength(2);
      for (const image of geometry) {
        expect(image.height).toBeGreaterThanOrEqual(48);
        expect(image.width / image.height).toBeCloseTo(image.ratio, 1);
        expect(image.clearSpace).toBeGreaterThanOrEqual(7.9);
        expect(image.opacity).toBe("1");
        expect(image.disabled).toBe(true);
      }
      expect(geometry[0].height).toBe(geometry[1].height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await page.close(); }
  });
});
