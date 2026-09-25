import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import QRCode from "qrcode";
import { counterSignHtml } from "../src/lib/counter-sign";

test("synthetic counter sign leads with the merchant and preserves its complete QR", async ({ page }) => {
  await page.goto(pathToFileURL(resolve("demo/counter-sign.html")).href);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Demo Kaffeebar Kassel");
  const qr = page.locator(".qr svg");
  await expect(qr).toBeVisible();
  const qrBox = await qr.boundingBox();
  const attributionBox = await page.locator(".attribution").boundingBox();
  expect(qrBox).not.toBeNull();
  expect(attributionBox).not.toBeNull();
  expect(qrBox!.width).toBeGreaterThanOrEqual(250);
  expect(qrBox!.height).toBeGreaterThanOrEqual(250);
  expect(attributionBox!.y).toBeGreaterThan(qrBox!.y + qrBox!.height);
});

test("maximum accepted merchant details and join link remain complete on one A5 print page", async ({ page }) => {
  const businessName = "W".repeat(180);
  const locationName = "L".repeat(180);
  const rewardTitle = "R".repeat(180);
  const joinUrl = `https://device-test.example.com/join/${"s".repeat(120)}`;
  const qrSvg = await QRCode.toString(joinUrl, { type: "svg", margin: 1, width: 320, errorCorrectionLevel: "M" });
  await page.setViewportSize({ width: 560, height: 795 });
  await page.setContent(counterSignHtml({ businessName, locationName, joinUrl, qrSvg, programType: "stamp", rewardTitle, rewardCost: 8 }));
  await page.emulateMedia({ media: "print" });

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(businessName);
  await expect(page.locator(".location")).toHaveText(locationName);
  await expect(page.locator(".reward")).toContainText(rewardTitle);
  await expect(page.locator(".join-url")).toHaveText(joinUrl);
  const positions = await page.evaluate(() => {
    const sheet = document.querySelector(".sheet")!.getBoundingClientRect();
    return {
      sheet: { width: sheet.width, height: sheet.height },
      scrollWidth: document.documentElement.scrollWidth,
      content: ["h1", ".location", ".qr svg", ".instruction", ".reward", ".join-url", ".note", ".attribution"]
        .map(selector => {
          const box = document.querySelector(selector)!.getBoundingClientRect();
          return { selector, left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
        }),
    };
  });
  expect(positions.sheet.height).toBeLessThanOrEqual(795);
  expect(positions.scrollWidth).toBeLessThanOrEqual(560);
  for (const box of positions.content) {
    expect(box.left, box.selector).toBeGreaterThanOrEqual(0);
    expect(box.right, box.selector).toBeLessThanOrEqual(positions.sheet.width + 1);
    expect(box.top, box.selector).toBeGreaterThanOrEqual(0);
    expect(box.bottom, box.selector).toBeLessThanOrEqual(positions.sheet.height - 3);
    if (box.selector === ".qr svg") expect(box.width).toBeGreaterThanOrEqual(250);
  }

  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pdfText = pdf.toString("latin1");
  expect((pdfText.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  const mediaBox = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdfText);
  expect(mediaBox).not.toBeNull();
  expect(Number(mediaBox![3]) - Number(mediaBox![1])).toBeCloseTo(420, 0);
  expect(Number(mediaBox![4]) - Number(mediaBox![2])).toBeCloseTo(595, 0);
});
