import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

// Phones have no navigation drawer since ENG-122c: „Mehr“ is a page of signposts, reached and left by keyboard alone.
test("mobile „Mehr“ tab opens its page by keyboard and its rows lead on, the tab staying current", async ({ browser, baseURL }) => {
  const url = baseURL ?? "http://localhost:3000";
  const api = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    expect((await api.post("/api/auth/sign-up/email", { headers: { "x-loynara-acceptance": "2026-11-20" }, data: {
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
      const tab = page.getByRole("navigation", { name: "Bereiche" }).getByRole("link", { name: "Mehr" });
      await expect(page.getByRole("complementary", { name: "Bereichsnavigation" })).toBeHidden();
      await tab.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/merchant\/more$/);
      await expect(page.getByRole("heading", { name: "Mehr", level: 1 })).toBeVisible();
      await expect(tab).toHaveAttribute("aria-current", "page");
      const team = page.getByRole("link", { name: /^Team/ });
      await team.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/merchant\/staff$/);
      await expect(tab).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("button", { name: "Abmelden", exact: true })).toHaveCount(0); // sign-out lives on „Mehr“ only
    } finally { await context.close(); }
  } finally { await api.dispose(); }
});
