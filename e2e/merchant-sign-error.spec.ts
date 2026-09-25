import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

test("failed sign download leaves the merchant dashboard usable and can be retried", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.ownerEmail);
  await page.getByLabel("Passwort").fill(access.ownerPassword);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("/merchant");
  await expect(page.getByRole("heading", { name: /Übersicht|Willkommen|Guten/ })).toBeVisible();

  let failNext = true;
  await page.route("**/api/qr?*", async route => {
    if (failNext) {
      failNext = false;
      await route.fulfill({ status: 503, body: "QR unavailable" });
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Anmeldeschild laden" }).click();
  await expect(page.locator(".sign-download-error")).toContainText("QR-Code konnte nicht geladen werden");
  await expect(page.getByRole("button", { name: "Anmeldeschild laden" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Anmeldeschild laden" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("anmeldeschild.html");
  await expect(page.locator(".sign-download-error")).toHaveCount(0);
});
