import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("identity-only account completes the wizard and safely retries the completed onboarding", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const account = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    expect((await account.post("/api/auth/sign-up/email", { data: { name: "Synthetic bridge owner", email: `bridge-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    expect(await (await account.get("/api/me")).json()).toMatchObject({ tenantId: null });
    const context = await browser.newContext({ baseURL: url, storageState: await account.storageState() });
    try {
      const page = await context.newPage();
      await page.goto("/merchant");
      await expect(page).toHaveURL(/\/merchant\/program$/);
      await page.getByLabel("Geschäftsname").fill("Synthetic Bridge Café");
      await page.getByLabel("Standort", { exact: true }).fill("Mitte");
      await page.getByLabel("Stadt").fill("Kassel");
      await page.getByRole("button", { name: "Café", exact: true }).click();
      for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Weiter", exact: true }).click();
      const sent = page.waitForResponse(response => response.url().endsWith("/api/merchant/onboard") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Programm starten", exact: true }).click();
      const first = await sent;
      expect(first.status()).toBe(201);
      const payload = first.request().postDataJSON();
      const merchant = await first.json();
      await expect(page).toHaveURL(/\/merchant$/);
      const retry = await account.post("/api/merchant/onboard", { data: payload });
      expect(retry.status()).toBe(201);
      expect(await retry.json()).toEqual(merchant);
      await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();
    } finally { await context.close(); }
  } finally { await account.dispose(); }
});

for (const state of [
  { name: "tenant without location", role: "owner" },
  { name: "owner without programme", role: "owner", locationId: "synthetic-location" },
  { name: "manager without programme", role: "manager", locationId: "synthetic-location" },
]) test(`${state.name} shows a setup error instead of the wizard`, async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: { userId: "synthetic-user", tenantId: "synthetic-tenant", ...state } }));
  await page.route("**/api/merchant/locations", route => route.fulfill({ json: { locations: [] } }));
  await page.goto("/merchant/program");
  await expect(page.locator(".owner-app").getByRole("alert")).toContainText("Einrichtung");
  await expect(page.locator(".owner-app").getByRole("alert")).toContainText("Support");
  await expect(page.getByLabel("Geschäftsname")).toHaveCount(0);
});

test("missing account context is not mistaken for permission to start setup", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 404, json: { code: "NOT_FOUND", error: "Standort nicht gefunden." } }));
  await page.goto("/merchant/program");
  await expect(page.locator(".owner-app").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Geschäftsname")).toHaveCount(0);
});

test("revoked staff see the access error without the setup wizard", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 403, json: { code: "FORBIDDEN", error: "Dein Zugang wurde entzogen. Bitte wende dich an die Inhaberin oder den Inhaber." } }));
  await page.goto("/merchant/program");
  await expect(page.locator(".owner-app").getByRole("alert")).toContainText("Dein Zugang wurde entzogen.");
  await expect(page.getByLabel("Geschäftsname")).toHaveCount(0);
});
