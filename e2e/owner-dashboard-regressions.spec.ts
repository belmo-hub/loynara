import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

async function owner(baseURL: string) {
  const api = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  expect((await api.post("/api/auth/sign-up/email", { data: { name: "Synthetic review owner", email: `review-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = { businessName: "Synthetic Review Café", locationName: "Erster Standort", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Ein Stempel je bestätigtem synthetischem Besuch.", rewardTitle: "Kaffee", rewardCost: 8 };
  const response = await api.post("/api/merchant/onboard", { data: setup });
  expect(response.status()).toBe(201);
  const { city, country, timezone, programName, programType, rulesText, rewardTitle, rewardCost } = setup;
  const locationInput = { name: "Zweiter Standort", city, country, timezone, programName, programType, rulesText, rewardTitle, rewardCost };
  return { api, locationInput, ...(await response.json() as { programSlug: string }) };
}

test("failed context refresh after location selection shows an error and retry recovers", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const f = await owner(url);
  try {
    expect((await f.api.post("/api/merchant/locations", { data: f.locationInput })).status()).toBe(201);
    const context = await browser.newContext({ baseURL: url, storageState: await f.api.storageState() });
    try {
      const page = await context.newPage();
      await page.goto("/merchant/program/card");
      await expect(page.getByLabel("Standortname")).toHaveValue("Erster Standort");
      let fail = true;
      await page.route("**/api/me", async route => {
        if (fail) { fail = false; await route.fulfill({ status: 503, json: { error: "Standort konnte vorübergehend nicht geladen werden." } }); }
        else await route.continue();
      });
      await page.locator(".ow-loc select").selectOption({ label: "Zweiter Standort" });
      await expect(page.locator(".owner-app").getByRole("alert")).toContainText("Standort konnte vorübergehend nicht geladen werden.");
      await expect(page.getByLabel("Standortname")).toHaveCount(0);
      await expect(page.locator(".ow-sr[role=status]")).not.toContainText("Standort gewechselt.");
      await page.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
      await expect(page.getByLabel("Standortname")).toHaveValue("Zweiter Standort");
    } finally { await context.close(); }
  } finally { await f.api.dispose(); }
});

for (const flow of [
  { name: "rules to card studio", path: "/merchant/program", field: "Programmname", link: "Kundenkarte gestalten", target: "/merchant/program/card", editRules: true },
  { name: "card studio to rules", path: "/merchant/program/card", field: "Geschäftsname", link: "Sammelregeln & Prämien", target: "/merchant/program" },
  { name: "location draft to programme", path: "/merchant/locations", field: "Standortname", link: "Programm ansehen", target: "/merchant/program" },
]) test(`page link guards unsaved edits: ${flow.name}`, async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const f = await owner(url);
  try {
    const context = await browser.newContext({ baseURL: url, storageState: await f.api.storageState() });
    try {
      const page = await context.newPage();
      await page.goto(flow.path);
      if (flow.editRules) await page.getByRole("button", { name: "Regel ändern", exact: true }).click();
      await page.getByLabel(flow.field, { exact: true }).fill("Synthetischer ungespeicherter Entwurf");
      const link = page.locator("#ow-main").getByRole("link", { name: flow.link, exact: true });
      await link.click();
      const dialog = page.getByRole("dialog", { name: "Ungespeicherte Änderungen verwerfen?" });
      await expect(dialog).toBeVisible();
      await page.getByRole("button", { name: "Weiter bearbeiten" }).click();
      await expect(page).toHaveURL(url + flow.path);
      await expect(page.getByLabel(flow.field, { exact: true })).toHaveValue("Synthetischer ungespeicherter Entwurf");
      await link.click();
      await page.getByRole("button", { name: "Änderungen verwerfen" }).click();
      await expect(page).toHaveURL(url + flow.target);
    } finally { await context.close(); }
  } finally { await f.api.dispose(); }
});

test("customer search stays applied when switching between location and tenant scope", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const f = await owner(url);
  try {
    expect((await f.api.post("/api/merchant/locations", { data: f.locationInput })).status()).toBe(201);
    for (let n = 0; n < 2; n++) expect((await f.api.post("/api/enroll", { data: { slug: f.programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true } })).status()).toBe(201);
    const { members } = await (await f.api.get("/api/merchant/customers")).json() as { members: Array<{ id: string; pseudonym: string }> };
    const wanted = members[0];
    const context = await browser.newContext({ baseURL: url, storageState: await f.api.storageState() });
    try {
      const page = await context.newPage();
      await page.goto("/merchant/customers");
      await expect(page.locator(".ow-member")).toHaveCount(2);
      await page.getByLabel("Kartennummer suchen").fill(wanted.id);
      await page.getByRole("button", { name: "Suchen", exact: true }).click();
      await expect(page.locator(".ow-member")).toHaveCount(1);
      for (const label of ["Alle Standorte", "Erster Standort"]) {
        await page.getByRole("group", { name: "Umfang" }).getByRole("button", { name: label, exact: true }).click();
        await page.waitForLoadState("networkidle");
        await expect(page.locator(".ow-member")).toHaveCount(1);
        await expect(page.locator(".ow-member")).toContainText(wanted.pseudonym);
        await expect(page.getByLabel("Kartennummer suchen")).toHaveValue(wanted.id);
      }
    } finally { await context.close(); }
  } finally { await f.api.dispose(); }
});

test("NFC policy keeps its accessible group name without horizontal page overflow", async ({ baseURL, browser }) => {
  test.skip(!process.env.E2E_NFC_VERIFY_MASTER, "Requires the isolated synthetic NFC verification provider");
  const url = baseURL ?? "http://localhost:3000";
  const f = await owner(url);
  const { programId } = await (await f.api.get("/api/me")).json() as { programId: string };
  expect((await f.api.post("/api/merchant/tap", { data: { action: "policy", programId, mode: "staff_confirmed", cooldownSeconds: 60 } })).status()).toBe(200);
  const context = await browser.newContext({ baseURL: url, storageState: await f.api.storageState() });
  try {
    const page = await context.newPage();
    await page.goto("/merchant/program");
    const group = page.getByRole("group", { name: "Vergabe nach NFC-Berührung", exact: true });
    await expect(group).toBeVisible();
    for (const width of [390, 320, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : width === 1440 ? 900 : 844 });
      await expect(group).toHaveAccessibleName("Vergabe nach NFC-Berührung");
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await expect.poll(() => group.locator("legend").evaluate(element => element.getBoundingClientRect().width)).toBe(1);
      const confirmMode = group.getByRole("radio", { name: /^Mit Bestätigung/ });
      await confirmMode.focus();
      await expect(confirmMode).toBeFocused();
      const save = page.getByRole("button", { name: "NFC-Regel speichern", exact: true });
      await expect(save).toBeVisible();
      const bounds = await save.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
  } finally { await context.close(); await f.api.dispose(); }
});
