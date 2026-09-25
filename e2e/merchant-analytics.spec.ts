import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("owner sees tenant-scoped checkout analytics while cashier and guest cannot", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const headers = { Origin: new URL(url).origin };
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  const cashier = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  try {
    const ownerEmail = `analytics-owner-${randomUUID()}@example.test`;
    const cashierEmail = `analytics-cashier-${randomUUID()}@example.test`;
    expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic analytics owner", email: ownerEmail, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    expect((await cashier.post("/api/auth/sign-up/email", { data: { name: "Synthetic analytics cashier", email: cashierEmail, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const onboard = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Synthetic Analytics Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Synthetic analytics card", programType: "stamp", rulesText: "One stamp per confirmed synthetic checkout.", rewardTitle: "Coffee", rewardCost: 5,
    } });
    expect(onboard.status()).toBe(201);
    const { programSlug, locationId } = await onboard.json() as { programSlug: string; locationId: string };
    const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const card = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    expect(card.status()).toBe(200);
    const { scanCode } = await card.json() as { scanCode: string };
    const lookup = await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`);
    expect(lookup.status()).toBe(200);
    const { membershipId, rewards } = await lookup.json() as { membershipId: string; rewards: Array<{ id: string }> };
    for (const quantity of [5, 1]) {
      expect((await owner.post("/api/cashier/award", { data: { membershipId, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);
    }
    expect((await owner.post("/api/cashier/redeem", { data: { membershipId, rewardVersionId: rewards[0].id, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);

    const analytics = await owner.get("/api/merchant/analytics?window=30");
    expect(analytics.status()).toBe(200);
    expect(analytics.headers()["cache-control"]).toBe("no-store");
    const report = await analytics.json() as { currentActiveCards: number; newCards: number; qualifyingCheckouts: number; repeatCards: number; issued: { stampUnits: number }; rewards: { redemptions: number }; series: Array<{ checkouts: number }>; countingRule: string };
    expect(report).toMatchObject({ currentActiveCards: 1, newCards: 1, qualifyingCheckouts: 2, repeatCards: 1, issued: { stampUnits: 6 }, rewards: { redemptions: 1 } });
    expect(report.series.reduce((sum, bucket) => sum + bucket.checkouts, 0)).toBe(2);
    expect(JSON.stringify(report)).not.toContain(cardToken);
    expect(JSON.stringify(report)).not.toContain(scanCode);
    expect((await owner.get("/api/merchant/analytics?window=365")).status()).toBe(400);
    expect((await guest.get("/api/merchant/analytics")).status()).toBe(401);

    const invite = await owner.post("/api/staff/invite", { data: { locationId, email: cashierEmail, role: "cashier" } });
    expect(invite.status()).toBe(201);
    const { token } = await invite.json() as { token: string };
    expect((await cashier.post("/api/staff/accept", { data: { token } })).status()).toBe(200);
    expect((await cashier.get("/api/merchant/analytics")).status()).toBe(403);

    const ownerBrowser = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const page = await ownerBrowser.newPage();
      await page.goto("/merchant/analytics");
      await expect(page.getByRole("heading", { name: "Auswertung", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Bestätigte Kassenvorgänge" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Einlösungen" })).toBeVisible();
      await expect(page.getByText("Kaffee", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
      await expect(page.getByText("Diese Daten messen weder tatsächliche Besuche noch Umsatzsteigerungen oder zusätzliche Verkäufe.")).toBeVisible();
      await page.getByLabel("Zeitraum").selectOption("90");
      await expect(page.getByText("Verfügbare Zeiträume: 30 und 90 Tage", { exact: false })).toBeVisible();
      await expect(page.getByLabel("Zeitraum")).toHaveValue("90");
    } finally { await ownerBrowser.close(); }
  } finally { await Promise.all([owner.dispose(), cashier.dispose(), guest.dispose()]); }
});
