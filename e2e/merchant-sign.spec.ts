import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

test("merchant downloads a printable sign with its own identity and join QR", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.ownerEmail);
  await page.getByLabel("Passwort").fill(access.ownerPassword);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("/merchant");
  const response = await page.request.get("/api/me");
  expect(response.ok()).toBe(true);
  const merchant = await response.json() as { businessName: string; programSlug: string; publicBaseUrl: string };
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tresenschild laden" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("anmeldeschild.html");
  const html = readFileSync(await download.path(), "utf8");
  expect(html).toContain(`<h1>${merchant.businessName}</h1>`);
  expect(html).toContain(new URL(`/join/${merchant.programSlug}`, merchant.publicBaseUrl).href);
  expect(html).toContain("<svg");
  expect(html).toContain("Mit Loynara");
  expect(html).toContain("LOKALE TESTVORSCHAU");
  const sign = await page.context().newPage();
  await sign.setViewportSize({ width: 560, height: 830 });
  await sign.setContent(html);
  await expect(sign.getByRole("heading", { name: merchant.businessName })).toBeVisible();
  const qrBox = await sign.locator(".qr svg").boundingBox();
  expect(qrBox).not.toBeNull();
  expect(qrBox!.width).toBeGreaterThanOrEqual(250);
  expect(qrBox!.height).toBeGreaterThanOrEqual(250);
  await sign.close();
});
