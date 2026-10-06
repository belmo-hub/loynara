import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("owner configures bounded local automation rules through the merchant page", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    const email = `automation-owner-${randomUUID()}@example.test`;
    expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic automation owner", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const onboard = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Synthetic Automation Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Synthetic card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5,
    } });
    expect(onboard.status()).toBe(201);
    const { programSlug } = await onboard.json() as { programSlug: string };
    expect((await guest.get(`/api/merchant/automations?programSlug=${encodeURIComponent(programSlug)}`)).status()).toBe(401);
    const ownerBrowser = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const page = await ownerBrowser.newPage();
      await page.goto("/merchant");
      await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Aktionen", exact: true }).click();
      await page.getByRole("navigation", { name: "Aktionen – Unterseiten" }).getByRole("link", { name: "Automationen", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Automationen", exact: true })).toBeVisible();
      await expect(page.getByText("Noch keine Ausführungen. Neue Regeln sind zunächst deaktiviert.")).toBeVisible();
      const first = page.getByRole("heading", { name: "Willkommen nach dem ersten Einkauf" }).locator("..");
      await first.getByLabel("Betreff").fill("Synthetischer Erstkontakt");
      await first.getByLabel("Tageslimit je Regel").fill("2");
      await first.getByLabel("Regel aktivieren").check();
      await first.getByRole("button", { name: "Regel speichern" }).click();
      await expect(first.getByText("Regel gespeichert.", { exact: false })).toBeVisible();
      const list = await owner.get(`/api/merchant/automations?programSlug=${encodeURIComponent(programSlug)}`);
      expect(list.status()).toBe(200);
      expect(list.headers()["cache-control"]).toBe("no-store");
      const result = await list.json() as { localOnly: boolean; rules: Array<{ triggerKind: string; subject: string; dailyCap: number; enabled: boolean }>; runs: unknown[] };
      expect(result).toMatchObject({ localOnly: true, rules: [{ triggerKind: "first_checkout", subject: "Synthetischer Erstkontakt", dailyCap: 2, enabled: true }], runs: [] });
      await page.screenshot({ path: "screenshots/platform-after-automations.png", fullPage: true });
    } finally { await ownerBrowser.close(); }
  } finally { await Promise.all([owner.dispose(), guest.dispose()]); }
});
