import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

for (const dismissal of ["Escape", "backdrop"] as const) {
  test(`mobile navigation restores usable trigger focus after ${dismissal}`, async ({ browser, baseURL }) => {
    const url = baseURL ?? "http://localhost:3000";
    const api = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
    try {
      expect((await api.post("/api/auth/sign-up/email", { data: {
        name: "Synthetic navigation owner", email: `navigation-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa`,
      } })).status()).toBe(200);
      expect((await api.post("/api/merchant/onboard", { data: {
        businessName: "Synthetic Navigation Café", locationName: "Erster Standort", city: "Kassel", country: "DE",
        timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Navigation card", programType: "stamp",
        rulesText: "Ein Stempel je bestätigtem synthetischem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5,
      } })).status()).toBe(201);
      const context = await browser.newContext({ baseURL: url, storageState: await api.storageState(), viewport: { width: 375, height: 812 } });
      try {
        const page = await context.newPage();
        await page.goto("/merchant");
        await expect(page.locator(".ow-who")).toContainText("Synthetic Navigation Café");
        const trigger = page.getByRole("button", { name: "Navigation öffnen" });
        const drawer = page.getByRole("complementary", { name: "Bereichsnavigation", includeHidden: true });
        await trigger.focus();
        await page.keyboard.press("Enter");
        await expect(drawer).toHaveAttribute("data-open", "true");
        await expect(drawer.getByRole("link", { name: "Loynara – zur Übersicht" })).toBeFocused();
        await expect(page.locator(".ow-main")).toHaveAttribute("inert", "");
        if (dismissal === "Escape") await page.keyboard.press("Escape");
        else await page.locator(".ow-scrim").click({ position: { x: 365, y: 400 } });
        await expect(drawer).toHaveAttribute("data-open", "false");
        await expect(page.locator(".ow-main")).not.toHaveAttribute("inert");
        await expect(trigger).toBeFocused();
        // Focus restoration makes the next keyboard action usable without re-tabbing the page.
        await page.keyboard.press("Enter");
        await expect(drawer).toHaveAttribute("data-open", "true");
        const customers = drawer.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Kunden" });
        await customers.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/merchant\/customers$/);
        await expect(drawer).toHaveAttribute("data-open", "false");
        await expect(page.getByRole("heading", { name: "Kundenkarten", level: 1 })).toBeVisible();
        await expect(trigger).not.toBeFocused(); // Route changes do not request dismissal focus restoration.
      } finally { await context.close(); }
    } finally { await api.dispose(); }
  });
}
