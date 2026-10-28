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
  await page.getByLabel("Standortname").fill("Kassel Mitte");
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
  await expect(page.getByText("Der Regeltext braucht mindestens 10 Zeichen.")).toBeVisible();
  await page.getByText("Stempelkarte", { exact: true }).click();
  await page.getByLabel("Regeltext für Kunden").fill("Ein Stempel pro Heißgetränk.");
  await weiter(page);

  // Step 3: a preset names the reward and stays editable; the threshold is never silently empty.
  await page.getByText("Kaffee aufs Haus", { exact: true }).click();
  await expect(page.getByLabel("Name der Prämie")).toHaveValue("Kaffee aufs Haus");
  await expect(page.getByLabel("Einlösbar ab")).toHaveValue("8");
  await page.getByLabel("Einlösbar ab").fill("");
  await weiter(page);
  await expect(page.getByText("Bitte eine ganze Zahl größer 0 eingeben.")).toBeVisible();
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
  { name: "invalid coordinates", field: "Breitengrad (optional)", value: "kein Breitengrad", error: "Bitte einen Breitengrad zwischen −90 und 90 eingeben." },
]) {
  test(`review rejects ${scenario.name} inline before onboarding`, async ({ page }) => {
    let onboardCalls = 0;
    await stubbed(page, route => { onboardCalls++; return route.abort(); });
    await named(page);
    await weiter(page);
    await page.getByText("Kaffee aufs Haus", { exact: true }).click();
    await weiter(page);
    await page.getByText("Weitere Einstellungen", { exact: true }).click();
    if (scenario.name === "invalid coordinates") await page.getByLabel("Längengrad (optional)").fill("13.4");
    await page.getByLabel(scenario.field, { exact: true }).fill(scenario.value);
    // Closed again: the failed check opens it and focuses the field.
    await page.getByText("Weitere Einstellungen", { exact: true }).click();
    await page.getByRole("button", { name: "Programm starten", exact: true }).click();
    await expect(page.getByText(scenario.error, { exact: true })).toBeVisible();
    await expect(page.getByLabel(scenario.field, { exact: true })).toBeFocused();
    expect(onboardCalls).toBe(0);
  });
}

test("review submits normalized valid coordinates and programme fields", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await stubbed(page, route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { programSlug: "synthetic-cafe" } }); });
  await named(page);
  await weiter(page);
  await page.getByText("Kaffee aufs Haus", { exact: true }).click();
  await weiter(page);
  await page.getByText("Weitere Einstellungen", { exact: true }).click();
  await page.getByLabel("Programmname", { exact: true }).fill("  Café Treuekarte  ");
  await page.getByLabel("Gültig ab", { exact: true }).fill("2026-10-10");
  await page.getByLabel("Breitengrad (optional)").fill("52,5");
  await page.getByLabel("Längengrad (optional)").fill("0");
  await page.getByRole("button", { name: "Programm starten", exact: true }).click();
  await expect.poll(() => payload).toMatchObject({ programName: "Café Treuekarte", effectiveDate: "2026-10-10", latitude: 52.5, longitude: 0 });
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
    rulesText: "", rewardTitle: "Dessert aufs Haus", rewardCost: 100, locationName: "Kassel Mitte", brandColor: "#1F4A3A",
    effectiveDate: new Date().toISOString().slice(0, 10),
  });
});
