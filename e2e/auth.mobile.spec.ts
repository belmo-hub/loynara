import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string };

/** Controls below 44 px; links inside running text are exempt (WCAG 2.5.8 inline exception). */
async function smallControls(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main a[href], main button, main input:not([type=hidden])")]
    .filter((el) => el.offsetParent !== null && !(el.tagName === "A" && el.closest("p")))
    .map((el) => ({ name: (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("name") ?? "").trim().slice(0, 40), h: Math.round(el.getBoundingClientRect().height) }))
    .filter(({ h }) => h < 44));
}

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
    expect(await smallControls(page)).toEqual([]);
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
    expect(await smallControls(page)).toEqual([]);
  });
});

test.describe("sign-up before the page is interactive", () => {
  test("values typed or autofilled before hydration reach the request, and a refusal is explained in German", async ({ page }) => {
    // Hold the page's scripts back so the fields are filled while React has not hydrated yet (a password manager does this).
    await page.route("**/_next/static/chunks/**", async route => { await new Promise(resolve => setTimeout(resolve, 1500)); await route.continue(); });
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/auth/sign-up/email", async route => {
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "FORBIDDEN", message: "Registration is not enabled" }) });
    });
    await page.goto("/register", { waitUntil: "commit" });
    const submit = page.getByRole("button", { name: "Konto erstellen", exact: true });
    await expect(submit).toBeDisabled();
    await page.getByLabel("Dein Name", { exact: true }).fill("Früh Ausgefüllt");
    await page.getByLabel("E-Mail-Adresse", { exact: true }).fill("frueh@example.test");
    await page.getByLabel("Passwort", { exact: true }).fill("Langes-Passwort-123");
    await page.getByLabel("Passwort wiederholen", { exact: true }).fill("Langes-Passwort-123");
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await submit.click();
    await expect.poll(() => sent).toMatchObject({ name: "Früh Ausgefüllt", email: "frueh@example.test", password: "Langes-Passwort-123" });
    await expect(page.locator(".auth-form").getByRole("alert")).toContainText("Registrierung ist noch nicht freigeschaltet");
    await expect(page.locator(".auth-form").getByRole("alert")).not.toContainText("Registration");
    await expect(page.getByLabel("E-Mail-Adresse", { exact: true })).toHaveValue("frueh@example.test");
  });
});
