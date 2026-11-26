import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

test("merchant opens a printable sign with its own identity and join QR", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.ownerEmail);
  await page.getByLabel("Passwort").fill(access.ownerPassword);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page.waitForURL("/merchant");
  const response = await page.request.get("/api/me");
  expect(response.ok()).toBe(true);
  const merchant = await response.json() as { businessName: string; programSlug: string; publicBaseUrl: string };
  await page.goto("/merchant/customers"); // the Tresenschild lives under Kunden since ENG-122a
  // ENG-343: the sign opens in a new tab with a print button, and the tapped row confirms it.
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Tresenschild laden" }).click();
  const sign = await opened;
  await expect(page.getByRole("button", { name: /Tresenschild laden/ })).toContainText("Tresenschild geöffnet");
  await expect(sign.getByRole("button", { name: "Drucken", exact: true })).toBeVisible();
  const html = await sign.content();
  expect(html).toContain(`<h1>${merchant.businessName}</h1>`);
  expect(html).toContain(new URL(`/join/${merchant.programSlug}`, merchant.publicBaseUrl).href);
  expect(html).toContain("<svg");
  expect(html).toContain("Mit Loynara");
  expect(html).toContain("LOKALE TESTVORSCHAU");
  await sign.setViewportSize({ width: 560, height: 830 });
  await expect(sign.getByRole("heading", { name: merchant.businessName })).toBeVisible();
  const qrBox = await sign.locator(".qr svg").boundingBox();
  expect(qrBox).not.toBeNull();
  expect(qrBox!.width).toBeGreaterThanOrEqual(250);
  expect(qrBox!.height).toBeGreaterThanOrEqual(250);
  await sign.close();
});
