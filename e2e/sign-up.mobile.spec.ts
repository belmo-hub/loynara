import { expect, test } from "@playwright/test";

// The open registration and the invitation share this form logic (uncontrolled fields, hydration gate, mapped errors).
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
