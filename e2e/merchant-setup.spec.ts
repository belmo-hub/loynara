import { expect, test } from "@playwright/test";

test("guided setup walks four steps, validates inline and previews the card before anything is saved", async ({ page }) => {
  let onboardCalls = 0;
  await page.route("**/api/me", route => route.fulfill({ json: { userId: "synthetic-owner", tenantId: null, publicBaseUrl: "http://localhost:3000" } }));
  await page.route("**/api/merchant/onboard", route => { onboardCalls++; return route.abort(); });
  await page.goto("/merchant/program");
  await expect(page.getByRole("heading", { name: "Dein Treueprogramm einrichten", level: 1 })).toBeVisible();

  // Step 1: required fields are validated inline and focus moves to the first problem.
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(page.getByText("Bitte den Geschäftsnamen eingeben.")).toBeVisible();
  await expect(page.getByLabel("Geschäftsname")).toBeFocused();
  await page.getByLabel("Geschäftsname").fill("Synthetisches Café");
  await page.getByLabel("Standort", { exact: true }).fill("Kassel Mitte");
  await page.getByLabel("Stadt").fill("Kassel");
  await expect(page.locator(".ow-cardprev-face")).toContainText("Synthetisches Café");
  await page.getByRole("button", { name: "Café", exact: true }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();

  // Step 2: earning sentence and who confirms are separate; an editable rule text is proposed.
  await expect(page.getByRole("heading", { name: "Wie sammeln Kunden?" })).toBeVisible();
  await expect(page.getByText("Wer bestätigt?")).toBeVisible();
  await expect(page.getByLabel("Regeltext für Kunden")).toHaveValue(/Stempel/);
  await page.getByRole("button", { name: "Weiter", exact: true }).click();

  // Step 3: preset values are only examples and stay editable; the cost is never silently zero.
  await expect(page.getByLabel("Name der Prämie")).toHaveValue("Kaffee aufs Haus");
  await page.getByLabel("Preis in Stempeln").fill("");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(page.getByText("Bitte eine ganze Zahl größer 0 eingeben.")).toBeVisible();
  await page.getByLabel("Preis in Stempeln").fill("8");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();

  // Step 4: review shows rule, confirmation, threshold and card; nothing was sent yet.
  await expect(page.getByRole("heading", { name: "Zusammenfassung" })).toBeVisible();
  await expect(page.getByText("8 Stempel → Kaffee aufs Haus")).toBeVisible();
  expect(onboardCalls).toBe(0);
});
