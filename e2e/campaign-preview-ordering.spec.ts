import { expect, test } from "@playwright/test";

for (const scenario of [
  { name: "superseded audience success", anotherComposer: false, failOld: false },
  { name: "superseded audience error", anotherComposer: false, failOld: true },
  { name: "abandoned composer success", anotherComposer: true, failOld: false },
  { name: "current failure then successful retry", anotherComposer: false, failOld: false, failCurrent: true },
]) {
  test(`preview ignores ${scenario.name} after current audience B succeeds`, async ({ page }) => {
    let releaseOld!: () => void;
    let started!: () => void;
    const oldStarted = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { releaseOld = resolve; });
    let savedAudience: unknown;
    let currentCalls = 0;
    const preview = (count: number) => ({ total: count, eligibleCount: count, asOf: new Date().toISOString(), deliveryMode: "disabled", dailyQuota: 20, monthlyLocationQuota: 100, quotaRemaining: 20, excludedCountsByReason: {} });
    await page.route("**/api/me", route => route.fulfill({ json: { userId: "synthetic-owner", tenantId: "synthetic-tenant", role: "owner", locationId: "synthetic-location", locationName: "Berlin", businessName: "Synthetic Café", programSlug: "synthetic", programType: "stamp", hiddenSurfaces: [] } }));
    await page.route("**/api/merchant/locations", route => route.fulfill({ json: { locations: [] } }));
    await page.route("**/api/program/synthetic", route => route.fulfill({ json: { rewards: [] } }));
    await page.route("**/api/merchant/campaigns?*", route => route.fulfill({ json: { campaigns: [], deliveryMode: "disabled" } }));
    await page.route("**/api/merchant/campaigns", route => { savedAudience = route.request().postDataJSON().audienceDefinition; return route.fulfill({ json: { id: "synthetic-draft-B" } }); });
    await page.route("**/api/merchant/campaigns/preview", async route => {
      const audience = route.request().postDataJSON().audienceDefinition;
      if (audience.kind === "inactive" && audience.daysSinceLast === 30) {
        started(); await hold;
        await route.fulfill(scenario.failOld ? { status: 500, json: { error: "Synthetic obsolete preview error" } } : { json: preview(99) });
      } else {
        currentCalls++;
        await route.fulfill("failCurrent" in scenario && scenario.failCurrent && currentCalls === 1 ? { status: 500, json: { error: "Synthetic current preview failure" } } : { json: preview(2) });
      }
    });
    await page.goto("/merchant/campaigns");
    await page.getByRole("button", { name: "Eigene Kampagne" }).click();
    await page.getByRole("button", { name: "Zielgruppe prüfen" }).click();
    await oldStarted;
    if (scenario.anotherComposer) {
      await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await page.getByRole("button", { name: "Eigene Kampagne" }).click();
      await page.getByLabel("Zielgruppe", { exact: true }).selectOption("new");
    } else await page.getByLabel("Inaktiv seit mindestens (Tage)").fill("60");
    await page.getByRole("button", { name: "Zielgruppe prüfen" }).click();
    if ("failCurrent" in scenario && scenario.failCurrent) {
      await expect(page.getByText("Synthetic current preview failure", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Zielgruppe prüfen" }).click();
    }
    await expect(page.getByText(/2 Karten, davon 2 per E-Mail erreichbar/)).toBeVisible();
    const oldResponse = page.waitForResponse(response => response.url().endsWith("/campaigns/preview") && response.request().postDataJSON().audienceDefinition.daysSinceLast === 30);
    releaseOld();
    await (await oldResponse).finished();
    // Flush browser rendering after the controlled obsolete response has completed, without a fixed sleep.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.soft(page.getByText(/2 Karten, davon 2 per E-Mail erreichbar/)).toBeVisible();
    await expect.soft(page.getByText("Synthetic obsolete preview error", { exact: true })).toHaveCount(0);
    await expect.soft(page.getByText(/99 Karten/)).toHaveCount(0);
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await page.getByLabel("Interner Titel").fill("Synthetic B");
    await page.getByLabel("Betreff").fill("Synthetic subject B");
    await page.getByLabel("Nachricht", { exact: true }).fill("Synthetic body B");
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await page.getByRole("button", { name: "Entwurf speichern", exact: true }).click();
    await expect(page.getByText("Entwurf gespeichert. Es wurde nichts versendet.")).toBeVisible();
    expect(savedAudience).toEqual(scenario.anotherComposer ? { kind: "new", withinDays: 30 } : { kind: "inactive", daysSinceLast: 60 });
    await expect(page.getByRole("button", { name: "Planen", exact: true })).toHaveCount(0);
  });
}
