import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";

// The points ladder as the browser draws it, on the guest card (merchant colours) and at the cashier (token fallback):
// whatever selector, opacity or geometry the stylesheet ends up with, the filled part must keep 3:1 against the empty
// part on every ground behind the track, and cover balance / goal of the track. Reduced motion skips the fill animation.
test.use({ contextOptions: { reducedMotion: "reduce" } });
let owner: Awaited<ReturnType<BrowserContext["storageState"]>>, cardToken = "", scanCode = "";

test.beforeAll(async ({ playwright, baseURL }) => {
  const origin = new URL(baseURL!).origin, api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  const guest = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  const ok = async (response: APIResponse, status: number) => { expect(response.status(), response.url()).toBe(status); return response.json(); };
  await ok(await api.post("/api/auth/sign-up/email", { data: { name: "Leiter Test", email: `ladder-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } }), 200);
  const merchant = await ok(await api.post("/api/merchant/onboard", { data: { businessName: "Punkte Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", rulesText: "Ein Punkt je Besuch", rewardTitle: "Espresso", rewardCost: 5 } }), 201);
  for (const [title, cost] of [["Cappuccino", 12], ["Frühstück", 20]] as const) await ok(await api.post("/api/merchant/program/rewards", { data: { action: "create", programSlug: merchant.programSlug, title, cost } }), 201);
  ({ cardToken } = await ok(await guest.post("/api/enroll", { data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } }), 201));
  ({ scanCode } = await ok(await guest.get(`/api/card/${cardToken}`), 200));
  const member = await ok(await api.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`), 200);
  await ok(await api.post("/api/cashier/award", { data: { membershipId: member.membershipId, quantity: 9, idempotencyKey: randomUUID(), requestId: randomUUID() } }), 200);
  owner = await api.storageState(); await api.dispose(); await guest.dispose();
});

/** Contrast between filled and empty on each ground, effective opacity, and fill vs expected width. */
async function measure(page: Page) {
  const ladder = page.locator('[role="img"][aria-label$="Punkten"]').locator("visible=true").first();
  await expect(ladder).toHaveAttribute("aria-label", "9 von 20 Punkten");
  return ladder.evaluate(el => {
    const track = el.firstElementChild as HTMLElement, fill = track.firstElementChild as HTMLElement;
    const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true })!;
    const paint = (layers: string[]) => {
      ctx.clearRect(0, 0, 1, 1);
      for (const colour of layers) { ctx.fillStyle = "#010203"; ctx.fillStyle = colour; if (ctx.fillStyle === "#010203") throw new Error(`canvas cannot paint ${colour}`); ctx.fillRect(0, 0, 1, 1); }
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const lum = (px: number[]) => { const [r, g, b] = px.slice(0, 3).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100; };
    // Grounds: the gradient stops or the stacked background colours behind the ladder, down to an opaque one.
    let grounds: string[][] = [], stack: string[] = [];
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage.includes("gradient")) { grounds = (style.backgroundImage.match(/(?:rgba?|oklab|oklch|lab|lch|color|hsla?)\([^()]*\)/g) ?? []).map(stop => [stop, ...stack]); break; }
      if (paint([style.backgroundColor])[3] > 0) stack = [style.backgroundColor, ...stack];
      if (paint(stack)[3] === 255) { grounds = [stack]; break; }
    }
    const opacity = (node: Element | null) => { let value = 1; for (; node; node = node.parentElement) value *= Number(getComputedStyle(node).opacity); return value; };
    const [t, f] = [track.getBoundingClientRect(), fill.getBoundingClientRect()];
    const [trackColour, fillColour] = [getComputedStyle(track).backgroundColor, getComputedStyle(fill).backgroundColor];
    return {
      contrast: grounds.map(ground => ratio(paint([...ground, trackColour, fillColour]), paint([...ground, trackColour]))),
      grounds: grounds.length,
      visible: [track, fill].every(node => getComputedStyle(node).visibility === "visible") && opacity(fill) === 1,
      fill: Math.max(Math.abs(f.width - t.width * 9 / 20), Math.abs(f.height - t.height), Math.abs(f.left - t.left)),
      trackHeight: t.height,
    };
  });
}

for (const colorScheme of ["light", "dark"] as const) test.describe(`in ${colorScheme} mode`, () => {
  test.use({ colorScheme });

  test("the guest card ladder keeps 3:1 and fills to the balance", async ({ page }) => {
    await page.goto(`/card/${cardToken}`);
    const result = await measure(page);
    expect(result.contrast.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...result.contrast)).toBeGreaterThanOrEqual(3);
    expect(result.visible).toBe(true);
    expect(result.fill).toBeLessThanOrEqual(1);
    expect(result.trackHeight).toBeGreaterThanOrEqual(4);
  });

  test("the cashier ladder keeps 3:1 and fills to the balance", async ({ page }) => {
    await page.context().addCookies(owner.cookies);
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    const result = await measure(page);
    expect(result.grounds).toBeGreaterThanOrEqual(1);
    expect(Math.min(...result.contrast)).toBeGreaterThanOrEqual(3);
    expect(result.visible).toBe(true);
    expect(result.fill).toBeLessThanOrEqual(1);
  });
});
