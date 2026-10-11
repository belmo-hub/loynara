import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

// Shared synthetic identities avoid eight signups per run. Each case authenticates
// through the real application and uses a unique guest card and browser context.
let programSlug: string;
const email = `cashier-${randomUUID()}@example.test`;
const password = `Local!${randomUUID()}Aa`;
test.beforeAll(async ({ baseURL }) => {
  const url = baseURL ?? "http://localhost:3000";
  const options = { baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } };
  const owner = await apiRequest.newContext(options);
  const staff = await apiRequest.newContext(options);
  try {
    expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic session owner", email: `owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic session Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Session card", programType: "stamp", rulesText: "One confirmed visit", rewardTitle: "Coffee", rewardCost: 5 } });
    expect(setup.status()).toBe(201);
    const merchant = await setup.json() as { programSlug: string; locationId: string };
    programSlug = merchant.programSlug;
    const invite = await owner.post("/api/staff/invite", { data: { locationId: merchant.locationId, email, role: "cashier" } });
    expect(invite.status()).toBe(201);
    const { token } = await invite.json() as { token: string };
    expect((await staff.post("/api/auth/sign-up/email", { data: { name: "Synthetic session cashier", email, password } })).status()).toBe(200);
    expect((await staff.post("/api/staff/accept", { data: { token } })).status()).toBe(200);
  } finally { await owner.dispose(); await staff.dispose(); }
});

for (const width of [375, 1280]) for (const operation of ["award", "lookup"] as const) {
  test(`terminated cashier session blocks stale booking controls with sign-in guidance (${operation}, ${width}px)`, async ({ baseURL, browser }) => {
    const url = baseURL ?? "http://localhost:3000";
    const options = { baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } };
    const staff = await apiRequest.newContext(options);
    const guest = await apiRequest.newContext(options);
    try {
      expect((await staff.post("/api/auth/sign-in/email", { data: { email, password } })).status()).toBe(200);
      const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
      expect(joined.status()).toBe(201);
      const { cardToken } = await joined.json() as { cardToken: string };
      const card = await (await guest.get(`/api/card/${cardToken}`)).json() as { scanCode: string };
      const context = await browser.newContext({ baseURL: url, storageState: await staff.storageState(), extraHTTPHeaders: options.extraHTTPHeaders, viewport: { width, height: 812 } });
      try {
        const page = await context.newPage();
        await page.goto("/cashier");
        await expect(page.locator("#cashier-code")).toBeVisible();
        await page.locator("#cashier-code").fill(card.scanCode); await page.locator("#cashier-code").press("Enter");
        const award = page.getByRole("button", { name: "1 Stempel vergeben", exact: true });
        await expect(award).toBeVisible();
        const authorized = page.waitForResponse(response => response.url().endsWith("/api/cashier/award"));
        await award.focus(); await page.keyboard.press("Enter");
        expect((await authorized).status()).toBe(200);
        await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand: 1 Stempel");
        await page.getByRole("button", { name: "Andere Karte", exact: true }).click();
        if (operation === "award") {
          await page.locator("#cashier-code").fill(card.scanCode); await page.locator("#cashier-code").press("Enter");
          await expect(award).toBeVisible();
        }
        const before = await (await guest.get(`/api/card/${cardToken}`)).json();
        // Supported auth lifecycle; browser UI stays mounted after actual server sign-out.
        expect((await context.request.post("/api/auth/sign-out", { data: {} })).status()).toBe(200);
        let requests = 0;
        const target = operation === "award" ? "/api/cashier/award" : "/api/cashier/lookup";
        page.on("request", request => { if (new URL(request.url()).pathname === target) requests++; });
        const denied = page.waitForResponse(response => new URL(response.url()).pathname === target);
        if (operation === "award") { await award.focus(); await page.keyboard.press("Enter"); }
        else { await page.locator("#cashier-code").fill(card.scanCode); await page.locator("#cashier-code").press("Enter"); }
        const response = await denied;
        expect(response.status()).toBe(401);
        expect((await response.json()).code).toBe("UNAUTHENTICATED");
        expect(await (await guest.get(`/api/card/${cardToken}`)).json()).toEqual(before);
        expect(requests).toBe(1);
        await expect(page.getByRole("heading", { name: "Zugang gesperrt oder nicht eingerichtet" })).toBeVisible();
        await expect(page.locator(".app-state-card")).toContainText("Bitte melde dich erneut an");
        await expect(award).toHaveCount(0);
        await expect(page.locator(".cashier-booked")).toHaveCount(0);
        const login = page.getByRole("link", { name: "Zur Anmeldung" });
        await login.focus(); await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByLabel("E-Mail-Adresse")).toBeVisible();
        expect(requests).toBe(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      } finally { await context.close(); }
    } finally { await staff.dispose(); await guest.dispose(); }
  });
}
