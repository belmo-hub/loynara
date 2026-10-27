import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { pool } from "../src/db";
import { auth } from "../src/lib/auth";
import { saveSetup } from "../src/lib/booking/setup";
import { createMerchant, enroll } from "../src/lib/product";
import { smallTargets } from "./support/targets";

// Run against any local server and disposable database: E2E_BASE_URL (default :3000), DATABASE_URL, E2E_SHOTS (optional folder).
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname)) throw new Error("Local disposable database required");
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const shot = (page: Page, name: string) => shots ? page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }) : Promise.resolve();

test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", viewport: { width: 390, height: 844 }, hasTouch: true });
test.afterAll(async () => { await pool.end(); });

async function bookingShop() {
  const user = (await auth.api.signUpEmail({ body: { name: "Synthetic booking owner", email: `booking-${randomUUID()}@example.test`, password: `Synthetic!${randomUUID()}Aa` } })).user;
  const merchant = await createMerchant({ userId: user.id, businessName: "Studio Lena", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic programme", programType: "stamp", rulesText: "Synthetic booking rules text", rewardTitle: "Haarschnitt gratis", rewardCost: 10 });
  const hours = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, start: "09:00", end: "18:00", breaks: [] }));
  await saveSetup({ tenantId: merchant.tenantId, locationId: merchant.locationId }, {
    settings: { shopType: "barber", leadTimeMin: 120, maxDaysAhead: 42, cancelDeadlineHours: 24, maxReschedulesPerMonth: 2, autoConfirm: true, noShowBlockAfter: 3, maxOpenPerCard: 2 },
    services: [{ name: "Haarschnitt", durationMin: 30, priceMinor: 2500 }, { name: "Bart", durationMin: 15, priceMinor: 1200 }],
    staff: [{ name: "Lena", workingHours: hours }, { name: "Tom", workingHours: hours }],
  });
  // The operator toggle is slice 7; the test switches booking on directly.
  await pool.query("UPDATE booking_settings SET enabled = true WHERE tenant_id = $1", [merchant.tenantId]);
  return { merchant, card: await enroll({ slug: merchant.programSlug, acceptedTerms: true }) };
}

test("a guest books from the card in four taps, sees it on the card and cancels it", async ({ page }) => {
  const { merchant, card } = await bookingShop();
  await page.goto(`/card/${card.cardToken}`);
  const entry = page.getByRole("link", { name: "Termin buchen" });
  await expect(entry).toBeVisible();
  await expect(page.locator(".card-booking-next")).toHaveCount(0);
  await shot(page, "01-card-before");

  await entry.click();
  await expect(page.getByRole("heading", { name: "Leistung wählen" })).toBeVisible();
  await expect(page.getByText("Noch keine Termine. Such dir unten einen aus.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Impressum" })).toBeVisible();
  expect(await smallTargets(page, { scope: "main" })).toEqual([]);
  await shot(page, "02-service");

  await page.getByRole("button", { name: /Haarschnitt/ }).click();
  await expect(page.getByRole("button", { name: "Egal wer" })).toHaveAttribute("aria-pressed", "true");
  const dayChips = page.locator(".booking-flow button[aria-pressed]").filter({ hasText: /^\p{L}{2} \d{2}\.\d{2}\.$/u });
  const firstDay = dayChips.first();
  await expect(firstDay).toBeVisible();
  await shot(page, "03-day");

  // Two days further on, so the 24 h deadline is still open for the move and the free cancel below.
  await dayChips.nth(2).click();
  await expect(page.getByRole("heading", { name: "Uhrzeit wählen" })).toBeVisible();
  await shot(page, "04-time");
  await page.locator(".booking-flow button").filter({ hasText: /^\d{2}:\d{2}$/ }).first().click();

  await expect(page.getByRole("heading", { name: "Termin prüfen" })).toBeVisible();
  await expect(page.getByText(/^Kostenlos absagen bis /)).toBeVisible();
  await page.getByLabel("Dein Name").fill("Mia");
  expect(await smallTargets(page, { scope: "main" })).toEqual([]);
  await shot(page, "05-confirm");
  await page.getByRole("button", { name: "Termin buchen" }).click();

  await expect(page.getByRole("heading", { name: /^Dein Termin ist fix: \p{L}{2} \d{2}\.\d{2}\., \d{2}:\d{2} bei (Lena|Tom)$/u })).toBeVisible();
  const booked = (await page.getByRole("heading", { name: /^Dein Termin ist fix/ }).textContent())!.match(/(\d{2}:\d{2}) bei (Lena|Tom)$/)!;
  await expect(page.getByText(/^Haarschnitt\. Kostenlos absagen bis /)).toBeVisible();
  await expect(page.locator(".booking-mine li")).toHaveCount(1);
  await shot(page, "06-done");

  // Move: the booked staff member stays selected, the own time counts as free, and the new time lands on the card.
  await page.getByRole("button", { name: "Verschieben" }).click();
  await expect(page.getByRole("heading", { name: "Neuen Tag wählen" })).toBeVisible();
  await expect(page.locator(".booking-flow button[aria-pressed='true']").filter({ hasText: booked[2] })).toHaveCount(1);
  await dayChips.nth(2).click();
  await expect(page.getByRole("heading", { name: "Uhrzeit wählen" })).toBeVisible();
  await expect(page.locator(".booking-flow button").filter({ hasText: booked[1] })).toBeVisible(); // the own time stays on offer
  await page.locator(".booking-flow button").filter({ hasText: /^\d{2}:\d{2}$/ }).nth(1).click();
  await expect(page.getByRole("heading", { name: "Verschieben prüfen" })).toBeVisible();
  await page.getByRole("button", { name: "Hierhin verschieben" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`^Verschoben: \\p{L}{2} \\d{2}\\.\\d{2}\\., \\d{2}:\\d{2} bei ${booked[2]}$`, "u") })).toBeVisible();
  await expect(page.locator(".booking-mine li")).toHaveCount(1);
  await shot(page, "06b-moved");

  await page.getByRole("link", { name: "Zur Karte", exact: true }).click();
  await expect(page.locator(".card-booking-next")).toContainText(/Nächster Termin: .*Haarschnitt bei (Lena|Tom)/);
  // The balance and the gap to the reward stay first; booking sits below them.
  const [goal, booking] = await Promise.all([page.locator(".reward-remaining").boundingBox(), page.locator(".card-booking").boundingBox()]);
  expect(goal!.y).toBeLessThan(booking!.y);
  await shot(page, "07-card-next");

  await page.getByRole("link", { name: "Termin buchen" }).click();
  await page.getByRole("button", { name: "Absagen" }).click();
  await expect(page.getByText(/^Kostenlos, die Frist läuft bis /)).toBeVisible();
  await shot(page, "08-cancel-confirm");
  await page.getByRole("button", { name: "Ja, absagen" }).click();
  await expect(page.locator(".booking-mine")).toContainText("Haarschnitt: abgesagt");
  await shot(page, "09-cancelled");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: /Haarschnitt/ }).click();
  await expect(firstDay).toBeVisible();
  await shot(page, "10-day-dark");

  // Booking off: the card shows nothing of it.
  await pool.query("UPDATE booking_settings SET enabled = false WHERE tenant_id = $1", [merchant.tenantId]);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/card/${card.cardToken}`);
  await expect(page.locator(".customer-qr img")).toBeVisible();
  await expect(page.locator(".card-booking")).toHaveCount(0);
});
