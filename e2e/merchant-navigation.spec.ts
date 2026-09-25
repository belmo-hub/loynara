import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

test("owner can open customer activity from the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.ownerEmail);
  await page.getByLabel("Passwort").fill(access.ownerPassword);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("/merchant");
  await page.getByRole("link", { name: "Kundenkarten", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/customers$/);
  await expect(page.getByRole("heading", { name: "Kundenkarten" })).toBeVisible();
});
