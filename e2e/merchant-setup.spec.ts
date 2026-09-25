import { expect, test } from "@playwright/test";

test("assisted setup transcribes a paper stamp rule before advanced settings", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.goto("/merchant/program");
  await expect(page.getByRole("heading", { name: "Deine bestehende Stempelkarte, digital." })).toBeVisible();
  const advanced = page.locator(".setup-advanced");
  await expect(advanced).toHaveJSProperty("open", false);
  await expect(page.getByLabel("Stadt")).toHaveValue("");
  await expect(page.getByLabel("Benötigte Stempel für diese Prämie")).toHaveValue("");
  await expect(page.getByLabel("Kontakt-E-Mail")).toBeHidden();
  expect(await page.locator(".setup-form :is(input, textarea):required:visible").count()).toBe(6);

  await page.getByLabel("Geschäftsname").fill("Synthetisches Café");
  await page.getByLabel("Standort", { exact: true }).fill("Kassel Mitte");
  await page.getByLabel("Stadt").fill("Kassel");
  await page.getByLabel("Prämie auf der Papierkarte").fill("Kaffee gratis");
  await page.getByLabel("Benötigte Stempel für diese Prämie").fill("8");
  await page.getByLabel("Wann gibt es Stempel?").fill("Ein Stempel pro Kaffee, nach Bezahlung.");
  await expect(page.locator(".setup-rule-summary")).toContainText("8 Stempel → Kaffee gratis");
  await expect(page.locator(".preview-card")).toContainText("Synthetisches Café");
  await expect(advanced).toHaveJSProperty("open", false);
});
