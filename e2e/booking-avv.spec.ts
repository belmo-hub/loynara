import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";
import { pool } from "../src/db";
import { OWNER_AVV, SIGNUP_ACCEPTANCE_HEADER } from "../src/lib/owner-contract";
import { signUp } from "./support/sign-up";

// ENG-339: a shop that signed the older AVV Fassung accepts the one with Terminbuchung under Einstellungen › Geschäft.
test.afterAll(async () => { await pool.end(); });
test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" });

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) test(`${viewport.width}: the owner opens „Auftragsverarbeitung mit Terminbuchung“, accepts it, and the row says when`, async ({ browser, baseURL }) => {
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
  const row = page.getByRole("button", { name: /Auftragsverarbeitung mit Terminbuchung/ });
  await expect(row).toContainText(`Fassung vom ${OWNER_AVV.stand}`);
  await expect(row).toContainText("Offen");
  await row.click();
  const dialog = page.getByRole("dialog", { name: "Auftragsverarbeitung annehmen?" });
  await expect(dialog.getByRole("link", { name: `Vertrag zur Auftragsverarbeitung, Fassung vom ${OWNER_AVV.stand}` })).toHaveAttribute("href", "/avv");
  // Abbrechen writes nothing.
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await pool.query("SELECT count(*)::int AS n FROM owner_acceptances WHERE user_id = $1 AND path = 'booking'", [id])).rows[0].n).toBe(0);

  await row.click();
  await page.getByRole("dialog").getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Angenommen. Loynara kann Online-Termine jetzt für dein Geschäft einschalten." })).toBeVisible();
  await expect(page.getByText(/Fassung vom .* · angenommen am /)).toBeVisible();
  expect((await pool.query("SELECT count(*)::int AS n FROM owner_acceptances WHERE user_id = $1 AND path = 'booking' AND avv_version = $2", [id, OWNER_AVV.version])).rows[0].n).toBe(1);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth === innerWidth)).toBe(true);

  // After a reload the row stays answered and opens nothing.
  await page.reload();
  await expect(page.getByText(/Fassung vom .* · angenommen am /)).toBeVisible();
  await expect(page.getByRole("button", { name: /Auftragsverarbeitung mit Terminbuchung/ })).toHaveCount(0);
  await context.close(); await owner.dispose();
});
