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
      await expect(page.getByRole("heading", { name: "Prämien", exact: true })).toBeVisible();
      await expect(page.locator(".ow-reward")).toHaveCount(1);
      await page.getByRole("button", { name: "Prämie hinzufügen", exact: true }).click();
      await page.getByLabel("Name der Prämie").fill("Torte");
      await page.getByLabel("Preis in Stempeln").fill("8");
      await page.getByRole("button", { name: "Prämie hinzufügen", exact: true }).click();
      await expect(page.locator(".ow-reward")).toHaveCount(2);
      await expect(page.locator("section[aria-labelledby=rew-title]").getByText("Prämie hinzugefügt.")).toBeVisible();

      await page.getByRole("button", { name: "Torte nach oben" }).click();
      await expect(page.locator(".ow-reward").first()).toContainText("Torte");
      const publicAfterOrder = await owner.get(`/api/program/${encodeURIComponent(programSlug)}`);
      expect(publicAfterOrder.status()).toBe(200);
      expect((await publicAfterOrder.json() as { rewards: Array<{ title: string }> }).rewards.map(row => row.title)).toEqual(["Torte", "Kaffee"]);

      await page.locator(".ow-reward").filter({ hasText: "Torte" }).getByRole("button", { name: "Bearbeiten" }).click();
      await page.getByLabel("Name der Prämie").fill("Apfeltorte");
      await expect(page.getByText("Das ändert sich beim Speichern")).toBeVisible();
      await page.getByRole("button", { name: "Prämienversion speichern" }).click();
      await expect(page.locator(".ow-reward").first()).toContainText("Apfeltorte");

      await page.locator(".ow-reward").filter({ hasText: "Kaffee" }).getByRole("button", { name: "Archivieren" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Archivieren" }).click();
      await expect(page.locator(".ow-reward")).toHaveCount(1);
      await expect(page.locator(".ow-reward").first()).toContainText("Apfeltorte");
      const publicAfterArchive = await owner.get(`/api/program/${encodeURIComponent(programSlug)}`);
      expect((await publicAfterArchive.json() as { rewards: Array<{ title: string }> }).rewards.map(row => row.title)).toEqual(["Apfeltorte"]);
    } finally { await browserContext.close(); }
  } finally { await owner.dispose(); }
});
