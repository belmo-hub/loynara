import { expect, test, type Page } from "@playwright/test";

// ENG-323, Design's re-check: on the iPhone engine focus must land on the picked place even when place-location is slow.
const weiter = (page: Page) => page.getByRole("button", { name: "Weiter", exact: true }).click();

test("focus lands on the picked place after a slow place-location answer", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: { userId: "synthetic-owner", tenantId: null, publicBaseUrl: "http://localhost:3000" } }));
  await page.route("**/api/merchant/place-search", route => route.fulfill({ json: { suggestions: [{ id: "place_1", main: "Café am Platz", secondary: "Königsplatz 1, Kassel" }] } }));
  await page.route("**/api/merchant/place-location", async route => { await new Promise(done => setTimeout(done, 300)); await route.fulfill({ json: { latitude: 51.3127, longitude: 9.4797 } }); });
  await page.goto("/merchant/program");
  await page.getByLabel("Geschäftsname").fill("Synthetisches Café");
  await page.getByLabel("Stadt").fill("Kassel");
  await weiter(page);
  await weiter(page);
  await page.getByText("Kaffee aufs Haus", { exact: true }).click();
  await weiter(page);
  await page.getByText("Weitere Einstellungen", { exact: true }).click();
  const search = page.getByRole("combobox", { name: "Dein Geschäft (optional)" });
  test.skip(!await search.count(), "the app runs without GOOGLE_MAPS_API_KEY, so setup offers no shop search");
  await search.fill("Café am");
  await page.getByRole("option").first().click();
  await expect(page.getByRole("status").filter({ hasText: "Café am Platz wird übernommen …" })).toHaveCount(1);
  await expect(page.locator("#su-place-picked")).toBeFocused();
});
