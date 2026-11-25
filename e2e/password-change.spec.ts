import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";
import { signUp } from "./support/sign-up";

// ENG-379: Mehr → Konto → „Passwort ändern“ on a 390 px phone. A second signed-in API context stands in for another device.
test("an owner changes the password under Konto; this phone stays signed in, the other device is signed out", async ({ page, baseURL }) => {
  const url = new URL(baseURL ?? "http://localhost:3000");
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Requires the synthetic local app");
  const email = `password-${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`, next = `Neu!${randomUUID()}Bb`;
  const other = await apiRequest.newContext({ baseURL: url.origin, extraHTTPHeaders: { Origin: url.origin } });
  expect((await signUp(other, { data: { name: "Synthetic password owner", email, password } })).status()).toBe(200);
  expect((await other.post("/api/merchant/onboard", { data: { businessName: "Synthetic Passwort Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Passwort card", programType: "stamp", rulesText: "Synthetic local test only.", rewardTitle: "Kaffee", rewardCost: 5 } })).status()).toBe(201);
  expect((await other.get("/api/me")).status()).toBe(200);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant/);
  await page.goto("/merchant/more");
  await page.getByRole("link", { name: /Passwort ändern/ }).click();
  await expect(page).toHaveURL(/\/merchant\/more\/passwort$/);
  await expect(page.getByRole("heading", { level: 1, name: "Passwort ändern" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Auf anderen Geräten abmelden" })).toBeChecked();

  // 390 px: nothing wider than the screen, every control at least 44 px tall.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const control of [page.getByLabel("Aktuelles Passwort"), page.getByLabel("Neues Passwort"), page.locator("label.ow-check"), page.getByRole("button", { name: "Passwort speichern" })]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  const save = page.getByRole("button", { name: "Passwort speichern" });
  await save.click();
  await expect(page.getByText("Gib dein aktuelles Passwort ein.")).toBeVisible();
  await expect(page.getByLabel("Aktuelles Passwort")).toBeFocused();

  await page.getByLabel("Aktuelles Passwort").fill(password);
  await page.getByLabel("Neues Passwort").fill("zu-kurz");
  await save.click();
  await expect(page.getByText("Das Passwort ist zu kurz. Es braucht mindestens 12 Zeichen.")).toBeVisible();

  await page.getByLabel("Aktuelles Passwort").fill("nicht-das-aktuelle-passwort");
  await page.getByLabel("Neues Passwort").fill(next);
  await save.click();
  await expect(page.getByText("Das aktuelle Passwort stimmt nicht.")).toBeVisible();
  await expect(page.getByLabel("Aktuelles Passwort")).toBeFocused();

  await page.getByLabel("Aktuelles Passwort").fill(password);
  await save.click();
  await expect(page).toHaveURL(/\/merchant\/more$/);
  await expect(page.locator(".ow-prog-outcome")).toHaveText("Dein Passwort ist geändert. Auf deinen anderen Geräten bist du abgemeldet.");

  expect((await other.get("/api/me")).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Konto" })).toBeVisible();
  await other.dispose();
});
