import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("owner sees priced location plans and actual card usage without a live charge", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const headers = { Origin: new URL(url).origin };
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  try {
    expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic billing owner", email: `billing-owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const onboard = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Billing Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic card", programType: "stamp", rulesText: "One stamp per confirmed synthetic checkout.", rewardTitle: "Coffee", rewardCost: 5 } });
    expect(onboard.status()).toBe(201);
    const { programSlug } = await onboard.json() as { programSlug: string };
    expect((await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } })).status()).toBe(201);
    const second = await owner.post("/api/merchant/locations", { data: { name: "Synthetic second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed synthetic checkout.", rewardTitle: "Tea", rewardCost: 5 } });
    expect(second.status()).toBe(201);
    const overview = await owner.get("/api/merchant/billing");
    expect(overview.status()).toBe(200);
    expect(await overview.json()).toMatchObject({ status: "manual_pending", locationCount: 2, monthlySubtotalMinor: 9800, liveBilling: false, locations: expect.arrayContaining([expect.objectContaining({ locationName: "Synthetic Billing Café", activeMembers: 1, memberLimit: 10000, priceMinor: 4900 }), expect.objectContaining({ locationName: "Synthetic second counter", activeMembers: 0, memberLimit: 10000, priceMinor: 4900 })]) });
    expect((await guest.get("/api/merchant/billing")).status()).toBe(401);
    const context = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const page = await context.newPage();
      await page.goto("/merchant/billing");
      await expect(page.getByRole("heading", { name: "Tarif und Abrechnung" })).toBeVisible();
      await expect(page.getByText("98,00 €", { exact: false })).toBeVisible();
      await expect(page.locator("main").getByText("Synthetic second counter")).toBeVisible();
      await expect(page.getByText("1 von 10000 aktiven Karten")).toBeVisible();
      await page.screenshot({ path: "screenshots/platform-after-billing.png", fullPage: true });
    } finally { await context.close(); }
  } finally { await Promise.all([owner.dispose(), guest.dispose()]); }
});

test("local fixture handoff records a test period and owner cancellation in the browser", async ({ baseURL, browser }) => {
  test.skip(process.env.BILLING_FIXTURE_BROWSER !== "true", "Run only with the guarded synthetic loopback fixture server");
  const url = baseURL ?? "http://localhost:3000";
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic fixture owner", email: `fixture-owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    expect((await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Fixture Bakery", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Fixture card", programType: "stamp", rulesText: "One stamp per confirmed synthetic checkout.", rewardTitle: "Bread", rewardCost: 5 } })).status()).toBe(201);
    const unsigned = await owner.post("/api/billing/fixture/webhook", { data: { id: `evt_${randomUUID()}`, type: "payment.failed" } });
    expect(unsigned.status()).toBe(400);
    expect(await unsigned.json()).toMatchObject({ code: "INVALID_SIGNATURE" });
    const context = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const page = await context.newPage();
      await page.goto("/merchant/billing");
      await page.getByRole("button", { name: "Lokalen Zahlungstest öffnen" }).click();
      await expect(page).toHaveURL(/\/merchant\/billing\/fixture\/[a-f0-9-]+$/);
      await expect(page.getByText("Nur eine Vorschau. Es wird kein Geld bewegt.")).toBeVisible();
      await page.getByRole("button", { name: "Testbuchung bestätigen" }).click();
      await expect(page.getByText("Lokale Testbuchung erfasst.")).toBeVisible();
      await page.getByRole("link", { name: "Zur Abrechnung" }).click();
      await expect(page.getByRole("heading", { name: "Lokale Testperiode aktiv" })).toBeVisible();
      await expect(page.locator("small").filter({ hasText: "Fixture-Beleg" })).toBeVisible();
      await page.screenshot({ path: "screenshots/platform-after-billing-fixture.png", fullPage: true });
      await page.getByRole("button", { name: "Testperiode zum Ende beenden" }).click();
      await page.getByRole("button", { name: "Beendigung bestätigen" }).click();
      await expect(page.getByText("Beendigung zum", { exact: false })).toBeVisible();
    } finally { await context.close(); }
  } finally { await owner.dispose(); }
});
