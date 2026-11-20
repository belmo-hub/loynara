import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("owner manages the saved reward catalogue in the merchant browser", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    const signedUp = await owner.post("/api/auth/sign-up/email", { headers: { "x-loynara-acceptance": "2026-11-20" }, data: { name: "Synthetic reward owner", email: `catalogue-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } });
    expect(signedUp.status()).toBe(200);
    const onboard = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Synthetic Catalogue Café", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Kaffeestempel", programType: "stamp", rulesText: "Ein Stempel je bestätigtem Besuch an der Kasse.", rewardTitle: "Kaffee", rewardCost: 5,
    } });
    expect(onboard.status()).toBe(201);
    const { programSlug } = await onboard.json() as { programSlug: string };
    const browserContext = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const page = await browserContext.newPage();
      await page.goto("/merchant/program");
      await page.getByRole("link", { name: "Prämie hinzufügen" }).click();
      await expect(page.getByRole("heading", { name: "Wie heißt die neue Prämie?" })).toBeVisible();
      await page.getByLabel("Name der Prämie").fill("Torte");
      await page.getByRole("button", { name: "Weiter" }).click();
      await page.getByLabel("Einlösbar ab").fill("8");
      await page.getByRole("button", { name: "Weiter" }).click();
      await expect(page.locator(".ow-cardline-reward")).toHaveCount(2); // the card preview: Kaffee, then the new Torte
      await page.getByRole("button", { name: "Prämie speichern" }).click();
      // Saved: back on the Programm list, where the new reward is a row of its own.
      await expect(page.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible();
      await page.getByRole("link", { name: "Reihenfolge ändern" }).click();
      await expect(page.locator(".ow-reward")).toHaveCount(2);
      await page.getByRole("button", { name: "Torte nach oben" }).click();
      await expect(page.locator(".ow-reward").first()).toContainText("Torte");
      const rewards = async () => (await (await owner.get(`/api/program/${encodeURIComponent(programSlug)}`)).json() as { rewards: Array<{ title: string; endsOn?: string | null }> }).rewards;
      expect((await rewards()).map(row => row.title)).toEqual(["Torte", "Kaffee"]);

      // A better name applies at once (ENG-100 46–47); nothing is preselected, so the save waits for the owner's answer.
      await page.goto("/merchant/program");
      await page.getByRole("link", { name: /^Torte/ }).click();
      await page.getByRole("button", { name: "Name ändern" }).click();
      await page.getByLabel("Name der Prämie").fill("Apfeltorte");
      await page.getByRole("button", { name: "Weiter" }).click();
      await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
      await page.getByText("Besser oder gleich").click();
      await page.getByRole("button", { name: "Speichern" }).click();
      await expect(page.getByRole("link", { name: /^Apfeltorte/ })).toBeVisible();

      // A lower cost applies at once (26): no date, no chip.
      await page.getByRole("link", { name: /^Apfeltorte/ }).click();
      await page.getByText("6 Stempel", { exact: true }).click();
      await expect(page.getByText("Gilt ab dem Speichern für alle Karten.")).toBeVisible();
      await page.getByRole("button", { name: "Speichern" }).click();
      await expect(page.getByRole("link", { name: /^Apfeltorte/ })).toContainText("Einlösbar ab 6 Stempeln");

      // An archive is dated (30): the reward stays on the join page and the counter until its date, with a chip on the list.
      await page.getByRole("link", { name: /^Kaffee/ }).click();
      await page.getByRole("button", { name: "Prämie archivieren" }).click();
      await expect(page.getByText("Gilt ab", { exact: false }).first()).toBeVisible();
      await page.getByRole("button", { name: "Archivieren" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Kaffee wird am" })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Kaffee/ })).toContainText(/Ab \d+\.\d+\. archiviert/);
      expect((await rewards()).map(row => [row.title, Boolean(row.endsOn)])).toEqual([["Apfeltorte", false], ["Kaffee", true]]);
    } finally { await browserContext.close(); }
  } finally { await owner.dispose(); }
});
