import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";

// The points ladder as it appears on screen, on the guest card and at the cashier, light and dark, for the default
// shop green and the worst merchant colour (#757778, 3.009:1 in merchant-color.test.ts). The track row is read from a
// screenshot, so whatever the stylesheet does (selectors, opacity, filters, clipping, overlays, grounds) the pixels
// that show progress must keep 3:1 against the pixels that show the rest, and progress must end at 9 of 20.
test.use({ contextOptions: { reducedMotion: "reduce" } });
test.describe.configure({ mode: "serial" });
let owner: Awaited<ReturnType<BrowserContext["storageState"]>>, programSlug = "", cardToken = "", scanCode = "";

test.beforeAll(async ({ playwright, baseURL }) => {
  const origin = new URL(baseURL!).origin, api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  const guest = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  const ok = async (response: APIResponse, status: number) => { expect(response.status(), response.url()).toBe(status); return response.json(); };
  await ok(await api.post("/api/auth/sign-up/email", { data: { name: "Leiter Test", email: `ladder-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } }), 200);
  ({ programSlug } = await ok(await api.post("/api/merchant/onboard", { data: { businessName: "Punkte Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", rulesText: "Ein Punkt je Besuch", rewardTitle: "Espresso", rewardCost: 5 } }), 201));
  for (const [title, cost] of [["Cappuccino", 12], ["Frühstück", 20]] as const) await ok(await api.post("/api/merchant/program/rewards", { data: { action: "create", programSlug, title, cost } }), 201);
  ({ cardToken } = await ok(await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } }), 201));
  ({ scanCode } = await ok(await guest.get(`/api/card/${cardToken}`), 200));
  const member = await ok(await api.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`), 200);
  await ok(await api.post("/api/cashier/award", { data: { membershipId: member.membershipId, quantity: 9, idempotencyKey: randomUUID(), requestId: randomUUID() } }), 200);
  owner = await api.storageState(); await api.dispose(); await guest.dispose();
});

const luminance = (px: number[]) => { const [r, g, b] = px.map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const median = (pixels: number[][]) => [0, 1, 2].map(c => pixels.map(px => px[c]).sort((x, y) => x - y)[pixels.length >> 1]);

/** Lowest contrast between 8-px windows of the filled and of the empty part of the track row, markers left out. */
async function ladderOnScreen(page: Page) {
  const ladder = page.locator('[role="img"][aria-label$="Punkten"]').locator("visible=true").first();
  await expect(ladder).toHaveAttribute("aria-label", "9 von 20 Punkten");
  await ladder.scrollIntoViewIfNeeded();
  const box = await ladder.evaluate(el => {
    const outer = el.getBoundingClientRect(), track = el.firstElementChild!.getBoundingClientRect();
    const marks = [...el.children].slice(1).map(mark => mark.firstElementChild!.getBoundingClientRect()).map(r => [r.left, r.right]);
    return { outer: { left: outer.left, right: outer.right, top: outer.top, bottom: outer.bottom }, x: track.left, y: track.top, width: track.width, height: track.height, marks };
  });
  // The track spans the ladder (it overhangs by 14 px each side) and is tall enough to see.
  expect(box.width).toBeGreaterThanOrEqual(box.outer.right - box.outer.left);
  expect(box.height).toBeGreaterThanOrEqual(4);
  expect(box.y).toBeGreaterThanOrEqual(box.outer.top); expect(box.y + box.height).toBeLessThanOrEqual(box.outer.bottom);
  const png = await page.screenshot({ clip: { x: box.x, y: box.y + box.height / 2 - 0.5, width: box.width, height: 1 }, scale: "css", animations: "disabled", caret: "hide" });
  const row = await page.evaluate(async src => {
    const image = new Image(); image.src = src; await image.decode();
    const ctx = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height }).getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(0, 0, image.width, 1).data];
  }, `data:image/png;base64,${png.toString("base64")}`);
  const columns = Array.from({ length: row.length / 4 }, (_, i) => ({ x: box.x + i, px: row.slice(i * 4, i * 4 + 3) }))
    .filter(({ x }) => x > box.x + 6 && x < box.x + box.width - 6 && !box.marks.some(([left, right]) => x > left - 2 && x < right + 2));
  const end = box.x + box.width * 9 / 20;
  const windows = (part: typeof columns) => Array.from({ length: Math.floor(part.length / 8) }, (_, i) => median(part.slice(i * 8, i * 8 + 8).map(c => c.px)));
  const filled = windows(columns.filter(c => c.x < end - 3)), empty = windows(columns.filter(c => c.x > end + 3));
  expect(filled.length).toBeGreaterThanOrEqual(3); expect(empty.length).toBeGreaterThanOrEqual(3);
  return Math.min(...filled.flatMap(f => empty.map(e => contrast(f, e))));
}

for (const brandColor of ["#245D47", "#757778"]) for (const colorScheme of ["light", "dark"] as const) test.describe(`${brandColor} in ${colorScheme} mode`, () => {
  test.use({ colorScheme });
  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies(owner.cookies);
    const response = await page.request.post("/api/merchant/program/brand", { headers: { Origin: new URL(baseURL!).origin }, data: { programSlug, businessName: "Punkte Café", locationName: "Punkte Café", brandColor } });
    expect(response.status()).toBe(200);
  });

  test("the guest card ladder keeps 3:1 and ends at the balance", async ({ page }) => {
    await page.goto(`/card/${cardToken}`);
    expect(await ladderOnScreen(page)).toBeGreaterThanOrEqual(3);
  });

  test("the cashier ladder keeps 3:1 and ends at the balance", async ({ page }) => {
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    expect(await ladderOnScreen(page)).toBeGreaterThanOrEqual(3);
  });
});
