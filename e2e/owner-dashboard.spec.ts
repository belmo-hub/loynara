import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";

for (const occurredAt of ["1.10.2026, 18:14:46", "13.10.2026, 18:14:46"]) {
  test(`overview preserves the localized activity date ${occurredAt}`, async ({ page }) => {
    await page.route("**/api/me", route => route.fulfill({ json: {
      userId: "synthetic-owner", tenantId: "synthetic-tenant", locationId: "synthetic-location", role: "owner",
      businessName: "Synthetic Date Café", locationName: "Berlin", publicBaseUrl: "http://localhost:3000",
      programSlug: "synthetic-date-cafe", programType: "stamp", rewardTitle: "Kaffee", rewardCost: 5,
      stats: { members: 1, awards: 1, redemptions: 0 },
      activity: [{ id: "synthetic-entry", kind: "award", occurredAt, amount: 1 }],
    } }));
    await page.route("**/api/merchant/locations", route => route.fulfill({ json: { locations: [] } }));
    await page.route("**/api/merchant/audiences/preview?**", route => route.fulfill({ json: { total: 0 } }));
    await page.goto("/merchant");
    await expect(page.getByRole("heading", { name: "Übersicht", level: 1 })).toBeVisible();
    const time = page.locator('[aria-labelledby="ow-act-title"] time');
    await expect(time).toHaveText(occurredAt);
    await expect(time).not.toHaveAttribute("datetime");
  });
}

async function ownerWithProgramme(baseURL: string, businessName: string) {
  const context = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  expect((await context.post("/api/auth/sign-up/email", { data: { name: "Synthetic dashboard owner", email: `dash-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const onboard = await context.post("/api/merchant/onboard", { data: {
    businessName, locationName: "Erster Standort", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Dashboard card", programType: "stamp", rulesText: "Ein Stempel je bestätigtem synthetischem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5,
  } });
  expect(onboard.status()).toBe(201);
  return { context, ...(await onboard.json() as { locationId: string; programSlug: string }) };
}
async function addLocation(context: APIRequestContext, name: string) {
  const response = await context.post("/api/merchant/locations", { data: {
    name, city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: `${name} card`, programType: "stamp",
    earningMode: "manual", pointsPerCurrencyUnit: 1, rulesText: "Ein Stempel je bestätigtem synthetischem Kassenvorgang.", rewardTitle: "Tee", rewardCost: 6,
  } });
  expect(response.status()).toBe(201);
}

test("unsaved card edits are guarded on navigation and location switch, and cancelling keeps them", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await ownerWithProgramme(url, "Synthetic Guard Café");
  try {
    await addLocation(owner.context, "Zweiter Standort");
    const ctx = await browser.newContext({ baseURL: url, storageState: await owner.context.storageState() });
    try {
      const page = await ctx.newPage();
      await page.goto("/merchant/program/card");
      await page.getByLabel("Geschäftsname").fill("Synthetic Guard Neu");
      await expect(page.getByText("Ungespeicherte Änderungen")).toBeVisible();

      await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Übersicht" }).click();
      const dialog = page.getByRole("dialog", { name: "Ungespeicherte Änderungen verwerfen?" });
      await expect(dialog).toBeVisible();
      await page.getByRole("button", { name: "Weiter bearbeiten" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(/\/merchant\/program\/card$/);
      await expect(page.getByLabel("Geschäftsname")).toHaveValue("Synthetic Guard Neu");

      const select = page.locator(".ow-loc select");
      const before = await select.inputValue();
      await select.selectOption({ index: before === (await select.locator("option").first().getAttribute("value")) ? 1 : 0 });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(select).toHaveValue(before);
      await expect(page.getByLabel("Geschäftsname")).toHaveValue("Synthetic Guard Neu");

      // Confirming the location switch discards the edit and shows the other location only.
      await select.selectOption({ index: before === (await select.locator("option").first().getAttribute("value")) ? 1 : 0 });
      await page.getByRole("button", { name: "Änderungen verwerfen" }).click();
      await expect(page.getByLabel("Geschäftsname")).toHaveValue("Synthetic Guard Café");
      await expect(page.getByLabel("Standortname")).not.toHaveValue("Erster Standort");
    } finally { await ctx.close(); }
  } finally { await owner.context.dispose(); }
});

test("browser Back asks before discarding unsaved edits where the Navigation API exists", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await ownerWithProgramme(url, "Synthetic Back Café");
  try {
    const ctx = await browser.newContext({ baseURL: url, storageState: await owner.context.storageState() });
    try {
      const page = await ctx.newPage();
      await page.goto("/merchant");
      await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Treueprogramm" }).click();
      await page.getByRole("navigation", { name: "Treueprogramm – Unterseiten" }).getByRole("link", { name: "Kundenkarte" }).click();
      await expect(page.getByLabel("Geschäftsname")).toBeVisible();
      test.skip(!(await page.evaluate(() => "navigation" in window)), "Navigation API not available in this browser");

      await page.evaluate(() => history.back()); // no unsaved edits: goes straight back
      await expect(page).toHaveURL(/\/merchant\/program$/);
      await page.evaluate(() => history.forward());
      await expect(page.getByLabel("Geschäftsname")).toBeVisible();

      await page.getByLabel("Geschäftsname").fill("Synthetic Back Neu");
      await page.evaluate(() => history.back());
      await expect(page.getByRole("dialog", { name: "Ungespeicherte Änderungen verwerfen?" })).toBeVisible();
      await page.getByRole("button", { name: "Weiter bearbeiten" }).click();
      await expect(page).toHaveURL(/\/merchant\/program\/card$/);
      await expect(page.getByLabel("Geschäftsname")).toHaveValue("Synthetic Back Neu");
      await page.evaluate(() => history.back());
      await page.getByRole("button", { name: "Änderungen verwerfen" }).click();
      await expect(page).toHaveURL(/\/merchant\/program$/);
    } finally { await ctx.close(); }
  } finally { await owner.context.dispose(); }
});

test("a failed save keeps the edit and the next attempt succeeds", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await ownerWithProgramme(url, "Synthetic Failure Café");
  try {
    const ctx = await browser.newContext({ baseURL: url, storageState: await owner.context.storageState() });
    try {
      const page = await ctx.newPage();
      await page.goto("/merchant/program/card");
      await page.getByLabel("Farbwert (Hex)").fill("#2b4a66");
      let fail = true;
      await page.route("**/api/merchant/program/brand", async route => {
        if (route.request().method() === "POST" && fail) { fail = false; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Simulierter Serverfehler." }) }); }
        else await route.continue();
      });
      await page.getByRole("button", { name: "Kundenkarte speichern" }).click();
      await expect(page.locator(".ow-savestate")).toContainText("Speicherstatus unklar"); // a 500 does not prove the write failed
      await expect(page.locator(".ow-savestate")).toContainText("Deine Änderungen sind noch da.");
      await expect(page.getByLabel("Farbwert (Hex)")).toHaveValue("#2b4a66");
      await page.getByRole("button", { name: "Kundenkarte speichern" }).click();
      await expect(page.locator(".ow-savestate")).toContainText("Gespeichert");
      await page.reload();
      await expect(page.getByLabel("Farbwert (Hex)")).toHaveValue(/2b4a66/i);
    } finally { await ctx.close(); }
  } finally { await owner.context.dispose(); }
});

test("overview shows setup for a new merchant and metrics once a stamp was confirmed", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await ownerWithProgramme(url, "Synthetic Overview Café");
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    const ctx = await browser.newContext({ baseURL: url, storageState: await owner.context.storageState() });
    try {
      const page = await ctx.newPage();
      await page.goto("/merchant");
      await expect(page.getByRole("heading", { name: "Dein Treueprogramm einrichten", level: 1 })).toBeVisible();
      // Readiness is derived from saved state: only the programme exists, so the next step is the first card.
      await expect(page.getByText("1 von 3 Pflichtschritten belegt.")).toBeVisible();
      await expect(page.locator(".ow-action--lead")).toContainText("Erste Karte angemeldet");
      await expect(page.getByText("Zugang wiederherstellen")).toHaveCount(0); // operator password reset is not a start step
      await expect(page.getByText("Rechtstexte freigegeben")).toHaveCount(0); // the legal texts are final; no open step for them
      await expect(page.getByText("Karten", { exact: true })).toHaveCount(0); // no wall of zero metrics

      const joined = await guest.post("/api/enroll", { data: { slug: owner.programSlug, acceptedTerms: true, marketingOptIn: false } });
      expect(joined.status()).toBe(201);
      const { cardToken } = await joined.json() as { cardToken: string };
      const { scanCode } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
      const { membershipId } = await (await owner.context.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`)).json() as { membershipId: string };
      expect((await owner.context.post("/api/cashier/award", { data: { membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);

      await page.reload();
      await expect(page.getByRole("heading", { name: "Übersicht", level: 1 })).toBeVisible();
      await expect(page.getByText("Bestätigte Buchungen")).toBeVisible();
      await expect(page.getByText("Kein Umsatz.", { exact: false })).toBeVisible();
      // The confirmed counter award completes the required evidence; the checklist collapses but stays reachable.
      await expect(page.locator("details.ow-readiness summary")).toContainText("Alle 3 Pflichtschritte sind belegt");
    } finally { await ctx.close(); }
  } finally { await Promise.all([owner.context.dispose(), guest.dispose()]); }
});
