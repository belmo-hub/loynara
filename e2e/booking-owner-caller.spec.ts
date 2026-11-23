import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";
import { Pool } from "pg";
import { formatCardLocator } from "../src/lib/card-locator";

// Its own pool: CI runs the owner specs in one worker, where ending a shared pool breaks the files after this one.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
import { signUp } from "./support/sign-up";

// ENG-372 (founder Q-116 c): the owner enters a caller's appointment from the day view, only for a card found by number.
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Local disposable database required");
// The config's server (CI runs these on its own port); E2E_BASE_URL only for a server started by hand.
if (process.env.E2E_BASE_URL) test.use({ baseURL: process.env.E2E_BASE_URL });
test.afterAll(async () => { await pool.end(); });
const hours = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, start: "06:00", end: "22:00", breaks: [] }));

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) test(`${viewport.width}: „Termin eintragen“ finds the card by its number, offers free times and books the caller`, async ({ browser, baseURL }) => {
  const origin = { Origin: new URL(baseURL!).origin };
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin }), guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin });
  const ownerEmail = `caller-owner-${randomUUID()}@example.test`;
  expect((await signUp(owner, { data: { name: "Synthetic salon owner", email: ownerEmail, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  await pool.query('UPDATE "user" SET "emailVerified" = true WHERE email = $1', [ownerEmail]);
  const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Salon", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", rulesText: "Synthetic rules.", rewardTitle: "Kaffee", programName: "Synthetic", programType: "stamp", rewardCost: 10 } });
  const { programSlug } = await setup.json() as { programSlug: string };
  await pool.query("INSERT INTO booking_settings (tenant_id, location_id, enabled) SELECT tenant_id, location_id, true FROM programs WHERE slug = $1", [programSlug]);
  expect((await owner.put("/api/merchant/booking/setup", { data: {
    settings: { shopType: "barber", leadTimeMin: 0, maxDaysAhead: 42, cancelDeadlineHours: 0, maxReschedulesPerMonth: 2, autoConfirm: false, noShowBlockAfter: 3, maxOpenPerCard: 2 },
    services: [{ name: "Haarschnitt", durationMin: 30, priceMinor: 2500 }], staff: [{ name: "Lena", workingHours: hours }] } })).status()).toBe(200);
  const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken: string };
  const number = formatCardLocator((await pool.query("SELECT card_locator FROM memberships WHERE card_token = $1", [cardToken])).rows[0].card_locator);

  const day = new Date(); day.setUTCDate(day.getUTCDate() + 2);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(day);
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport, hasTouch: viewport.width < 768 });
  const page = await context.newPage();
  await page.goto(`/merchant/termine?date=${date}`);
  await page.getByRole("button", { name: "Termin eintragen" }).click();
  const dialog = page.getByRole("dialog", { name: "Termin eintragen" });
  const field = dialog.getByLabel("Kartennummer");
  await expect(field).toBeFocused();
  // A name is no card: nothing is found and nothing booked.
  await field.fill("Mia Muster");
  await dialog.getByRole("button", { name: "Karte suchen" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Diese Kartennummer gibt es hier nicht. Termine trägst du nur für Kunden mit Karte ein.");
  await field.fill(number.toLowerCase());
  await field.press("Enter");
  await expect(dialog.getByText(`Karte ${number}`)).toBeVisible();
  await expect(dialog.getByLabel("Telefon")).toHaveCount(0);
  await dialog.getByLabel("Name").fill("Jonas");
  const slot = dialog.getByRole("group", { name: "Freie Zeiten" }).getByRole("button").nth(8);
  const time = (await slot.textContent())!.trim();
  await slot.click();
  const primary = dialog.getByRole("button", { name: `Für ${time} Uhr eintragen` });
  await expect(primary).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth === innerWidth)).toBe(true);
  await primary.click();
  await expect(page.getByRole("status").filter({ hasText: `Jonas: ${time} Uhr eingetragen.` })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`${time}.*Haarschnitt`) })).toContainText("Jonas bei Lena");
  expect((await pool.query("SELECT status, customer_name, customer_phone FROM booking_appointments a JOIN memberships m ON m.id = a.membership_id WHERE m.card_token = $1", [cardToken])).rows)
    .toEqual([{ status: "confirmed", customer_name: "Jonas", customer_phone: null }]);
  await context.close(); await owner.dispose(); await guest.dispose();
});
