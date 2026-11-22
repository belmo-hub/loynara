import { expect, test, type Page } from "@playwright/test";

const weiter = (page: Page) => page.getByRole("button", { name: "Weiter", exact: true }).click();
async function stubbed(page: Page, onboard: Parameters<Page["route"]>[1]) {
  await page.route("**/api/me", route => route.fulfill({ json: { userId: "synthetic-owner", tenantId: null, publicBaseUrl: "http://localhost:3000" } }));
  await page.route("**/api/merchant/onboard", onboard);
  await page.goto("/merchant/program");
}
/** Step 1 filled, on to the card type. */
async function named(page: Page) {
  await page.getByLabel("Geschäftsname").fill("Synthetisches Café");
  await page.getByLabel("Stadt").fill("Kassel");
  await weiter(page);
}

test("guided setup walks four questions, validates inline and previews the card before anything is saved", async ({ page }) => {
  let onboardCalls = 0;
  await stubbed(page, route => { onboardCalls++; return route.abort(); });
  await expect(page.getByRole("heading", { name: "Wie heißt dein Geschäft?", level: 1 })).toBeVisible();
  await expect(page.getByRole("img", { name: "Schritt 1 von 4" })).toBeVisible();

  // Step 1: required fields are validated inline and focus moves to the first problem.
  await weiter(page);
  await expect(page.getByText("Bitte den Geschäftsnamen eingeben.")).toBeVisible();
  await expect(page.getByLabel("Geschäftsname")).toBeFocused();
  // ENG-322/328: step 1 asks for name and city only (the location is named after the city, German only, the
  // contact email is asked for in Absender).
  await expect(page.getByText("Weitere Einstellungen", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Kontakt-E-Mail/)).toHaveCount(0);
  await expect(page.getByLabel("Standortname")).toHaveCount(0);
  await expect(page.getByLabel("Land")).toHaveCount(0);
  await expect(page.getByLabel("Sprache der Karte")).toHaveCount(0);
  await named(page);

  // Step 2: stamps by default with the proposed rule; who confirms is stated separately.
  await expect(page.getByRole("heading", { name: "Wie sammeln deine Kunden?" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Schritt 2 von 4" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Stempelkarte/ })).toBeChecked();
  await expect(page.getByText("Wer bestätigt?")).toBeVisible();
  await expect(page.getByLabel("Regeltext für Kunden")).toHaveValue("Pro bestätigtem Besuch vergibt das Team Stempel an der Kasse.");
  // ENG-099 3c: into points by purchase amount the field becomes the optional extra rules and starts empty.
  await page.getByLabel("Regeltext für Kunden").fill("Ein Stempel pro Heißgetränk.");
  await page.getByText("Punktekarte", { exact: true }).click();
  await page.getByText("Nach Einkaufswert", { exact: true }).click();
  await expect(page.getByLabel("Weitere Regeln (optional)")).toHaveValue("");
  await page.getByText("Manuell", { exact: true }).click();
  await page.getByLabel("Regeltext für Kunden").fill("Kurz");
  await weiter(page);
  await expect(page.getByText("Die Regel braucht mindestens 10 Zeichen.")).toBeVisible();
  await page.getByText("Stempelkarte", { exact: true }).click();
  await page.getByLabel("Regeltext für Kunden").fill("Ein Stempel pro Heißgetränk.");
  await weiter(page);

  // Step 3: a preset names the reward and stays editable; the threshold is never silently empty.
  await page.getByText("Kaffee aufs Haus", { exact: true }).click();
  await expect(page.getByLabel("Name der Prämie")).toHaveValue("Kaffee aufs Haus");
  await expect(page.getByLabel("Einlösbar ab")).toHaveValue("8");
  await page.getByLabel("Einlösbar ab").fill("");
  await weiter(page);
  await expect(page.getByText("Gib eine ganze Zahl ab 1 ein.")).toBeVisible();
  await page.getByLabel("Einlösbar ab").fill("8");
  await weiter(page);

  // Step 4: the card preview and the answers; nothing was sent yet. Back returns a step with the input kept.
  await expect(page.getByRole("heading", { name: "Passt das so?" })).toBeVisible();
  await expect(page.getByRole("group", { name: "So sieht deine Karte aus" })).toContainText("8 Stempel → Kaffee aufs Haus");
  await expect(page.getByRole("group", { name: "So sieht deine Karte aus" })).toContainText("Ein Stempel pro Heißgetränk.");
  await page.goBack();
  await expect(page.getByLabel("Name der Prämie")).toHaveValue("Kaffee aufs Haus");
  expect(onboardCalls).toBe(0);
});

for (const scenario of [
  { name: "blank date", field: "Gültig ab", value: "", error: "Bitte ein gültiges Startdatum eingeben." },
  { name: "blank programme name", field: "Programmname", value: "  ", error: "Bitte einen Programmnamen mit 2 bis 180 Zeichen eingeben." },
]) {
  test(`review rejects ${scenario.name} inline before onboarding`, async ({ page }) => {
    let onboardCalls = 0;
    await stubbed(page, route => { onboardCalls++; return route.abort(); });
    await named(page);
    await weiter(page);
    await page.getByText("Kaffee aufs Haus", { exact: true }).click();
    await weiter(page);
    await page.getByText("Weitere Einstellungen", { exact: true }).click();
    await page.getByLabel(scenario.field, { exact: true }).fill(scenario.value);
    // Closed again: the failed check opens it and focuses the field.
    await page.getByText("Weitere Einstellungen", { exact: true }).click();
    await page.getByRole("button", { name: "Programm starten", exact: true }).click();
    await expect(page.getByText(scenario.error, { exact: true })).toBeVisible();
    await expect(page.getByLabel(scenario.field, { exact: true })).toBeFocused();
    expect(onboardCalls).toBe(0);
  });
}

// ENG-323: the shop search shows only when the server has GOOGLE_MAPS_API_KEY; the browser only ever calls our routes,
// stubbed here, so these run against a local app started with a synthetic key and never reach Google.
async function toSearch(page: Page) {
  await named(page);
  await weiter(page);
  await page.getByText("Kaffee aufs Haus", { exact: true }).click();
  await weiter(page);
  await page.getByText("Weitere Einstellungen", { exact: true }).click();
  const search = page.getByRole("combobox", { name: "Dein Geschäft (optional)" });
  test.skip(!await search.count(), "the app runs without GOOGLE_MAPS_API_KEY, so setup offers no shop search");
  return search;
}

test("review submits the picked place's point and programme fields", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  const asked: unknown[] = [];
  await page.route("**/api/merchant/place-search", route => { asked.push(route.request().postDataJSON()); return route.fulfill({ json: { suggestions: [{ id: "place_1", main: "Café am Platz", secondary: "Königsplatz 1, Kassel" }, { id: "place_2", main: "Café am Platz 2", secondary: "Kassel" }] } }); });
  await page.route("**/api/merchant/place-location", route => route.fulfill({ json: { latitude: 51.3127, longitude: 0 } }));
  await stubbed(page, route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { programSlug: "synthetic-cafe" } }); });
  const search = await toSearch(page);
  await page.getByLabel("Farbe wählen").fill("#7c3848"); // ENG-322: a free colour, not only the swatches
  await expect(page.getByLabel("Farbwert (Hex)")).toHaveValue("#7c3848");
  await page.getByLabel("Programmname", { exact: true }).fill("  Café Treuekarte  ");
  await page.getByLabel("Gültig ab", { exact: true }).fill("2026-10-10");
  await expect(page.getByRole("link", { name: "Datenschutzerklärung von Google" })).toHaveAttribute("href", "https://policies.google.com/privacy");
  await search.fill("Café am");
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.locator(".ow-options").getByRole("img", { name: "Google Maps" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "2 Vorschläge" })).toHaveCount(1);
  // Design's review: a press on the list's padding keeps it open; the list closes when focus leaves and comes back with it.
  await page.locator(".ow-options").click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(search).toBeFocused();
  await search.press("Tab");
  await expect(page.getByRole("link", { name: "Zusätzlichen Nutzungsbedingungen für Google Maps/Google Earth" })).toBeFocused();
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await search.focus();
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await search.press("ArrowDown");
  await expect(search).toHaveAttribute("aria-activedescendant", "su-place-0");
  await search.press("Enter");
  await expect(page.getByText("Königsplatz 1, Kassel")).toBeVisible();
  await expect(page.locator("#su-place-picked")).toBeFocused(); // focus lands on the pick, not the page
  await expect(page.locator("#su-place-picked")).toHaveAttribute("data-kbd", "true"); // a keyboard pick shows the ring
  await expect(page.locator("#su-place-picked").getByRole("img", { name: "Google Maps" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ändern" })).toBeVisible();
  expect(asked.at(-1)).toMatchObject({ text: "Café am", sessionToken: expect.any(String) });
  await page.getByRole("button", { name: "Programm starten", exact: true }).click();
  await expect.poll(() => payload).toMatchObject({ programName: "Café Treuekarte", effectiveDate: "2026-10-10", latitude: 51.3127, longitude: 0, googlePlaceId: "place_1", brandColor: "#7c3848" });
  expect(JSON.stringify(payload)).not.toContain("Königsplatz"); // Google's address is never stored (P-4)
});

test("„Ändern“ drops the pick, so nothing of it is sent", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/merchant/place-search", route => route.fulfill({ json: { suggestions: [{ id: "place_1", main: "Café am Platz", secondary: "Kassel" }] } }));
  await page.route("**/api/merchant/place-location", route => route.fulfill({ json: { latitude: 51.3127, longitude: 9.4797 } }));
  await stubbed(page, route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { programSlug: "synthetic-cafe" } }); });
  const search = await toSearch(page);
  await search.fill("Café am");
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Ändern" }).click();
  await expect(search).toBeFocused();
  await page.getByRole("button", { name: "Programm starten", exact: true }).click();
  await expect.poll(() => payload).toBeTruthy();
  expect(payload).not.toHaveProperty("googlePlaceId");
  expect(payload).not.toHaveProperty("latitude");
});

test("a late answer never lands once the text is cut below two characters", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  const late = (ms: number) => new Promise(done => setTimeout(done, ms));
  await page.route("**/api/merchant/place-search", async route => { await late(600); await route.fulfill({ json: { suggestions: [{ id: "place_1", main: "Café am Platz", secondary: "Kassel" }] } }); });
  await stubbed(page, route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { programSlug: "synthetic-cafe" } }); });
  const search = await toSearch(page);
  // A search in flight, then „C“: the old answer must not open the list.
  await search.fill("Café");
  await page.waitForTimeout(350); // past the debounce, the answer still on its way
  await search.fill("C");
  await page.waitForTimeout(700);
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(search).toHaveAttribute("aria-expanded", "false");
  // A pick in flight, then the field emptied: the pick must not land.
  await page.unroute("**/api/merchant/place-search");
  await page.route("**/api/merchant/place-search", route => route.fulfill({ json: { suggestions: [{ id: "place_1", main: "Café am Platz", secondary: "Kassel" }] } }));
  await page.route("**/api/merchant/place-location", async route => { await late(600); await route.fulfill({ json: { latitude: 51.3127, longitude: 9.4797 } }); });
  await search.fill("Café am");
  await page.getByRole("option").first().click();
  await search.fill("");
  await page.waitForTimeout(800);
  await expect(page.locator("#su-place-picked")).toHaveCount(0);
  await page.getByRole("button", { name: "Programm starten", exact: true }).click();
  await expect.poll(() => payload).toBeTruthy();
  expect(payload).not.toHaveProperty("googlePlaceId");
});

test("a new answer opens the list at its first row", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route("**/api/merchant/place-search", route => route.fulfill({ json: { suggestions: [1, 2, 3, 4, 5].map(n => ({ id: `place_${n}`, main: `Café am Platz ${n}`, secondary: `Wilhelmshöher Allee ${n}, 34117 Kassel` })) } }));
  await stubbed(page, route => route.abort());
  const search = await toSearch(page);
  await search.fill("Café am");
  await expect(page.getByRole("option")).toHaveCount(5);
  await search.press("ArrowUp"); // the last row, scrolled into view
  await expect.poll(() => page.locator("#su-place-list").evaluate(list => list.scrollTop)).toBeGreaterThan(0);
  await search.pressSequentially(" P");
  await expect.poll(() => page.locator("#su-place-list").evaluate(list => list.scrollTop)).toBe(0);
  // Row 1, the best match, sits inside the list's visible part.
  expect(await page.locator("#su-place-list").evaluate(list => { const row = list.querySelector("[role=option]")!.getBoundingClientRect(), box = list.getBoundingClientRect(); return row.top >= box.top && row.bottom <= box.bottom; })).toBe(true);
});

test("a failed shop search says so and setup still starts without a location", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/merchant/place-search", route => route.fulfill({ status: 502, json: { error: "Place search failed" } }));
  await stubbed(page, route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { programSlug: "synthetic-cafe" } }); });
  const search = await toSearch(page);
  await search.fill("Café am");
  await expect(page.getByText("Die Suche klappt gerade nicht. Du kannst auch ohne Standort starten.")).toBeVisible();
  await search.press("Enter"); // Enter in the search never starts the programme
  expect(payload).toBeUndefined();
  await page.getByRole("button", { name: "Programm starten", exact: true }).click();
  await expect.poll(() => payload).toBeTruthy();
  expect(payload).not.toHaveProperty("latitude");
});

// The setup posts the same body as before ENG-122f: every field, by points per purchase amount with empty extra rules.
test("points by purchase amount post the whole onboarding body unchanged", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await stubbed(page, route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { programSlug: "synthetic-cafe" } }); });
  await named(page);
  await page.getByText("Punktekarte", { exact: true }).click();
  await page.getByText("Nach Einkaufswert", { exact: true }).click();
  await page.getByRole("button", { name: "1 Punkt mehr" }).click();
  await weiter(page);
  await page.getByText("Dessert aufs Haus", { exact: true }).click();
  await weiter(page);
  await page.getByRole("button", { name: "Programm starten", exact: true }).click();
  await expect.poll(() => payload).toEqual({
    businessName: "Synthetisches Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Synthetisches Café Treuekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 2,
    rulesText: "", rewardTitle: "Dessert aufs Haus", rewardCost: 100, locationName: "Kassel", brandColor: "#1F4A3A",
    effectiveDate: new Date().toISOString().slice(0, 10),
  });
});
