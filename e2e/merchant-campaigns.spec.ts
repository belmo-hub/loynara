import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("owner previews an audience and saves a campaign draft without claiming delivery", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    const email = `campaign-owner-${randomUUID()}@example.test`;
    expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic campaign owner", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const onboard = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Synthetic Campaign Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Synthetic campaign card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5,
    } });
    expect(onboard.status()).toBe(201);
    const { programSlug } = await onboard.json() as { programSlug: string };
    const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
    try { expect((await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } })).status()).toBe(201); }
    finally { await guest.dispose(); }

    const ownerBrowser = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const page = await ownerBrowser.newPage();
      await page.goto("/merchant/campaigns");
      await expect(page.getByRole("heading", { name: "Kampagnen", level: 1 })).toBeVisible();
      // Goal shortcuts feed the same builder; nothing is sent or scheduled automatically.
      await expect(page.getByRole("button", { name: /Kunden zurückholen/ })).toBeVisible();
      await page.getByRole("button", { name: "Eigene Kampagne" }).click();

      await page.getByLabel("Zielgruppe", { exact: true }).selectOption("new");
      await page.getByRole("button", { name: "Zielgruppe prüfen" }).click();
      await expect(page.getByText(/1 Karte, davon 0 per E-Mail erreichbar/)).toBeVisible();
      await page.getByRole("button", { name: "Weiter", exact: true }).click();

      await page.getByLabel("Interner Titel").fill("Synthetische Testaktion");
      await page.getByLabel("Betreff").fill("Nur ein Test");
      await page.getByLabel("Nachricht", { exact: true }).fill("Dies ist eine lokale synthetische Kampagnenvorschau.");
      await page.getByRole("button", { name: "Weiter", exact: true }).click();

      await expect(page.getByRole("heading", { name: "Prüfen & speichern" })).toBeVisible();
      await expect(page.getByText("Keine bestätigte E-Mail-Adresse")).toBeVisible();
      await page.getByRole("button", { name: "Entwurf speichern" }).click();
      await expect(page.getByText("Entwurf gespeichert. Es wurde nichts versendet.")).toBeVisible();
      await page.getByRole("button", { name: "Zur Kampagnenliste" }).click();
      await expect(page.getByText("Synthetische Testaktion")).toBeVisible();
      await expect(page.getByText("Entwurf", { exact: true })).toBeVisible();
      await expect(page.getByText("Gesendet", { exact: true })).toHaveCount(0);

      await page.getByRole("button", { name: "Bearbeiten" }).click();
      await page.getByRole("button", { name: "Zurück", exact: true }).click();
      await page.getByLabel("Interner Titel").fill("Bearbeitete Testaktion");
      await page.getByRole("button", { name: "Weiter", exact: true }).click();
      await page.getByRole("button", { name: "Entwurf aktualisieren" }).click();
      await expect(page.getByText("Entwurf gespeichert. Es wurde nichts versendet.")).toBeVisible();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
      await page.getByLabel("Termin für den Versand").fill(tomorrow);
      await page.getByRole("button", { name: "Planen", exact: true }).click();
      await expect(page.getByText("Bearbeitete Testaktion")).toBeVisible();
      await expect(page.getByText("Geplant", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Pausieren" }).click();
      await expect(page.getByText("Pausiert", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Abbrechen" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Kampagne abbrechen" }).click();
      await expect(page.getByText("Abgebrochen", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Details" }).click();
      await expect(page.getByText("Noch keine Zustellversuche.")).toBeVisible();
      await expect(page.getByText("Unterdrückt", { exact: true })).toBeVisible();
      await expect(page.getByText("Fehlgeschlagen", { exact: true })).toBeVisible();
    } finally { await ownerBrowser.close(); }
  } finally { await owner.dispose(); }
});
