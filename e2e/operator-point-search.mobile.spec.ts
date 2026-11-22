import { expect, test, type Page } from "@playwright/test";

// ENG-331, Design's round 3: the operator's coordinates sheet with the shop search, at 390 on Chrome and WebKit. Needs an
// operator account on a server that lists it (as operator.mobile.spec) and a synthetic GOOGLE_MAPS_API_KEY; every place
// route and the coordinates route are answered here, so nothing reaches Google or the database.
test.use({ viewport: { width: 390, height: 844 } });

async function sheet(page: Page) {
  const email = process.env.OPERATOR_E2E_EMAIL, password = process.env.OPERATOR_E2E_PASSWORD;
  test.skip(!email || !password, "needs an operator account on a server that lists it");
  const origin = new URL(test.info().project.use.baseURL!).origin;
  expect((await page.request.post("/api/auth/sign-in/email", { data: { email, password }, headers: { Origin: origin } })).ok()).toBe(true);
  await page.route("**/api/merchant/place-search", route => route.fulfill({ json: { suggestions: [1, 2, 3, 4, 5].map(n => ({ id: `place_${n}`, main: `Café am Platz ${n}`, secondary: "Kassel" })) } }));
  await page.route("**/api/merchant/place-location", route => route.fulfill({ json: { latitude: 51.3127, longitude: 9.4797 } }));
  await page.goto("/operator");
  await page.getByRole("button", { name: /^Koordinaten (setzen|ändern)$/ }).first().click();
  const dialog = page.getByRole("dialog");
  const search = dialog.getByRole("combobox", { name: "Geschäft suchen" });
  test.skip(!await search.count(), "the server runs without GOOGLE_MAPS_API_KEY, so the sheet offers no search");
  return { dialog, search };
}

test("„Schließen“ closes the sheet while the list is open", async ({ page }) => {
  const { dialog, search } = await sheet(page);
  await search.fill("Café am");
  await expect(dialog.getByRole("option")).toHaveCount(5);
  await dialog.getByRole("button", { name: "Schließen" }).click();
  await expect(dialog).toBeHidden();
});

test("a pick shows its point as text with no input, and sends it only with its place id", async ({ page }) => {
  const { dialog, search } = await sheet(page);
  let body: Record<string, unknown> | undefined;
  await page.route("**/api/operator/location-coordinates", route => { body = route.request().postDataJSON(); return route.fulfill({ json: { latitude: 51.3127, longitude: 9.4797, changed: true } }); });
  await search.fill("Café am");
  await dialog.getByRole("option").first().click();
  await expect(dialog.getByText("Gewählter Ort")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Koordinaten" })).toHaveCount(0);
  await expect(dialog.getByText("51.31270, 9.47970", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Der Punkt kommt aus der Suche. Loynara frischt ihn regelmäßig bei Google auf.")).toBeVisible();
  await dialog.getByRole("button", { name: "Prüfen" }).click();
  await expect.poll(() => body).toMatchObject({ coordinates: "51.31270, 9.47970", googlePlaceId: "place_1", execute: false });
  await dialog.getByRole("button", { name: "Ändern" }).click();
  await expect(dialog.getByRole("textbox", { name: "Koordinaten" })).toHaveValue("");
});
