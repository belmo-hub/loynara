import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";
import { Pool } from "pg";
import { formatCardLocator } from "../src/lib/card-locator";

import { resetPeerLimitsWith } from "./nfc-support";
import { signUp } from "./support/sign-up";

// Its own pool: CI runs the owner specs in one worker, where ending a shared pool breaks the files after this one.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ENG-372 (founder Q-116 c): the owner enters a caller's appointment from the day view, only for a card found by number.
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Local disposable database required");
// The config's server (CI runs these on its own port); E2E_BASE_URL only for a server started by hand.
if (process.env.E2E_BASE_URL) test.use({ baseURL: process.env.E2E_BASE_URL });
// CI runs every owner spec through one peer: these sign-ups must not use up the 15 the later files need (as the NFC specs do).
const resetPeerLimits = () => resetPeerLimitsWith((text, params) => pool.query(text, params));
test.beforeEach(async () => { await resetPeerLimits(); });
test.afterAll(async () => { await resetPeerLimits(); await pool.end(); });
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
    services: [{ name: "Haarschnitt", durationMin: 30, priceMinor: 2500 }], staff: [{ name: "Lena", workingHours: hours }, { name: "Mia", workingHours: hours }] } })).status()).toBe(200);
  const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken: string };
  const number = formatCardLocator((await pool.query("SELECT card_locator FROM memberships WHERE card_token = $1", [cardToken])).rows[0].card_locator);

  const day = new Date(); day.setUTCDate(day.getUTCDate() + 2);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(day);
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport, hasTouch: viewport.width < 768 });
  const page = await context.newPage();
  // From today's view, for a day two days ahead: afterwards the view opens that day (Design, 24 Nov).
  await page.goto("/merchant/termine");
  await page.getByRole("button", { name: "Termin eintragen" }).click();
  const dialog = page.getByRole("dialog", { name: "Termin eintragen" });
  const field = dialog.getByLabel("Kartennummer");
  await expect(field).toBeFocused();
  // A name is no card: nothing is found and nothing booked.
  await field.fill("Mia Muster");
  await dialog.getByRole("button", { name: "Karte suchen" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Diese Kartennummer gibt es hier nicht. Termine trägst du nur für Kunden mit Karte ein.");
  // The refusal is in the error colour, not the hint grey, and focus is back on the field.
  expect(await dialog.getByRole("alert").evaluate(element => getComputedStyle(element).color)).not.toBe(await dialog.getByText("Frag nach der Kartennummer. Sie steht auf der Karte unter dem QR-Code.").evaluate(element => getComputedStyle(element).color));
  await expect(field).toBeFocused();
  await field.fill(number.toLowerCase());
  await field.press("Enter");
  await expect(dialog.getByText(`Karte ${number}`)).toBeVisible();
  await expect(dialog.getByLabel("Name")).toBeFocused();
  // „Andere Karte“ goes back to the number, and the same number comes back to this step.
  await dialog.getByRole("button", { name: "Andere Karte" }).click();
  await expect(field).toBeFocused();
  await field.press("Enter");
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await expect(dialog.getByLabel("Telefon")).toHaveCount(0);
  await dialog.getByLabel("Tag").fill(date);
  // Two people work: a choice before the times, so the list is one person's (Design, 24 Nov).
  const who = dialog.getByRole("group", { name: "Bei" });
  await expect(who.getByRole("button", { name: "Alle" })).toHaveAttribute("aria-pressed", "true");
  await who.getByRole("button", { name: "Lena" }).click();
  await expect(who.getByRole("button", { name: "Lena" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("group", { name: "Freie Zeiten" }).getByRole("button", { name: /Mia/ })).toHaveCount(0);
  await dialog.getByLabel("Name").fill("Jonas");
  const slot = dialog.getByRole("group", { name: "Freie Zeiten" }).getByRole("button").nth(8);
  const time = (await slot.textContent())!.trim();
  await slot.click();
  const shortDay = `${new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).replace(".", "")} ${date.slice(8, 10)}.${date.slice(5, 7)}.`;
  const primary = dialog.getByRole("button", { name: `${shortDay}, ${time} Uhr bei Lena eintragen` });
  await expect(primary).toBeInViewport({ ratio: 1 });
  // Design r2: at 200 % text the button says „Eintragen“ and a summary line above it names when and with whom.
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(dialog.getByRole("button", { name: "Eintragen", exact: true })).toBeVisible();
  await expect(dialog.getByText(`${shortDay}, ${time} Uhr bei Lena`, { exact: true })).toBeInViewport({ ratio: 1 });
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth === innerWidth)).toBe(true);
  await primary.click();
  const longDay = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const flash = page.getByRole("status").filter({ hasText: `Jonas: ${longDay}, ${time} Uhr bei Lena eingetragen.` });
  await expect(flash).toBeVisible();
  // After the jump focus is on the message, not on the page body (Design r2).
  expect(await flash.evaluate(element => element.parentElement === document.activeElement)).toBe(true);
  await expect(page).toHaveURL(new RegExp(`date=${date}$`));
  await expect(page.getByRole("button", { name: new RegExp(`${time}.*Haarschnitt`) })).toContainText("Jonas bei Lena");
  expect((await pool.query("SELECT status, customer_name, customer_phone FROM booking_appointments a JOIN memberships m ON m.id = a.membership_id WHERE m.card_token = $1", [cardToken])).rows)
    .toEqual([{ status: "confirmed", customer_name: "Jonas", customer_phone: null }]);
  // Design r2: the title row never runs past the edge. At 320 on a Thursday, and at 390 with 200 % text, „Einrichtung“ is the gear
  // alone (name kept, 44 px), the date has its own line, and nothing scrolls sideways.
  const thursday = (() => { let d = date; for (let i = 0; i < 7 && new Date(`${d}T12:00:00Z`).getUTCDay() !== 4; i++) d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10); return d; })();
  for (const [width, size] of [[320, ""], [390, "200%"]] as const) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto(`/merchant/termine?date=${thursday}`);
    await page.evaluate(fontSize => { document.documentElement.style.fontSize = fontSize; }, size);
    const gear = page.getByRole("link", { name: "Einrichtung" });
    await expect(gear).toBeVisible();
    expect(await gear.evaluate(element => { const box = element.getBoundingClientRect(); return box.width >= 44 && box.height >= 44 && box.right <= innerWidth && (element.querySelector(".ow-dayhead-label") as HTMLElement).offsetParent === null; })).toBe(true);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth === innerWidth)).toBe(true);
  }
  await context.close(); await owner.dispose(); await guest.dispose();
});
