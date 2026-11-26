import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";
import { pool } from "../src/db";
import { signUp } from "./support/sign-up";

// Design (22 Nov), D4 and the 390 major: „Termin verschieben“ opens on a day with free times, focuses the slots, and keeps
// its action row on screen while the slot list scrolls. One dialog throughout: no remount between modes.
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Local disposable database required");
test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" });
test.afterAll(async () => { await pool.end(); });
const hours = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, start: "06:00", end: "22:00", breaks: [] }));

test("„Verschieben“ at 390x812: a free day, focus on the slots, the primary in view after a pick", async ({ browser, baseURL }) => {
  const origin = { Origin: new URL(baseURL!).origin };
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin }), guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin });
  const ownerEmail = `move-owner-${randomUUID()}@example.test`;
  expect((await signUp(owner, { data: { name: "Synthetic salon owner", email: ownerEmail, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  // railway-rc asks a new owner to confirm the address before the owner screens open.
  await pool.query('UPDATE "user" SET "emailVerified" = true WHERE email = $1', [ownerEmail]);
  const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Salon", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", rulesText: "Synthetic rules.", rewardTitle: "Kaffee", programName: "Synthetic", programType: "stamp", rewardCost: 10 } });
  const { programSlug } = await setup.json() as { programSlug: string };
  await pool.query("INSERT INTO booking_settings (tenant_id, location_id, enabled) SELECT tenant_id, location_id, true FROM programs WHERE slug = $1", [programSlug]);
  const saved = await owner.put("/api/merchant/booking/setup", { data: {
    settings: { shopType: "barber", leadTimeMin: 0, maxDaysAhead: 42, cancelDeadlineHours: 0, maxReschedulesPerMonth: 2, autoConfirm: true, noShowBlockAfter: 3, maxOpenPerCard: 2 },
    services: [{ name: "Haarschnitt", durationMin: 15, priceMinor: 2500 }], staff: [{ name: "Lena", workingHours: hours }] } });
  expect(saved.status()).toBe(200);
  const serviceId = (await saved.json() as { services: { id: string }[] }).services[0].id;
  const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken: string };
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 2); start.setUTCHours(9, 0, 0, 0);
  expect((await guest.post(`/api/card/${cardToken}/booking/appointments`, { data: { serviceId, start: start.toISOString(), customerName: "Mia", idempotencyKey: randomUUID() } })).status()).toBe(201);

  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 390, height: 812 }, hasTouch: true });
  const page = await context.newPage();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(start);
  await page.goto(`/merchant/termine?date=${date}`);
  await page.getByRole("button", { name: /Haarschnitt/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Verschieben" }).click();
  await expect(dialog.getByRole("heading", { name: "Termin verschieben" })).toBeVisible();
  await expect(page.locator("#bd-slots")).toBeFocused();
  const slot = dialog.getByRole("group", { name: "Freie Zeiten" }).getByRole("button").nth(6);
  await slot.click();
  const primary = dialog.getByRole("button", { name: /^Auf \d{2}:\d{2} Uhr verschieben$/ });
  await expect(primary).toBeInViewport({ ratio: 1 });
  expect(await primary.evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return Boolean(hit && element.contains(hit)); })).toBe(true);
  // Design (26 Nov): with booking shown, the Übersicht keeps its desktop grid at 1280: the chart and the figures share a row.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/merchant");
  const board = page.locator('[data-ow="board"]');
  await expect(board).toBeVisible();
  await expect.poll(() => board.evaluate(element => {
    const figures = element.nextElementSibling!.getBoundingClientRect(), chart = element.getBoundingClientRect();
    return Math.abs(figures.top - chart.top) <= 1 && chart.right <= figures.left;
  })).toBe(true);
  // From 1024 the first-weeks note stands in the section title only: the figures card shows none (Design r2, 26 Nov).
  expect(await board.evaluate(element => {
    const leaves = [...element.nextElementSibling!.querySelectorAll<HTMLElement>("*")].filter(node => node.children.length === 0 && /Woche/.test(node.textContent ?? ""));
    return { inDom: leaves.length > 0, shown: leaves.some(node => node.offsetParent !== null) };
  })).toEqual({ inDom: true, shown: false });
  await expect(page.getByRole("heading", { name: /Letzte 30 Tage an diesem Standort · erste Woche/ })).toBeVisible();
  await page.goto(`/merchant/termine?date=${date}`);
  // Design (26 Nov): at 320 the day's quick switch keeps whole words, one line per button, and nothing scrolls sideways.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 640 });
  const quick = page.getByRole("group", { name: "Schnellwahl" }).getByRole("button");
  await expect(quick).toHaveCount(3);
  expect(await quick.evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth && button.getBoundingClientRect().height <= 48))).toBe(true);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth === innerWidth)).toBe(true);
  await context.close(); await owner.dispose(); await guest.dispose();
});
