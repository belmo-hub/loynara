import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { smallTargets } from "./support/targets";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string };

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("sign-in on phones", () => {
  test("the form is ready for password managers and the phone keyboard", async ({ page }) => {
    await page.goto("/login");
    const email = page.getByLabel("E-Mail-Adresse", { exact: true }), password = page.getByLabel("Passwort", { exact: true });
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "username");
    await expect(email).toHaveAttribute("inputmode", "email");
    await expect(email).toHaveAttribute("autocapitalize", "none");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    // Below 16 px iOS zooms the page when a field gets focus.
    for (const field of [email, password]) expect(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await expect(page.getByRole("button", { name: "Anmelden", exact: true })).toBeEnabled();
    expect(await sideways(page)).toBe(0);
    expect(await smallTargets(page, { scope: "main" })).toEqual([]);
  });

  test("a wrong password keeps the address, explains the problem inside the form and returns to the password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(demo.ownerEmail);
    await page.getByLabel("Passwort", { exact: true }).fill("Falsches-Passwort-123");
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(page.locator('.auth-form [role="alert"]')).toContainText("E-Mail-Adresse oder Passwort");
    await expect(page.getByLabel("E-Mail-Adresse", { exact: true })).toHaveValue(demo.ownerEmail);
    await expect(page.getByLabel("Passwort", { exact: true })).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);
    expect(await sideways(page)).toBe(0);
  });

  test("the forgotten-password link opens a prepared mail and sends nothing from the page", async ({ page }) => {
    await page.goto("/login");
    const link = page.getByRole("link", { name: "Passwort vergessen?" });
    await expect(link).toHaveAttribute("href", /^mailto:support@getloynara\.com\?subject=/);
  });

  test("an invitation link without a preview still fits and offers one clear step", async ({ page }) => {
    await page.goto("/invite/not-a-real-invitation-token");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Einladung annehmen", exact: true })).toBeVisible();
    expect(await sideways(page)).toBe(0);
    expect(await smallTargets(page, { scope: "main" })).toEqual([]);
  });
});

test.describe("legal and system pages on phones", () => {
  for (const [path, heading] of [["/datenschutz", /Datenschutz/], ["/teilnahmebedingungen", /Teilnahmebedingungen/], ["/gibt-es-nicht", "Diese Seite gibt es nicht."]] as const) {
    test(`${path} fits, and every link outside a sentence is a 44 px target`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      expect(await sideways(page)).toBe(0);
      expect(await smallTargets(page)).toEqual([]);
    });
  }
});
