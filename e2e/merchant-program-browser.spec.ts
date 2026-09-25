import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("owner manages the saved reward catalogue in the merchant browser", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    const signedUp = await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic reward owner", email: `catalogue-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } });
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
      await expect(page.getByRole("heading", { name: "Prämien verwalten" })).toBeVisible();
      await expect(page.locator(".reward-manager-row")).toHaveCount(1);
      await page.getByLabel("Prämientitel").fill("Torte");
      await page.getByLabel("Benötigte Stempel").fill("8");
      await page.getByRole("button", { name: "Prämie hinzufügen", exact: true }).click();
      await expect(page.locator(".reward-manager-row")).toHaveCount(2);
      await expect(page.getByText("Prämie hinzugefügt.")).toBeVisible();

      await page.getByRole("button", { name: "Torte nach oben" }).click();
      await expect(page.locator(".reward-manager-row").first()).toContainText("Torte");
      const publicAfterOrder = await owner.get(`/api/program/${encodeURIComponent(programSlug)}`);
      expect(publicAfterOrder.status()).toBe(200);
      expect((await publicAfterOrder.json() as { rewards: Array<{ title: string }> }).rewards.map(row => row.title)).toEqual(["Torte", "Kaffee"]);

      await page.locator(".reward-manager-row").filter({ hasText: "Torte" }).getByRole("button", { name: "Prämie bearbeiten" }).click();
      await page.getByLabel("Prämientitel").fill("Apfeltorte");
      await page.getByRole("button", { name: "Neue Prämienversion speichern" }).click();
      await expect(page.locator(".reward-manager-row").first()).toContainText("Apfeltorte");

      await page.locator(".reward-manager-row").filter({ hasText: "Kaffee" }).getByRole("button", { name: "Prämie archivieren" }).click();
      await page.getByRole("button", { name: "Archivierung bestätigen" }).click();
      await expect(page.locator(".reward-manager-row")).toHaveCount(1);
      await expect(page.locator(".reward-manager-row").first()).toContainText("Apfeltorte");
      const publicAfterArchive = await owner.get(`/api/program/${encodeURIComponent(programSlug)}`);
      expect((await publicAfterArchive.json() as { rewards: Array<{ title: string }> }).rewards.map(row => row.title)).toEqual(["Apfeltorte"]);
    } finally { await browserContext.close(); }
  } finally { await owner.dispose(); }
});
