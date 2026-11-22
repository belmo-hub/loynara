import { expect, test } from "@playwright/test";
import { counterSignHtml } from "../src/lib/counter-sign";

// ENG-343 (Design, 22 Nov): in WebKit the QR svg overflowed its frame by 31 px and covered the border and quiet zone. The
// sign now opens in Safari on every iPhone, so the svg must sit inside .qr, on screen and at A5 print width. Needs the
// WebKit project (mobile-iphone-14), which CI's runner image lacks: a local-run check.
const sign = counterSignHtml({
  businessName: "Synthetic Café", locationName: "Synthetic Mitte", joinUrl: "http://localhost:3000/join/synthetic-cafe",
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320"><rect width="320" height="320" fill="#fff"/><rect x="40" y="40" width="240" height="240"/></svg>',
  programType: "stamp", rewardTitle: "Kaffee", rewardCost: 8,
});

for (const [label, width, media] of [["phone", 390, "screen"], ["A5 print", 560, "print"]] as const) test(`the QR stays inside its frame (${label})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ media });
  await page.setContent(sign);
  const frame = (await page.locator(".qr").boundingBox())!, svg = (await page.locator(".qr svg").boundingBox())!;
  expect(svg.y).toBeGreaterThanOrEqual(frame.y);
  expect(svg.x).toBeGreaterThanOrEqual(frame.x);
  expect(svg.y + svg.height).toBeLessThanOrEqual(frame.y + frame.height);
  expect(svg.x + svg.width).toBeLessThanOrEqual(frame.x + frame.width);
  expect(Math.abs(svg.width - svg.height)).toBeLessThan(1);
});
