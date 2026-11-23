import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";
import { Pool } from "pg";

import { signUp } from "./support/sign-up";

// Its own pool: CI runs the owner specs in one worker, where ending a shared pool breaks the files after this one.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Design blocker 3 (22 Nov): a shop without online booking sees its owner screens as before #330.
test.afterAll(async () => { await pool.end(); });
// The config's server (CI runs these on its own port); E2E_BASE_URL only for a server started by hand.
test.use({ ...(process.env.E2E_BASE_URL ? { baseURL: process.env.E2E_BASE_URL } : {}), viewport: { width: 390, height: 844 }, hasTouch: true });

test("a shop with booking off: no Termine in Mehr, the old export note, and no day view or wizard to reach", async ({ browser, baseURL }) => {
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL!).origin } });
  const ownerEmail = `off-owner-${randomUUID()}@example.test`;
  expect((await signUp(owner, { data: { name: "Synthetic pizzeria owner", email: ownerEmail, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  // railway-rc asks a new owner to confirm the address before the owner screens open.
  await pool.query('UPDATE "user" SET "emailVerified" = true WHERE email = $1', [ownerEmail]);
  expect((await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Pizzeria", locationName: "Kassel Nord", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", rulesText: "Synthetic rules.", rewardTitle: "Pizza", programName: "Synthetic", programType: "stamp", rewardCost: 10 } })).status()).toBe(201);
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/merchant/more");
  await expect(page.getByText("Karten für Excel")).toBeVisible();
  await expect(page.getByText("Termine für Excel")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Tagesansicht/ })).toHaveCount(0);
  await expect(page.getByText("Lade deine Karten und Buchungen für Excel herunter. Kontaktdaten deiner Kundinnen und Kunden sind nicht enthalten.")).toBeVisible();
  for (const path of ["/merchant/termine", "/merchant/termine/einrichten"]) {
    await page.goto(path);
    await expect(page.getByText("Online-Termine sind für diesen Standort nicht eingeschaltet.")).toBeVisible();
    await expect(page.getByText("Was für ein Betrieb bist du?")).toHaveCount(0);
  }
  await context.close(); await owner.dispose();
});

// Vertragsbedingungen § 3 (5) (CTO, 23 Nov): booked appointments stay visible and exportable after booking goes off, also once all are past.
test("booking switched off with every appointment past: the read-only day view and „Termine für Excel“ stay, and the download answers", async ({ browser, baseURL }) => {
  const origin = { Origin: new URL(baseURL!).origin };
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin }), guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin });
  const ownerEmail = `off-past-owner-${randomUUID()}@example.test`;
  expect((await signUp(owner, { data: { name: "Synthetic salon owner", email: ownerEmail, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  await pool.query('UPDATE "user" SET "emailVerified" = true WHERE email = $1', [ownerEmail]);
  const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Salon", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", rulesText: "Synthetic rules.", rewardTitle: "Kaffee", programName: "Synthetic", programType: "stamp", rewardCost: 10 } });
  const { programSlug } = await setup.json() as { programSlug: string };
  await pool.query("INSERT INTO booking_settings (tenant_id, location_id, enabled) SELECT tenant_id, location_id, true FROM programs WHERE slug = $1", [programSlug]);
  const hours = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, start: "06:00", end: "22:00", breaks: [] }));
  const saved = await owner.put("/api/merchant/booking/setup", { data: {
    settings: { shopType: "barber", leadTimeMin: 0, maxDaysAhead: 42, cancelDeadlineHours: 0, maxReschedulesPerMonth: 2, autoConfirm: true, noShowBlockAfter: 3, maxOpenPerCard: 2 },
    services: [{ name: "Haarschnitt", durationMin: 30, priceMinor: 2500 }], staff: [{ name: "Lena", workingHours: hours }] } });
  const serviceId = (await saved.json() as { services: { id: string }[] }).services[0].id;
  const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken: string };
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 2); start.setUTCHours(9, 0, 0, 0);
  const booked = await guest.post(`/api/card/${cardToken}/booking/appointments`, { data: { serviceId, start: start.toISOString(), customerName: "Mia", idempotencyKey: randomUUID() } });
  const { id } = await booked.json() as { id: string };
  await pool.query("UPDATE booking_settings SET enabled = false FROM programs WHERE programs.slug = $1 AND booking_settings.location_id = programs.location_id", [programSlug]);
  // Only past appointments, the name already cleared after 12 months (ENG-371): the row still counts (Legal § 6).
  await pool.query("UPDATE booking_appointments SET during = tstzrange(now() - interval '13 months', now() - interval '13 months' + interval '30 minutes'), status = 'done', customer_name = 'Name gelöscht' WHERE id = $1", [id]);

  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/merchant/more");
  const link = page.getByRole("link", { name: /Termine für Excel/ });
  await expect(link).toBeVisible();
  const download = await owner.get((await link.getAttribute("href"))!);
  expect(download.status()).toBe(200);
  expect(await download.text()).toContain("Name gelöscht");
  await page.goto("/merchant/termine");
  await expect(page.getByText("Online-Termine sind aus. Gebuchte Termine bleiben hier und im Export „Termine für Excel“.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zeit blocken" })).toHaveCount(0);
  await context.close(); await owner.dispose(); await guest.dispose();
});
