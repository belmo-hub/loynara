import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("cashier browser confirms purchase points and selected reward before card reload", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    expect((await owner.post("/api/auth/sign-up/email", { data: {
      name: "Synthetic purchase owner", email: `purchase-browser-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa`,
    } })).status()).toBe(200);
    const setup = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Synthetic Purchase Café", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3,
      rulesText: "Drei Punkte je vollem Euro Einkaufswert an der Kasse.", rewardTitle: "Kaffee", rewardCost: 14,
    } });
    expect(setup.status()).toBe(201);
    const { programSlug } = await setup.json() as { programSlug: string };
    const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const firstCard = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    const { scanCode } = await firstCard.json() as { scanCode: string };

    const browserContext = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const cashier = await browserContext.newPage();
      await cashier.goto("/cashier");
      await cashier.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
      await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
      await expect(cashier.getByRole("heading", { name: "Karte gefunden." })).toBeVisible();
      await expect(cashier.locator(".balance-display strong")).toContainText("0 Punkte");
      await cashier.getByRole("button", { name: "Kaufbetrag eingeben" }).click();
      await expect(cashier.getByLabel("Kaufbetrag (EUR)")).toBeFocused();
      await cashier.getByLabel("Kaufbetrag (EUR)").fill("4,99");
      // Amount → preview (points and new balance) → one „Buchen“; no second confirmation.
      await expect(cashier.locator("#purchase-preview")).toContainText("+14 Punkte");
      await expect(cashier.locator("#purchase-preview")).toContainText("Neuer Stand: 14 Punkte");
      await cashier.getByRole("button", { name: "Buchen", exact: true }).click();
      await expect(cashier.getByRole("dialog")).toHaveCount(0);
      await expect(cashier.locator(".cashier-booked")).toContainText("+14 Punkte");
      await expect(cashier.locator(".cashier-booked")).toContainText("Neuer Stand: 14 Punkte");
      // „Rückgängig“ on the booked screen reverses it through the owner's correction path.
      await cashier.locator(".cashier-booked").getByRole("button", { name: "Rückgängig" }).click();
      await expect(cashier.locator(".cashier-booked")).toContainText("Rückgängig gemacht");
      await expect(cashier.locator(".cashier-booked")).toContainText("Neuer Stand: 0 Punkte");
      expect((await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { balance: number }).balance).toBe(0);
      async function reopen() {
        await cashier.getByRole("button", { name: "Andere Karte" }).click();
        await cashier.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
        await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
      }
      await reopen();
      await expect(cashier.locator(".balance-display strong")).toContainText("0 Punkte");
      await cashier.getByRole("button", { name: "Kaufbetrag eingeben" }).click();
      await cashier.getByLabel("Kaufbetrag (EUR)").fill("4,99");
      await cashier.getByRole("button", { name: "Buchen", exact: true }).click();
      await expect(cashier.locator(".cashier-booked")).toContainText("Neuer Stand: 14 Punkte");
      await reopen();
      await expect(cashier.locator(".balance-display strong")).toContainText("14 Punkte");
      await expect(cashier.getByLabel("Kaufbetrag (EUR)")).toHaveValue("");
      // A reward is ready: redeeming is the primary action at the bottom of the dock; entering an amount steps back.
      const dock = cashier.locator("[data-dock]");
      await expect(dock.locator("button").last()).toHaveText("Prämie einlösen");
      await expect(dock.getByRole("button", { name: "Kaufbetrag eingeben" })).toBeVisible();
      await dock.getByRole("button", { name: "Prämie einlösen" }).click();
      await expect(cashier.getByRole("dialog", { name: "Einlösung bestätigen?" })).toContainText("Kaffee");
      await cashier.getByRole("button", { name: "Ja, einlösen" }).click();
      await expect(cashier.locator(".cashier-booked")).toContainText("Neuer Stand: 0 Punkte");

      const card = await browserContext.newPage();
      await card.goto(`/card/${encodeURIComponent(cardToken)}`);
      await expect(card.locator(".customer-balance-line strong")).toHaveText("0 Punkte");
      await expect(card.locator(".customer-activity-list")).toContainText("+14 Punkte");
      await expect(card.locator(".customer-activity-list")).toContainText("-14 Punkte");
    } finally { await browserContext.close(); }
  } finally { await Promise.all([owner.dispose(), guest.dispose()]); }
});
