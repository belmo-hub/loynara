import { expect, test, type Page } from "@playwright/test";

async function composer(page: Page, failFirstSave = false) {
  let releaseSave!: () => void;
  let started!: () => void;
  const saving = new Promise<void>(resolve => { started = resolve; });
  const hold = new Promise<void>(resolve => { releaseSave = resolve; });
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/me", route => route.fulfill({ json: { userId: "synthetic-owner", tenantId: "synthetic-tenant", role: "owner", locationId: "synthetic-location", locationName: "Berlin", businessName: "Synthetic Café", programSlug: "synthetic", programType: "stamp", hiddenSurfaces: [] } }));
  await page.route("**/api/merchant/locations", route => route.fulfill({ json: { locations: [] } }));
  await page.route("**/api/program/synthetic", route => route.fulfill({ json: { rewards: [] } }));
  await page.route("**/api/merchant/campaigns?*", route => route.fulfill({ json: { campaigns: [], deliveryMode: "mailpit" } }));
  await page.route("**/api/merchant/campaigns/preview", route => route.fulfill({ json: { total: 0, eligibleCount: 0, asOf: new Date().toISOString(), deliveryMode: "mailpit", dailyQuota: 20, monthlyLocationQuota: 100, quotaRemaining: 20, excludedCountsByReason: {} } }));
  await page.route("**/api/merchant/campaigns", async route => {
    payloads.push(route.request().postDataJSON());
    if (payloads.length === 1) { started(); await hold; }
    await route.fulfill(payloads.length === 1 && failFirstSave ? { status: 500, json: { error: "Synthetic save failed" } } : { json: { id: "saved-draft-A" } });
  });
  await page.goto("/merchant/campaigns");
  await page.getByRole("button", { name: "Eigene Kampagne" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByLabel("Interner Titel").fill("Draft A");
  await page.getByLabel("Betreff").fill("Subject A");
  await page.getByLabel("Nachricht", { exact: true }).fill("Body A synthetic");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await saving;
  return { releaseSave, payloads };
}

test("save response only acknowledges submitted fields, leaving newer edits dirty and unschedulable", async ({ page }) => {
  const { releaseSave, payloads } = await composer(page);
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await page.getByLabel("Nachricht", { exact: true }).fill("Body B newer synthetic edits");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  releaseSave();
  await expect(page.getByRole("button", { name: "Entwurf aktualisieren", exact: true })).toBeEnabled();
  await page.getByLabel("Termin für den Versand").fill("2030-01-01T12:00");
  await expect(page.getByRole("button", { name: "Planen", exact: true })).toBeDisabled();
  await expect(page.getByText(/Ungespeicherte Änderungen/)).toBeVisible();
  expect(payloads[0].body).toBe("Body A synthetic");
  await page.getByRole("button", { name: "Entwurf aktualisieren", exact: true }).click();
  await expect(page.getByRole("button", { name: "Planen", exact: true })).toBeEnabled();
  expect(payloads[1]).toMatchObject({ action: "edit", campaignId: "saved-draft-A", body: "Body B newer synthetic edits" });
});

test("late save response cannot attach the previous draft identity to a new composer", async ({ page }) => {
  const { releaseSave, payloads } = await composer(page);
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.getByRole("button", { name: "Eigene Kampagne" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByLabel("Interner Titel").fill("Draft B");
  await page.getByLabel("Betreff").fill("Subject B");
  await page.getByLabel("Nachricht", { exact: true }).fill("Body B synthetic");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  releaseSave();
  await expect(page.getByRole("button", { name: "Entwurf speichern", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Termin für den Versand")).toHaveCount(0);
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({ action: "create", title: "Draft B", body: "Body B synthetic" });
});


test("failed save preserves newer edits and retry submits the current draft", async ({ page }) => {
  const { releaseSave, payloads } = await composer(page, true);
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await page.getByLabel("Nachricht", { exact: true }).fill("Body B after failed save");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  releaseSave();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic save failed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entwurf speichern", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Termin für den Versand")).toHaveCount(0);
  await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
  await expect(page.getByText("Entwurf gespeichert. Es wurde nichts versendet.")).toBeVisible();
  expect(payloads[1]).toMatchObject({ action: "create", body: "Body B after failed save" });
});

test("audience changes during saving stay unsaved until the correct audience is persisted", async ({ page }) => {
  const { releaseSave, payloads } = await composer(page);
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await page.getByLabel("Inaktiv seit mindestens (Tage)").fill("60");
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Weiter", exact: true }).click();
  releaseSave();
  await expect(page.getByRole("button", { name: "Entwurf aktualisieren", exact: true })).toBeEnabled();
  await page.getByLabel("Termin für den Versand").fill("2030-01-01T12:00");
  await expect(page.getByRole("button", { name: "Planen", exact: true })).toBeDisabled();
  expect(payloads[0].audienceDefinition).toEqual({ kind: "inactive", daysSinceLast: 30 });
  await page.getByRole("button", { name: "Entwurf aktualisieren", exact: true }).click();
  await expect(page.getByRole("button", { name: "Planen", exact: true })).toBeEnabled();
  expect(payloads[1].audienceDefinition).toEqual({ kind: "inactive", daysSinceLast: 60 });
});
