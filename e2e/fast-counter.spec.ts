import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type BrowserContext, type Page } from "@playwright/test";
import QRCode from "qrcode";

/**
 * The fast counter: the camera stays on between customers and one tap books a stamp. The camera is a synthetic canvas
 * stream the test draws QR codes onto, so no real hardware is involved.
 */

async function merchant(url: string, name: string) {
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic counter owner", email: `counter-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = await owner.post("/api/merchant/onboard", { data: {
    businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: `${name} Karte`, programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Besuch.", rewardTitle: "Pizza gratis", rewardCost: 10,
  } });
  expect(setup.status()).toBe(201);
  const { programSlug } = await setup.json() as { programSlug: string };
  return { owner, programSlug };
}

async function guestCard(url: string, programSlug: string) {
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const card = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string; cardLocator: string };
    return { cardToken, ...card };
  } finally { await guest.dispose(); }
}

async function balanceOf(url: string, cardToken: string) {
  const reader = await apiRequest.newContext({ baseURL: url });
  try { return ((await (await reader.get(`/api/card/${encodeURIComponent(cardToken)}`)).json()) as { balance: number }).balance; }
  finally { await reader.dispose(); }
}

/** Replaces the camera with a canvas stream; window.__showQr(dataUrl) puts a code in view, window.__showQr(null) clears it. */
async function fakeCamera(context: BrowserContext) {
  await context.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    let image: HTMLImageElement | null = null;
    const draw = () => {
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (image) ctx.drawImage(image, 170, 90, 300, 300);
    };
    setInterval(draw, 80);
    const fake = { getUserMedia: async () => canvas.captureStream(15) };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: fake });
    (window as unknown as { __showQr: (url: string | null) => Promise<void> }).__showQr = url => new Promise(resolve => {
      if (!url) { image = null; draw(); resolve(); return; }
      const next = new Image();
      next.onload = () => { image = next; draw(); resolve(); };
      next.src = url;
    });
  });
}

async function show(page: Page, value: string | null) {
  const url = value ? await QRCode.toDataURL(value, { margin: 2, width: 300 }) : null;
  await page.evaluate(next => (window as unknown as { __showQr: (url: string | null) => Promise<void> }).__showQr(next), url);
}

test("the camera stays on between customers and one tap books a stamp", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const shop = await merchant(url, "Synthetic Schnellkasse Pizzeria");
  const first = await guestCard(url, shop.programSlug);
  const second = await guestCard(url, shop.programSlug);
  const counter = await browser.newContext({ baseURL: url, storageState: await shop.owner.storageState() });
  await fakeCamera(counter);
  try {
    const page = await counter.newPage();
    const lookups: string[] = [];
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/cashier/lookup") lookups.push(request.url()); });
    const lookupStatuses: number[] = [];
    page.on("response", response => { if (new URL(response.url()).pathname === "/api/cashier/lookup") lookupStatuses.push(response.status()); });
    await page.goto("/cashier");
    await page.getByRole("button", { name: "Kamera öffnen" }).click();
    const camera = page.getByRole("region", { name: "Kassenkamera" });
    await expect(camera).toContainText("Kamera bereit.");

    // Anything that is not a card code (a menu, the counter sign) is ignored without a request.
    await show(page, "https://example.test/speisekarte");
    await page.waitForTimeout(800);
    expect(lookups).toHaveLength(0);

    // A code the previous decoder never read on a clean, static frame is read (it belongs to no card here).
    const hardToRead = "sc_cFPoK0b8uK7vNEw49nZNXr6yF6sVUs3k";
    await show(page, hardToRead);
    await expect.poll(() => lookups.some(entry => entry.includes(encodeURIComponent(hardToRead)))).toBe(true);
    await expect(page.locator(".cashier-status")).toContainText("Keine aktive Karte");

    // Guest 1 shows the card: it opens at once; the offline lease is not waited for; one tap books one stamp.
    await page.route("**/api/cashier/offline/lease", async route => { await new Promise(resolve => setTimeout(resolve, 3_000)); await route.continue().catch(() => {}); });
    await show(page, first.scanCode);
    await expect(page.getByRole("heading", { name: first.cardLocator }), `lookup statuses: ${JSON.stringify(lookupStatuses)}`).toBeVisible();
    expect(lookups.filter(entry => entry.includes(encodeURIComponent(hardToRead)))).toHaveLength(1);
    await expect(camera).toBeHidden();
    const stamp = page.getByRole("button", { name: "1 Stempel vergeben" });
    await expect(stamp).toBeEnabled({ timeout: 1_000 });
    await stamp.click();
    const booked = page.locator(".cashier-booked");
    await expect(booked).toContainText(`1 Stempel für ${first.cardLocator} vergeben. Neuer Stand: 1 Stempel.`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.unroute("**/api/cashier/offline/lease");
    expect(await balanceOf(url, first.cardToken)).toBe(1);

    // Guest 1 still holds the phone up: the camera is back, but the same card does not reopen for a second booking.
    await expect(camera).toBeVisible();
    await page.waitForTimeout(3_000);
    await expect(page.locator(".balance-display")).toHaveCount(0);

    // Guest 2 steps up during the confirmation: their card opens without any tap.
    await show(page, second.scanCode);
    await expect(page.getByRole("heading", { name: second.cardLocator })).toBeVisible();
    await expect(booked).toHaveCount(0);
    await page.getByRole("button", { name: "1 Stempel vergeben" }).click();
    await expect(booked).toContainText(`für ${second.cardLocator} vergeben`);
    expect(await balanceOf(url, second.cardToken)).toBe(1);

    // A passing failure is retried while the code stays in view: the first lookup for guest 3 is answered 503.
    const third = await guestCard(url, shop.programSlug);
    let failedOnce = false;
    await page.route("**/api/cashier/lookup**", async route => {
      if (failedOnce) return route.continue();
      failedOnce = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic outage" }) });
    });
    await show(page, third.scanCode);
    await expect(page.getByRole("heading", { name: third.cardLocator })).toBeVisible({ timeout: 8_000 });
    expect(failedOnce).toBe(true);
    await page.unroute("**/api/cashier/lookup**");
    await page.locator(".card-result-head").getByRole("button", { name: "Andere Karte" }).click();

    // Guest 1 comes back to the counter right away: the card opens again, with a warning about the recent booking.
    await show(page, null);
    await page.waitForTimeout(2_500);
    await show(page, first.scanCode);
    await expect(page.getByRole("heading", { name: first.cardLocator })).toBeVisible();
    await expect(page.locator(".cashier-status")).toContainText("Achtung: Auf dieser Karte wurde vor");
    await expect(page.locator(".cashier-status")).toContainText("(1 Stempel)");

    // More than one stamp still asks for confirmation.
    await page.getByRole("button", { name: "Menge erhöhen" }).click();
    // Cancelled from the keyboard, the confirmation gives focus back to the button that opened it.
    const review = page.getByRole("button", { name: "2 Stempel prüfen" });
    await review.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Vergabe bestätigen?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(review).toBeFocused();
    await review.click();
    await expect(page.getByRole("dialog", { name: "Vergabe bestätigen?" })).toContainText(`2 Stempel für Karte ${first.cardLocator}.`);
    await page.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(booked).toContainText("Neuer Stand: 3 Stempel.");
    expect(await balanceOf(url, first.cardToken)).toBe(3);
    expect(await balanceOf(url, second.cardToken)).toBe(1);

    // The camera is remembered: after a reload it starts by itself. Switched off, it stays off.
    await show(page, null);
    await page.reload();
    await expect(camera).toContainText("Kamera bereit.");
    await page.getByRole("button", { name: "Kamera ausschalten" }).click();
    await expect(camera).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Kamera öffnen" })).toBeVisible();
    await expect(camera).toHaveCount(0);
  } finally { await counter.close(); await shop.owner.dispose(); }
});
