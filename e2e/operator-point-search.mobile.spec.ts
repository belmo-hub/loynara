import { expect, test, type Page } from "@playwright/test";

// ENG-331, Design's round 3: the operator's coordinates sheet with the shop search, at 390 on Chrome and WebKit. Needs an
// operator account on a server that lists it (as operator.mobile.spec) and a synthetic GOOGLE_MAPS_API_KEY; every place
// route and the coordinates route are answered here, so nothing reaches Google or the database.
// Motion on, like most phones: a transition on the held height once let the sheet drop under the finger (Design round 5).
test.use({ viewport: { width: 390, height: 844 }, contextOptions: { reducedMotion: "no-preference" } });

// OPERATOR_E2E_STATE (a saved operator session) runs it against a review stack without signing in.
const state = process.env.OPERATOR_E2E_STATE;
if (state) test.use({ storageState: state });

async function sheet(page: Page) {
  const email = process.env.OPERATOR_E2E_EMAIL, password = process.env.OPERATOR_E2E_PASSWORD;
  test.skip(!state && (!email || !password), "needs an operator account on a server that lists it");
  const origin = new URL(test.info().project.use.baseURL!).origin;
  if (!state) expect((await page.request.post("/api/auth/sign-in/email", { data: { email, password }, headers: { Origin: origin } })).ok()).toBe(true);
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
  // Tapped into first, as a person does: that press already ran the sheet's hold once, which is how a transition on the
  // held height used to start from 0 and let the sheet drop on the next press.
  await search.click();
  await search.fill("Café am");
  await expect(dialog.getByRole("option")).toHaveCount(5);
  // A real tap rests about 60 ms: long enough for the list to close under the finger, so the sheet must not move then.
  const close = (await dialog.getByRole("button", { name: "Schließen" }).boundingBox())!;
  await page.mouse.move(close.x + close.width / 2, close.y + close.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await expect(dialog).toBeHidden();
});

test("a pick shows its point as text with no input, and sends it only with its place id", async ({ page }) => {
  const { dialog, search } = await sheet(page);
  let body: Record<string, unknown> | undefined;
  await page.route("**/api/operator/location-coordinates", route => { body = route.request().postDataJSON(); return route.fulfill({ json: { latitude: 51.3127, longitude: 9.4797, changed: true } }); });
  await search.fill("Café am");
  await dialog.getByRole("option").first().click();
  await expect(dialog.getByText("Gewählter Ort")).toBeVisible();
  // The press held the sheet's height; after it the sheet settles to its content (Design round 4).
  await expect.poll(() => dialog.evaluate(element => (element as HTMLElement).style.minHeight)).toBe("0px");
  await expect(dialog.getByRole("textbox", { name: "Koordinaten" })).toHaveCount(0);
  await expect(dialog.getByText("51.31270, 9.47970", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Der Punkt kommt aus der Suche. Loynara frischt ihn regelmäßig bei Google auf.")).toBeVisible();
  await dialog.getByRole("button", { name: "Prüfen" }).click();
  await expect.poll(() => body).toMatchObject({ coordinates: "51.31270, 9.47970", googlePlaceId: "place_1", execute: false });
  await dialog.getByRole("button", { name: "Ändern" }).click();
  await expect(dialog.getByRole("textbox", { name: "Koordinaten" })).toHaveValue("");
});

test("a press on the disabled „Prüfen“ leaves no held height behind", async ({ page }) => {
  const { dialog } = await sheet(page);
  const check = dialog.getByRole("button", { name: "Prüfen" });
  await expect(check).toBeDisabled();
  await check.evaluate(element => element.scrollIntoView({ block: "center" }));
  const box = (await check.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // disabled: a press, no click
  expect(await dialog.evaluate(element => (element as HTMLElement).style.minHeight)).toBe("");
  await dialog.getByRole("button", { name: "Schließen" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: /^Koordinaten (setzen|ändern)$/ }).first().click();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => (element as HTMLElement).style.minHeight)).toBe("");
});

test("a right-click with the list open leaves no held height, and „Schließen“ stays on screen after rotating", async ({ page }) => {
  const { dialog, search } = await sheet(page);
  await search.fill("Café am");
  await expect(dialog.getByRole("option")).toHaveCount(5);
  const title = (await dialog.getByRole("heading", { name: "Koordinaten" }).boundingBox())!;
  await page.mouse.click(title.x + 4, title.y + 4, { button: "right" }); // a press with no click to release it
  await expect.poll(() => dialog.evaluate(element => (element as HTMLElement).style.minHeight)).toMatch(/^(0px)?$/);
  await page.setViewportSize({ width: 844, height: 390 });
  expect((await dialog.getByRole("button", { name: "Schließen" }).boundingBox())!.y).toBeGreaterThanOrEqual(0);
});

test("a macOS Ctrl+click with the list open leaves no held height, and „Schließen“ stays on screen after rotating", async ({ page }) => {
  const { dialog, search } = await sheet(page);
  await search.fill("Café am");
  await expect(dialog.getByRole("option")).toHaveCount(5);
  // What Safari and Chrome on a Mac send for Ctrl+click on text: pointerdown with button 0 and ctrlKey, then contextmenu, no click.
  await dialog.locator("#su-place-legal").evaluate(text => {
    text.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true, pointerType: "mouse" }));
    text.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 0, ctrlKey: true }));
  });
  await expect.poll(() => dialog.evaluate(element => (element as HTMLElement).style.minHeight)).toMatch(/^(0px)?$/);
  await page.setViewportSize({ width: 844, height: 390 });
  expect((await dialog.getByRole("button", { name: "Schließen" }).boundingBox())!.y).toBeGreaterThanOrEqual(0);
});

test("a middle-click with the list open takes no hold, and „Schließen“ stays on screen after rotating", async ({ page }) => {
  const { dialog, search } = await sheet(page);
  await search.fill("Café am");
  await expect(dialog.getByRole("option")).toHaveCount(5);
  // A middle press: pointerdown with button 1, then auxclick; no click and no contextmenu ever release a hold.
  await dialog.locator("#su-place-legal").evaluate(text => {
    text.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 1, buttons: 4, pointerType: "mouse" }));
    text.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  });
  await page.waitForTimeout(50);
  expect(await dialog.evaluate(element => (element as HTMLElement).style.minHeight)).toBe("");
  await page.setViewportSize({ width: 844, height: 390 });
  expect((await dialog.getByRole("button", { name: "Schließen" }).boundingBox())!.y).toBeGreaterThanOrEqual(0);
});

