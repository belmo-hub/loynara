import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import QRCode from "qrcode";
import { signUp } from "./support/sign-up";

// From 600 px wide the Kasse's layout is decided when the card opens and kept until it leaves (Design, 19 Nov): a group
// that still fits with the booked stack is centred with a floating panel that grows downward; any other takes the
// phone's layout, a sticky flat dock never shorter than the booked stack. Either way, from the tap to the end of the
// „Gebucht“ hold the card's top and the dock's left edge, width and corners are the same in every frame, and the typed
// path's code field is fully in view. Centred, the dock's top stays and it grows downward; in the wide phone layout its
// bottom stays and its top rises once into ground reserved above it, never over content.

type Shop = { owner: Awaited<ReturnType<typeof apiRequest.newContext>>; programSlug: string };

async function shop(url: string, programType: "points" | "stamp", extraRewards: number[] = []): Promise<Shop> {
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  expect((await signUp(owner, { data: { name: "Synthetic hold owner", email: `hold-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = await owner.post("/api/merchant/onboard", { data: {
    businessName: "Synthetic Hold Pizzeria", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    ...(programType === "points"
      ? { programName: "Punktekarte", programType, earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Ein Punkt je vollem Euro an der Kasse.", rewardTitle: "Pizza", rewardCost: 50 }
      : { programName: "Stempelkarte", programType, rulesText: "Ein Stempel je Besuch.", rewardTitle: "Pizza", rewardCost: 8 }),
  } });
  expect(setup.status()).toBe(201);
  const { programSlug } = await setup.json() as { programSlug: string };
  for (const cost of extraRewards) expect((await owner.post("/api/merchant/program/rewards", { data: { action: "create", programSlug, title: "Espresso", cost, termsText: "Ein Espresso." } })).status()).toBe(201);
  return { owner, programSlug };
}

/** A new guest card, with `balance` stamps already on it. */
async function guestCard(url: string, { owner, programSlug }: Shop, balance = 0) {
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken: string };
  const { scanCode } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
  await guest.dispose();
  if (balance) {
    const { membershipId } = await (await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`)).json() as { membershipId: string };
    expect((await owner.post("/api/cashier/award", { data: { membershipId, quantity: balance, idempotencyKey: randomUUID(), requestId: randomUUID() } })).ok()).toBe(true);
  }
  return scanCode;
}

/** Replaces the camera with a canvas stream the test draws a QR code onto (as e2e/fast-counter.spec.ts). */
async function fakeCamera(context: BrowserContext) {
  await context.addInitScript(() => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 640, height: 480 }), ctx = canvas.getContext("2d")!;
    let image: HTMLImageElement | null = null;
    setInterval(() => { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 640, 480); if (image) ctx.drawImage(image, 170, 90, 300, 300); }, 80);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => canvas.captureStream(15) } });
    (window as unknown as { __showQr: (url: string) => Promise<void> }).__showQr = url => new Promise(resolve => { const next = new Image(); next.onload = () => { image = next; resolve(); }; next.src = url; });
  });
}

type Frame = { card: number; dock: number; bottom: number; left: number; width: number; radius: string; field: number | null; content: number };
/** Every frame's card top, the dock's box and corner, and the code field's bottom while the card is on screen. */
const record = (page: Page) => page.evaluate(() => {
  const frames: Frame[] = [];
  (window as unknown as { holdFrames: Frame[] }).holdFrames = frames;
  const tick = () => {
    const card = document.querySelector(".card-result-head"), dock = document.querySelector("[data-dock]"), field = document.querySelector(".cashier-booked #cashier-code");
    if (card && dock) {
      const box = dock.getBoundingClientRect();
      const content = Math.max(...[...document.querySelectorAll("main *")].filter(el => !el.closest("dialog")).map(el => el.getBoundingClientRect()).filter(r => r.height > 0).map(r => r.bottom));
      frames.push({ card: card.getBoundingClientRect().top, dock: box.top, bottom: box.bottom, left: box.left, width: box.width, radius: getComputedStyle(dock).borderBottomLeftRadius, field: field ? field.getBoundingClientRect().bottom : null, content });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const frames = (page: Page) => page.evaluate(() => (window as unknown as { holdFrames: Frame[] }).holdFrames);
const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

/** The trace from the open layout through the tap to the end of the hold. Centred ("held"): nothing but the dock's bottom
 * moves. The wide phone layout ("rises"): the bottom and the content stay, the top rises once, and nothing is under it. */
async function held(page: Page, book: () => Promise<void>, typed: boolean, mode: "held" | "rises" = "held") {
  await record(page);
  await book();
  await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
  await expect(page.locator(".cashier-booked")).toHaveCount(0, { timeout: 8_000 });
  const seen = await frames(page), at = JSON.stringify([seen[0], seen.at(-1)]);
  expect(seen.length).toBeGreaterThan(30);
  for (const key of ["card", "left", "width", ...(mode === "held" ? ["dock"] as const : ["bottom"] as const)] as const) expect(spread(seen.map(f => f[key])), `${key} ${at}`).toBeLessThanOrEqual(1);
  if (mode === "rises") {
    const tops = seen.map(f => Math.round(f.dock));
    expect(tops.filter((top, i) => i && top !== tops[i - 1]), `one rise ${at}`).toHaveLength(1);
    expect(tops.at(-1)!, at).toBeLessThan(tops[0]);
    for (const f of seen) expect(f.content, `nothing under the dock ${at}`).toBeLessThanOrEqual(f.dock + 1);
  }
  expect(new Set(seen.map(f => f.radius)).size, at).toBe(1);
  if (!typed) return;
  // The typed path's focused field and its 4 px ring are in view in every frame of „Gebucht“.
  const height = await page.evaluate(() => innerHeight), shown = seen.filter(f => f.field !== null);
  expect(shown.length).toBeGreaterThan(10);
  for (const f of shown) expect(f.field! + 4, at).toBeLessThanOrEqual(height);
}

async function counter(browser: Browser, url: string, s: Shop, viewport: { width: number; height: number }, camera = false) {
  const context = await browser.newContext({ baseURL: url, storageState: await s.owner.storageState(), viewport });
  if (camera) await fakeCamera(context);
  return { context, page: await context.newPage() };
}

async function openTyped(page: Page, code: string) {
  await page.goto("/cashier");
  await page.getByLabel("Kartennummer oder Kartencode").fill(code);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Karte gefunden." })).toBeAttached();
  await page.waitForTimeout(400); // the dock's entrance and the centring settle
}

/** Opens the card by its typed code or through the camera, books 12,50 and traces it from behind the confirmation. */
async function pointsBooking(browser: Browser, url: string, size: { width: number; height: number }, path: "typed" | "scan", mode: "held" | "rises") {
  const s = await shop(url, "points"), code = await guestCard(url, s);
  const { context, page } = await counter(browser, url, s, size, path === "scan");
  if (path === "typed") await openTyped(page, code);
  else {
    await page.goto("/cashier");
    await page.getByRole("button", { name: "Kamera öffnen" }).click();
    await expect(page.getByRole("region", { name: "Kassenkamera" })).toContainText("Kamera bereit.");
    const qr = await QRCode.toDataURL(code, { margin: 2, width: 300 });
    await page.evaluate(next => (window as unknown as { __showQr: (url: string) => Promise<void> }).__showQr(next), qr);
    await expect(page.getByRole("button", { name: "Kaufbetrag eingeben" }).first()).toBeVisible();
    await page.waitForTimeout(400);
  }
  if (mode === "rises") {
    // The open dock has its natural height (one button), not the booked stack's.
    expect(await page.evaluate(() => document.querySelector("[data-dock]")!.getBoundingClientRect().height)).toBeLessThan(160);
  }
  await page.getByRole("button", { name: "Kaufbetrag eingeben" }).first().click();
  await page.getByLabel("Kaufbetrag (EUR)").fill("12,50");
  await page.getByRole("button", { name: "Buchen", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Vergabe bestätigen?" })).toContainText("12 Punkte für einen Kauf über 12,50 € für Karte");
  // From the open layout behind the dialog, through the tap and „Gebucht“, to the end of the hold. The rising dock's
  // clip runs over --dur-ui (220 ms), whatever unit the built CSS writes it in.
  await held(page, async () => {
    await page.getByRole("button", { name: "Ja, vergeben", exact: true }).click();
    if (mode === "rises") await expect.poll(() => page.evaluate(() => Number(document.querySelector("[data-dock]")!.getAnimations()[0]?.effect?.getTiming().duration ?? 0)), { timeout: 2_000, intervals: [10] }).toBeGreaterThanOrEqual(200);
  }, path === "typed", mode);
  await context.close(); await s.owner.dispose();
}

for (const size of [{ width: 1280, height: 900 }, { width: 880, height: 900 }]) {
  for (const path of ["typed", "scan"] as const) {
    test(`the wide phone layout: a points card booking 12,50 on the ${path} path rises once from its natural height, bottom and content fixed (${size.width} × ${size.height})`, async ({ baseURL, browser }) => {
      await pointsBooking(browser, baseURL ?? "http://localhost:3000", size, path, "rises");
    });
  }
}

test("centred: a points card booking 12,50 keeps the card and the dock's top in every frame, the field in view (820 × 1180)", async ({ baseURL, browser }) => {
  await pointsBooking(browser, baseURL ?? "http://localhost:3000", { width: 820, height: 1180 }, "typed", "held");
});

test("a stamp card's one-tap booking keeps the card and the dock in every frame (1280 × 900)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000", s = await shop(url, "stamp");
  const { context, page } = await counter(browser, url, s, { width: 1280, height: 900 });
  await openTyped(page, await guestCard(url, s));
  await held(page, () => page.locator(".cashier-award-now").click(), true);
  await context.close(); await s.owner.dispose();
});

test("two rewards (3 and 8) at 4 stamps, typed path: one dock top, the field in view (880 × 900)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000", s = await shop(url, "stamp", [3]);
  const { context, page } = await counter(browser, url, s, { width: 880, height: 900 });
  await openTyped(page, await guestCard(url, s, 4));
  await held(page, () => page.locator(".cashier-award-now").click(), true);
  await context.close(); await s.owner.dispose();
});

test("two rewards (3 and 8) at 4 stamps, scan path: one dock top (880 × 900)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000", s = await shop(url, "stamp", [3]);
  const { context, page } = await counter(browser, url, s, { width: 880, height: 900 }, true);
  const code = await guestCard(url, s, 4);
  await page.goto("/cashier");
  await page.getByRole("button", { name: "Kamera öffnen" }).click();
  await expect(page.getByRole("region", { name: "Kassenkamera" })).toContainText("Kamera bereit.");
  const qr = await QRCode.toDataURL(code, { margin: 2, width: 300 });
  await page.evaluate(next => (window as unknown as { __showQr: (url: string) => Promise<void> }).__showQr(next), qr);
  await expect(page.locator(".cashier-award-now")).toBeVisible();
  await page.waitForTimeout(400);
  await held(page, () => page.locator(".cashier-award-now").click(), false);
  await context.close(); await s.owner.dispose();
});

test("the rebook state: one dock top and the field in view through the second booking (1280 × 900)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000", s = await shop(url, "stamp");
  const { context, page } = await counter(browser, url, s, { width: 1280, height: 900 });
  const code = await guestCard(url, s);
  await openTyped(page, code);
  await page.locator(".cashier-award-now").click();
  await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
  await page.locator(".cashier-booked #cashier-code").fill(code);
  await page.locator(".cashier-booked #cashier-code").press("Enter");
  await expect(page.locator(".cashier-status--pending")).toContainText("Auf dieser Karte wurde vor");
  await page.waitForTimeout(400);
  // A tap, not Playwright's click, which would first scroll the button into its place in the flow.
  await held(page, () => page.locator(".cashier-award-now").dispatchEvent("click"), true);
  await context.close(); await s.owner.dispose();
});

test("after the „Rückgängig gemacht“ hold the scan form shows no second receipt (Design, 19 Nov)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000", s = await shop(url, "stamp");
  const { context, page } = await counter(browser, url, s, { width: 390, height: 844 });
  await openTyped(page, await guestCard(url, s));
  await page.locator(".cashier-award-now").click();
  await page.locator(".cashier-booked").getByRole("button", { name: "Rückgängig" }).click();
  await expect(page.locator(".cashier-booked")).toContainText("Rückgängig gemacht");
  await expect(page.locator(".cashier-booked")).toHaveCount(0, { timeout: 8_000 });
  await expect(page.getByRole("button", { name: "Prüfen", exact: true })).toBeVisible();
  await expect(page.locator(".cashier-status")).toHaveCount(0);
  await context.close(); await s.owner.dispose();
});
