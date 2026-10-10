import { expect, test } from "@playwright/test";

test("guided setup walks four steps, validates inline and previews the card before anything is saved", async ({ page }) => {
  let onboardCalls = 0;
  await page.route("**/api/me", route => route.fulfill({ json: { userId: "synthetic-owner", tenantId: null, publicBaseUrl: "http://localhost:3000" } }));
  await page.route("**/api/merchant/onboard", route => { onboardCalls++; return route.abort(); });
  await page.goto("/merchant/program");
  await expect(page.getByRole("heading", { name: "Dein Treueprogramm einrichten", level: 1 })).toBeVisible();

  // Step 1: required fields are validated inline and focus moves to the first problem.
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(page.getByText("Bitte den Geschäftsnamen eingeben.")).toBeVisible();
  await expect(page.getByLabel("Geschäftsname")).toBeFocused();
  await page.getByLabel("Geschäftsname").fill("Synthetisches Café");
  await page.getByLabel("Standort", { exact: true }).fill("Kassel Mitte");
  await page.getByLabel("Stadt").fill("Kassel");
  await expect(page.locator(".ow-cardprev-face")).toContainText("Synthetisches Café");
  await page.getByRole("button", { name: "Café", exact: true }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();

  // Step 2: earning sentence and who confirms are separate; an editable rule text is proposed.
  await expect(page.getByRole("heading", { name: "Wie sammeln Kunden?" })).toBeVisible();
  await expect(page.getByText("Wer bestätigt?")).toBeVisible();
  await expect(page.getByLabel("Regeltext für Kunden")).toHaveValue(/Stempel/);
  await page.getByRole("button", { name: "Weiter", exact: true }).click();

  // Step 3: preset values are only examples and stay editable; the cost is never silently zero.
  await expect(page.getByLabel("Name der Prämie")).toHaveValue("Kaffee aufs Haus");
  await page.getByLabel("Preis in Stempeln").fill("");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(page.getByText("Bitte eine ganze Zahl größer 0 eingeben.")).toBeVisible();
  await page.getByLabel("Preis in Stempeln").fill("8");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();

  // Step 4: review shows rule, confirmation, threshold and card; nothing was sent yet.
  await expect(page.getByRole("heading", { name: "Zusammenfassung" })).toBeVisible();
  await expect(page.getByText("8 Stempel → Kaffee aufs Haus")).toBeVisible();
  expect(onboardCalls).toBe(0);
});


for (const scenario of [
  { name: "blank date", field: "Gültig ab", value: "", error: "Bitte ein gültiges Startdatum eingeben." },
  { name: "blank programme name", field: "Programmname", value: "  ", error: "Bitte einen Programmnamen mit 2 bis 180 Zeichen eingeben." },
  { name: "invalid coordinates", field: "Breitengrad (optional)", value: "kein Breitengrad", error: "Bitte einen Breitengrad zwischen −90 und 90 eingeben." },
]) {
  test(`review rejects ${scenario.name} inline before onboarding`, async ({ page }) => {
    let onboardCalls = 0;
    await page.route("**/api/me", route => route.fulfill({ json: { userId: "synthetic-owner", tenantId: null, publicBaseUrl: "http://localhost:55435" } }));
    await page.route("**/api/merchant/onboard", route => { onboardCalls++; return route.abort(); });
    await page.goto("/merchant/program");
    await page.getByLabel("Geschäftsname").fill("Synthetisches Café");
    await page.getByLabel("Standort", { exact: true }).fill("Kassel Mitte");
    await page.getByLabel("Stadt").fill("Kassel");
    await page.getByRole("button", { name: "Café", exact: true }).click();
    for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await page.getByText("Weitere Einstellungen", { exact: true }).click();
    if (scenario.name === "invalid coordinates") await page.getByLabel("Längengrad (optional)").fill("13.4");
    await page.getByLabel(scenario.field, { exact: true }).fill(scenario.value);
    if (scenario.name !== "blank programme name") await page.getByText("Weitere Einstellungen", { exact: true }).click();
    await page.getByRole("button", { name: "Programm starten", exact: true }).click();
    await expect(page.getByText(scenario.error, { exact: true })).toBeVisible();
    await expect(page.getByLabel(scenario.field, { exact: true })).toBeFocused();
    expect(onboardCalls).toBe(0);
  });
}


test("review submits normalized valid coordinates and programme fields", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/me", route => route.fulfill({ json: { userId: "synthetic-owner", tenantId: null, publicBaseUrl: "http://localhost:55435" } }));
  await page.route("**/api/merchant/onboard", route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { programSlug: "synthetic-cafe" } });
  });
  await page.goto("/merchant/program");
  await page.getByLabel("Geschäftsname").fill("Synthetisches Café");
  await page.getByLabel("Standort", { exact: true }).fill("Kassel Mitte");
  await page.getByLabel("Stadt").fill("Kassel");
  await page.getByRole("button", { name: "Café", exact: true }).click();
  for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByLabel("Programmname", { exact: true }).fill("  Café Treuekarte  ");
  await page.getByText("Weitere Einstellungen", { exact: true }).click();
  await page.getByLabel("Gültig ab", { exact: true }).fill("2026-10-10");
  await page.getByLabel("Breitengrad (optional)").fill("52,5");
  await page.getByLabel("Längengrad (optional)").fill("0");
  await page.getByRole("button", { name: "Programm starten", exact: true }).click();
  await expect.poll(() => payload).toMatchObject({ programName: "Café Treuekarte", effectiveDate: "2026-10-10", latitude: 52.5, longitude: 0 });
});
