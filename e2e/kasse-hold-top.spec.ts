import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";

// From 600 px wide a booking holds the centred group where it stands (Design, 19 Nov): from the tap to the end of the
// „Gebucht“ hold the card's top and the dock's top are the same in every frame; only the dock's bottom edge moves.

async function shop(url: string, programType: "points" | "stamp") {
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic hold owner", email: `hold-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = await owner.post("/api/merchant/onboard", { data: {
    businessName: "Synthetic Hold Pizzeria", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    ...(programType === "points"
      ? { programName: "Punktekarte", programType, earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Ein Punkt je vollem Euro an der Kasse.", rewardTitle: "Pizza", rewardCost: 50 }
      : { programName: "Stempelkarte", programType, rulesText: "Ein Stempel je Besuch.", rewardTitle: "Pizza", rewardCost: 8 }),
  } });
  expect(setup.status()).toBe(201);
  const { programSlug } = await setup.json() as { programSlug: string };
  return { owner, programSlug };
}

async function scanCode(url: string, programSlug: string) {
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken: string };
  const { scanCode } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
  await guest.dispose();
  return scanCode;
}

/** Every frame's card top, dock top and dock bottom while the card is on screen. */
const record = (page: Page) => page.evaluate(() => {
  const frames: Array<{ card: number; dock: number; bottom: number }> = [];
  (window as unknown as { holdFrames: typeof frames }).holdFrames = frames;
  const tick = () => {
    const card = document.querySelector(".card-result-head"), dock = document.querySelector("[data-dock]");
    if (card && dock) frames.push({ card: card.getBoundingClientRect().top, dock: dock.getBoundingClientRect().top, bottom: dock.getBoundingClientRect().bottom });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const frames = (page: Page) => page.evaluate(() => (window as unknown as { holdFrames: Array<{ card: number; dock: number; bottom: number }> }).holdFrames);
const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

async function open(page: Page, code: string) {
  await page.goto("/cashier");
  await page.getByLabel("Kartennummer oder Kartencode").fill(code);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Karte gefunden." })).toBeAttached();
  await page.waitForTimeout(400); // the dock's entrance and the centring settle
}

for (const size of [{ width: 1280, height: 900 }, { width: 820, height: 1180 }]) {
  test(`a points card booking 12,50 keeps the card and the dock's top in every frame (${size.width} × ${size.height})`, async ({ baseURL, browser }) => {
    const url = baseURL ?? "http://localhost:3000";
    const { owner, programSlug } = await shop(url, "points");
    const context = await browser.newContext({ baseURL: url, storageState: await owner.storageState(), viewport: size });
    const page = await context.newPage();
    await open(page, await scanCode(url, programSlug));
    await page.getByRole("button", { name: "Kaufbetrag eingeben" }).first().click();
    await page.getByLabel("Kaufbetrag (EUR)").fill("12,50");
    await page.getByRole("button", { name: "Buchen", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Vergabe bestätigen?" });
    await expect(dialog).toContainText("12 Punkte für einen Kauf über 12,50 € für Karte");
    // From the open layout behind the dialog, through the tap and „Gebucht“, to the end of the hold.
    await record(page);
    await page.getByRole("button", { name: "Ja, vergeben", exact: true }).click();
    await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand: 12 Punkte");
    await expect(page.locator(".cashier-booked")).toHaveCount(0, { timeout: 8_000 });
    const seen = await frames(page);
    expect(seen.length).toBeGreaterThan(30);
    expect(spread(seen.map(f => f.card)), JSON.stringify(seen.slice(0, 3))).toBeLessThanOrEqual(1);
    expect(spread(seen.map(f => f.dock)), JSON.stringify(seen.slice(0, 3))).toBeLessThanOrEqual(1);
    await context.close(); await owner.dispose();
  });
}

test("a stamp card's one-tap booking keeps the card and the dock's top in every frame (1280 × 900)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const { owner, programSlug } = await shop(url, "stamp");
  const context = await browser.newContext({ baseURL: url, storageState: await owner.storageState(), viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await open(page, await scanCode(url, programSlug));
  await record(page);
  await page.locator(".cashier-award-now").click();
  await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand: 1 Stempel");
  await expect(page.locator(".cashier-booked")).toHaveCount(0, { timeout: 8_000 });
  const seen = await frames(page);
  expect(spread(seen.map(f => f.card)), JSON.stringify(seen.slice(0, 3))).toBeLessThanOrEqual(1);
  expect(spread(seen.map(f => f.dock)), JSON.stringify(seen.slice(0, 3))).toBeLessThanOrEqual(1);
  await context.close(); await owner.dispose();
});

test("after the „Rückgängig gemacht“ hold the scan form shows no second receipt (Design, 19 Nov)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const { owner, programSlug } = await shop(url, "stamp");
  const context = await browser.newContext({ baseURL: url, storageState: await owner.storageState(), viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await open(page, await scanCode(url, programSlug));
  await page.locator(".cashier-award-now").click();
  await page.locator(".cashier-booked").getByRole("button", { name: "Rückgängig" }).click();
  await expect(page.locator(".cashier-booked")).toContainText("Rückgängig gemacht");
  await expect(page.locator(".cashier-booked")).toHaveCount(0, { timeout: 8_000 });
  await expect(page.getByRole("button", { name: "Prüfen", exact: true })).toBeVisible();
  await expect(page.locator(".cashier-status")).toHaveCount(0);
  await context.close(); await owner.dispose();
});
