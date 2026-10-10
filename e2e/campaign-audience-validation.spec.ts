import { expect, test } from "@playwright/test";

test("invalid audience stays in the builder without preview/save requests, then valid inputs can save a draft", async ({ page }) => {
  let previewCalls = 0;
  let saveCalls = 0;
  let savedAudience: unknown;
  await page.route("**/api/me", route => route.fulfill({ json: { userId: "synthetic-owner", tenantId: "synthetic-tenant", role: "owner", locationId: "synthetic-location", locationName: "Berlin", businessName: "Synthetic Café", programSlug: "synthetic", programType: "stamp", hiddenSurfaces: [] } }));
  await page.route("**/api/merchant/locations", route => route.fulfill({ json: { locations: [] } }));
  await page.route("**/api/program/synthetic", route => route.fulfill({ json: { rewards: [] } }));
  await page.route("**/api/merchant/campaigns?*", route => route.fulfill({ json: { campaigns: [], deliveryMode: "disabled" } }));
  await page.route("**/api/merchant/campaigns/preview", route => {
    previewCalls++;
    return route.fulfill({ json: { total: 0, eligibleCount: 0, asOf: new Date().toISOString(), deliveryMode: "disabled", dailyQuota: 20, monthlyLocationQuota: 100, quotaRemaining: 20, excludedCountsByReason: {} } });
  });
  await page.route("**/api/merchant/campaigns", route => {
    saveCalls++;
    savedAudience = route.request().postDataJSON().audienceDefinition;
    return route.fulfill({ json: { id: "synthetic-draft" } });
  });
  await page.goto("/merchant/campaigns");
  await page.getByRole("button", { name: "Eigene Kampagne" }).click();
  const days = page.getByLabel("Inaktiv seit mindestens (Tage)");
  for (const invalid of ["", "0", "1.5", "3651"]) {
    await days.fill(invalid);
    await expect(page.getByRole("button", { name: "Weiter", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Zielgruppe prüfen" })).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: "Prüfe die Zielgruppe" })).toContainText("Prüfe die Zielgruppe");
  }
  expect(previewCalls).toBe(0);
  expect(saveCalls).toBe(0);
  await days.fill("60");
  await page.getByRole("button", { name: "Zielgruppe prüfen" }).click();
  await expect(page.getByText(/0 Karten, davon 0 per E-Mail erreichbar/)).toBeVisible();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByLabel("Interner Titel").fill("Synthetic draft");
  await page.getByLabel("Betreff").fill("Synthetic subject");
  await page.getByLabel("Nachricht", { exact: true }).fill("Synthetic draft body");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect(page.getByText("Entwurf gespeichert. Es wurde nichts versendet.")).toBeVisible();
  expect(saveCalls).toBe(1);
  expect(savedAudience).toEqual({ kind: "inactive", daysSinceLast: 60 });
  await expect(page.getByRole("button", { name: "Planen", exact: true })).toHaveCount(0);
});
