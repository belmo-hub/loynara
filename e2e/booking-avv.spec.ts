import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";
import { Pool } from "pg";
import { OWNER_AVV, OWNER_TERMS, SIGNUP_ACCEPTANCE_HEADER } from "../src/lib/owner-contract";

import { resetPeerLimitsWith } from "./nfc-support";
import { signUp } from "./support/sign-up";

// Its own pool: CI runs the owner specs in one worker, where ending a shared pool breaks the files after this one.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ENG-339: a shop on the older Fassungen accepts the terms and the AVV with „Termin + Treue“ under Einstellungen › Geschäft.
// CI runs every owner spec through one peer: these sign-ups must not use up the 15 the later files need (as the NFC specs do).
const resetPeerLimits = () => resetPeerLimitsWith((text, params) => pool.query(text, params));
test.beforeEach(async () => { await resetPeerLimits(); });
test.afterAll(async () => { await resetPeerLimits(); await pool.end(); });
// The config's server (CI runs these on its own port); E2E_BASE_URL only for a server started by hand.
if (process.env.E2E_BASE_URL) test.use({ baseURL: process.env.E2E_BASE_URL });

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) test(`${viewport.width}: the owner opens „Termin + Treue“, accepts terms and AVV at the shown price, and the row says when`, async ({ browser, baseURL }) => {
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL!).origin } });
  const email = `avv-owner-${randomUUID()}@example.test`;
  // No sentence shown: the account gets the older Fassung's row below, as a shop from before 29 Nov has.
  const signed = await signUp(owner, { headers: { [SIGNUP_ACCEPTANCE_HEADER]: "" }, data: { name: "Synthetic salon owner", email, password: `Local!${randomUUID()}Aa` } });
  expect(signed.status()).toBe(200);
  const { id } = (await signed.json()).user as { id: string };
  await pool.query('UPDATE "user" SET "emailVerified" = true WHERE id = $1', [id]);
  await pool.query("INSERT INTO owner_acceptances (user_id, terms_version, avv_version, privacy_version, text_version) VALUES ($1, '2026-11-20', '2026-11-20', '2026-11-20', '2026-11-20')", [id]);
  expect((await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Salon", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", rulesText: "Synthetic rules.", rewardTitle: "Schnitt", programName: "Synthetic", programType: "stamp", rewardCost: 10 } })).status()).toBe(201);

  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport, hasTouch: viewport.width < 768 });
  const page = await context.newPage();
  await page.goto("/merchant/settings");
  const row = page.getByRole("button", { name: /^Termin\s\+\sTreue/ });
  // Legal § 6: optional for every owner, no warning chip.
  await expect(row).toContainText("Optional: Vertragsbedingungen und Auftragsverarbeitung für Online-Termine. Annehmen kostet nichts.");
  await expect(row).not.toContainText("Offen");
  await row.click();
  const dialog = page.getByRole("dialog", { name: /^Verträge für Termin\s\+\sTreue annehmen\?$/ });
  // Legal § 5: the price before the button, both documents linked.
  await expect(dialog.getByText("69 € statt 49 € je Standort und Monat, nur für Standorte mit Termin + Treue.", { exact: true })).toBeVisible();
  await expect(dialog).toContainText(`Annehmen kostet nichts.69 € statt 49 € je Standort und Monat, nur für Standorte mit Termin + Treue.Loynara schaltet Termin + Treue nur auf deinen Wunsch für einzelne Standorte ein; erst ab dann gilt dort der neue Preis. Es gelten die Vertragsbedingungen, Fassung vom ${OWNER_TERMS.stand}, und der Vertrag zur Auftragsverarbeitung, Fassung vom ${OWNER_AVV.stand}. Mit Online-Terminen verarbeitet Loynara für dich auch Namen und Telefonnummern deiner Kundschaft.`);
  await expect(dialog.getByRole("link", { name: `Vertragsbedingungen, Fassung vom ${OWNER_TERMS.stand}` })).toHaveAttribute("href", "/vertragsbedingungen");
  await expect(dialog.getByRole("link", { name: `Vertrag zur Auftragsverarbeitung, Fassung vom ${OWNER_AVV.stand}` })).toHaveAttribute("href", "/avv");
  // Design r2: at 200 % text the links and their commas stay inside the dialog.
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await dialog.evaluate(box => { const edge = box.getBoundingClientRect().right; return [...box.querySelectorAll("p")].every(p => p.scrollWidth <= p.clientWidth + 1 && p.getBoundingClientRect().right <= edge + 1); })).toBe(true);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  // Abbrechen writes nothing.
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await pool.query("SELECT count(*)::int AS n FROM owner_acceptances WHERE user_id = $1 AND path = 'booking'", [id])).rows[0].n).toBe(0);

  await row.click();
  await page.getByRole("dialog").getByRole("button", { name: "Annehmen" }).click();
  const outcome = page.getByRole("status").filter({ hasText: /^Angenommen\. Schreib uns an support@getloynara\.com, für welchen Standort du Termin\s\+\sTreue möchtest\./ });
  await expect(outcome).toBeVisible();
  // Design (24 Nov): focus lands on the outcome, not on the page body.
  await expect(outcome).toBeFocused();
  await expect(page.getByText(`angenommen am`).first()).toContainText(`Fassung vom ${OWNER_TERMS.stand}`);
  await expect(page.getByText(/Vertragsbedingungen und Auftragsverarbeitung · angenommen am /)).toBeVisible();
  expect((await pool.query("SELECT count(*)::int AS n FROM owner_acceptances WHERE user_id = $1 AND path = 'booking' AND avv_version = $2 AND terms_version = $3", [id, OWNER_AVV.version, OWNER_TERMS.version])).rows[0].n).toBe(1);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth === innerWidth)).toBe(true);

  // After a reload the row stays answered and opens nothing.
  await page.reload();
  await expect(page.getByText(/Vertragsbedingungen und Auftragsverarbeitung · angenommen am /)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Termin\s\+\sTreue/ })).toHaveCount(0);
  // The answered row links both documents.
  await expect(page.getByRole("link", { name: "Vertragsbedingungen", exact: true })).toHaveAttribute("href", "/vertragsbedingungen");
  await expect(page.getByRole("link", { name: "Auftragsverarbeitung", exact: true })).toHaveAttribute("href", "/avv");
  await context.close(); await owner.dispose();
});
