import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { pool } from "../src/db";
import { signUp } from "./support/sign-up";

// Design blocker 2 (22 Nov): at the till the booked appointment is in what the cashier sees first, never under the award
// dock, and a visit the owner already finished warns at the top and asks before even one stamp. 390x844, as measured.
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Local disposable database required");
test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", viewport: { width: 390, height: 844 }, hasTouch: true });
test.afterAll(async () => { await pool.end(); });

const hours = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, start: "00:00", end: "24:00", breaks: [] }));
/** The next quarter hour: inside the award window, and bookable with no lead time. */
const nextQuarter = () => new Date(Math.ceil((Date.now() + 60_000) / 900_000) * 900_000);

async function shopWithAppointment(baseURL: string, done: boolean) {
  const origin = { Origin: new URL(baseURL).origin };
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin }), guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin });
  const ownerEmail = `till-owner-${randomUUID()}@example.test`;
  expect((await signUp(owner, { data: { name: "Synthetic booking owner", email: ownerEmail, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  // railway-rc asks a new owner to confirm the address before the owner screens open.
  await pool.query('UPDATE "user" SET "emailVerified" = true WHERE email = $1', [ownerEmail]);
  const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Studio", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", rulesText: "Synthetic rules.", rewardTitle: "Kaffee", programName: "Synthetic", programType: "stamp", rewardCost: 10 } });
  expect(setup.status()).toBe(201);
  const { programSlug } = await setup.json() as { programSlug: string };
  const saved = await owner.put("/api/merchant/booking/setup", { data: {
    settings: { shopType: "barber", leadTimeMin: 0, maxDaysAhead: 42, cancelDeadlineHours: 0, maxReschedulesPerMonth: 2, autoConfirm: true, noShowBlockAfter: 3, maxOpenPerCard: 2 },
    services: [{ name: "Haarschnitt", durationMin: 30, priceMinor: 2500 }], staff: [{ name: "Lena", workingHours: hours }] } });
  expect(saved.status()).toBe(200);
  const { serviceId } = { serviceId: (await saved.json() as { services: { id: string }[] }).services[0].id };
  await pool.query("UPDATE booking_settings SET enabled = true WHERE tenant_id = (SELECT tenant_id FROM programs WHERE slug = $1)", [programSlug]);
  const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken: string };
  const booked = await guest.post(`/api/card/${cardToken}/booking/appointments`, { data: { serviceId, start: nextQuarter().toISOString(), customerName: "Mia", idempotencyKey: randomUUID() } });
  expect(booked.status()).toBe(201);
  const appointment = await booked.json() as { id: string };
  // „Fertig“ opens 10 minutes before the start: the booked quarter hour is moved to have started 5 minutes ago.
  if (done) await pool.query("UPDATE booking_appointments SET during = tstzrange(date_trunc('minute', now()) - interval '5 minutes', date_trunc('minute', now()) + interval '25 minutes') WHERE id = $1", [appointment.id]);
  if (done) expect((await owner.post(`/api/merchant/booking/appointments/${appointment.id}/transition`, { data: { to: "done", expected: "confirmed" } })).status()).toBe(200);
  const { scanCode, cardLocator } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string; cardLocator: string };
  return { owner, scanCode, cardLocator, close: async () => { await owner.dispose(); await guest.dispose(); } };
}

/** Opens the card at the till: by its scan code, or by its typed number („Karte öffnen“ after the check), as Design repro'd it. */
async function openAtTill(page: Page, code: string, typed = false) {
  await page.goto("/cashier");
  await page.getByLabel("Kartennummer oder Kartencode").fill(code);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  if (typed) await page.getByRole("button", { name: "Karte öffnen" }).click();
}
const SIZES = [{ width: 390, height: 664 }, { width: 390, height: 844 }, { width: 1280, height: 800 }];

for (const size of SIZES) for (const typed of [false, true]) {
  test(`${size.width}x${size.height}, ${typed ? "typed number" : "scanned"}: the appointment is in the card head, and the foot stays clear of the dock`, async ({ browser, baseURL }) => {
    const shop = await shopWithAppointment(baseURL!, false);
    const context = await browser.newContext({ baseURL, storageState: await shop.owner.storageState(), viewport: size, hasTouch: true });
    const page = await context.newPage();
    await openAtTill(page, typed ? shop.cardLocator : shop.scanCode, typed);
    const head = page.getByText(/^Geprüfte Karte · Termin \d{2}:\d{2}$/).first();
    await expect(head).toBeVisible();
    expect(await head.evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return box.top >= 0 && box.bottom <= innerHeight && Boolean(hit && element.contains(hit)); })).toBe(true);
    await context.close(); await shop.close();
  });
}

for (const size of SIZES.slice(1)) test(`${size.width}x${size.height}: a finished visit warns in one line, keeps „Andere Karte“ clear of the dock, and asks „Trotzdem vergeben?“`, async ({ browser, baseURL }) => {
  const shop = await shopWithAppointment(baseURL!, true);
  const context = await browser.newContext({ baseURL, storageState: await shop.owner.storageState(), viewport: size, hasTouch: true });
  const page = await context.newPage();
  await openAtTill(page, shop.scanCode);
  const warning = page.getByRole("status").filter({ hasText: /^Termin schon gutgeschrieben$/ }).first();
  await expect(page.getByText("Schon gutgeschrieben", { exact: true }).first()).toBeVisible();
  await expect(warning).toBeVisible();
  expect(await warning.evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return box.top >= 0 && box.bottom <= innerHeight && Boolean(hit && element.contains(hit)); })).toBe(true);
  const other = page.getByRole("button", { name: "Andere Karte" }).first();
  expect(await other.evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return Boolean(hit && element.contains(hit)); })).toBe(true);
  await page.locator(".cashier-award-now").click();
  await expect(page.getByRole("dialog", { name: "Trotzdem vergeben?" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Trotzdem vergeben?" })).toContainText(/vergeben\?\s*Termin schon gutgeschrieben\./);
  await context.close(); await shop.close();
});
