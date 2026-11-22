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
  expect((await signUp(owner, { data: { name: "Synthetic booking owner", email: `till-owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
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
  if (done) expect((await owner.post(`/api/merchant/booking/appointments/${appointment.id}/transition`, { data: { to: "done", expected: "confirmed" } })).status()).toBe(200);
  const { scanCode } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
  return { owner, scanCode, close: async () => { await owner.dispose(); await guest.dispose(); } };
}

async function openAtTill(page: Page, scanCode: string) {
  await page.goto("/cashier");
  await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
}
/** What a finger at the element's centre touches, at the current scroll position (no scrolling first). */
const hitAtCentre = (page: Page, selector: string) => page.locator(selector).first().evaluate(element => {
  const box = element.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return { inView: box.top >= 0 && box.bottom <= innerHeight, hit: Boolean(hit && element.contains(hit)) };
});

test("an open appointment shows in the card's state pill, in view and not under the dock", async ({ browser, baseURL }) => {
  const shop = await shopWithAppointment(baseURL!, false);
  const context = await browser.newContext({ baseURL, storageState: await shop.owner.storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await openAtTill(page, shop.scanCode);
  await expect(page.getByText(/^Karte offen · Termin \d{2}:\d{2}$/)).toBeVisible();
  expect(await hitAtCentre(page, `text=/^Karte offen · Termin/`)).toEqual({ inView: true, hit: true });
  await context.close(); await shop.close();
});

test("a visit the owner already finished warns at the top, and one stamp asks „Trotzdem vergeben?“ first", async ({ browser, baseURL }) => {
  const shop = await shopWithAppointment(baseURL!, true);
  const context = await browser.newContext({ baseURL, storageState: await shop.owner.storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await openAtTill(page, shop.scanCode);
  const warning = page.locator(".cashier-appointment-done");
  await expect(warning).toContainText(/Achtung: Termin \d{2}:\d{2} ist schon erledigt und gutgeschrieben\./);
  expect(await hitAtCentre(page, ".cashier-appointment-done")).toEqual({ inView: true, hit: true });
  await page.locator(".cashier-award-now").click();
  await expect(page.getByRole("dialog", { name: "Trotzdem vergeben?" })).toBeVisible();
  await context.close(); await shop.close();
});
