import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";

// Design #300: with rewards at 3 and 8 a card's goal can change while the page is open (the guest picks the other
// reward, or a booking moment's hold ends). The change is a crossfade of the stamps and the count only, with the card's
// height eased: the ticket below slides instead of jumping 61 px, and no word is drawn in two places.
let owner: APIRequestContext, options: Parameters<typeof apiRequest.newContext>[0];
const guests: APIRequestContext[] = [];
test.beforeAll(async ({ baseURL }) => {
  const url = baseURL ?? "http://localhost:3000";
  options = { baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } };
  owner = await apiRequest.newContext(options);
  expect((await owner.post("/api/auth/sign-up/email", { headers: { "x-loynara-acceptance": "2026-11-20" }, data: { name: "Synthetic goal owner", email: `owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
});
test.afterAll(async () => { await owner.dispose(); for (const guest of guests) await guest.dispose(); });

let programSlug = "";
async function card() {
  if (!programSlug) {
    const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "One confirmed visit", rewardTitle: "Gratiskaffee", rewardCost: 8 } });
    expect(setup.status()).toBe(201);
    ({ programSlug } = await setup.json() as { programSlug: string });
    expect((await owner.post("/api/merchant/program/rewards", { data: { action: "create", programSlug, title: "Kleiner Kaffee", cost: 3, termsText: "Ein kleiner Kaffee." } })).status()).toBe(201);
  }
  const guest = await apiRequest.newContext(options); // one card per guest and programme
  guests.push(guest);
  const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } });
  expect(joined.status()).toBe(201);
  const { cardToken } = await joined.json() as { cardToken: string };
  const read = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string; stampMoment?: object };
  const { membershipId } = await (await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(read.scanCode)}`)).json() as { membershipId: string };
  const award = async (quantity: number) => expect((await owner.post("/api/cashier/award", { data: { membershipId, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);
  return { cardToken, award, moments: "stampMoment" in read };
}

/** Every frame from now: the ticket's top, and how many foot lines the faded copy shows (it must show none). */
const trace = (page: Page) => page.evaluate(() => {
  const ticket = document.querySelector(".customer-qr-panel")!;
  const seen = { tops: [] as number[], copies: 0, footInCopy: 0, dimmed: 0, shadowless: 0 };
  (window as unknown as { seen: typeof seen }).seen = seen;
  const look = () => {
    seen.tops.push(ticket.getBoundingClientRect().top + window.scrollY);
    const copy = document.querySelector("[aria-hidden=true][inert]");
    if (copy) {
      seen.copies += 1;
      seen.footInCopy += [...copy.querySelectorAll("p")].filter(p => getComputedStyle(p).visibility === "visible").length;
      // The live card stays at full opacity under the copy, and its shadow (on the card or, while growing, its box) stays.
      const box = copy.parentElement!, live = box.firstElementChild!;
      if ([live, live.querySelector('[role="img"]')!].some(node => Number(getComputedStyle(node).opacity) < 1)) seen.dimmed += 1;
      if (getComputedStyle(box).boxShadow === "none" && getComputedStyle(live).boxShadow === "none") seen.shadowless += 1;
    }
    requestAnimationFrame(look);
  };
  look();
});

async function slid(page: Page) {
  await page.waitForTimeout(600);
  const seen = await page.evaluate(() => (window as unknown as { seen: { tops: number[]; copies: number; footInCopy: number; dimmed: number; shadowless: number } }).seen);
  const steps = seen.tops.slice(1).map((top, i) => Math.abs(top - seen.tops[i]));
  const move = seen.tops.at(-1)! - seen.tops[0];
  expect(move, "the taller card moved the ticket down").toBeGreaterThan(40);
  // The height eases over --dur-ui (the ready band's easing): the move is spread over frames, never one cut.
  expect(Math.max(...steps), `largest per-frame step of the ${move} px move`).toBeLessThan(move / 2);
  expect(steps.filter(step => step > 0.5).length, "frames the ticket moved in").toBeGreaterThanOrEqual(5);
  expect(seen.copies, "the old stamps and count faded out").toBeGreaterThan(0);
  expect(seen.footInCopy, "no foot line in the faded copy: the foot is drawn once").toBe(0);
  expect(seen.dimmed, "frames in which the live card or its stamps were dimmed").toBe(0);
  expect(seen.shadowless, "frames in which the card had no shadow").toBe(0);
  expect(await page.locator("[aria-hidden=true][inert]").count(), "the faded copy is removed").toBe(0);
}

test("picking the larger reward crossfades the stamps and slides the ticket", async ({ browser, baseURL }) => {
  const { cardToken, award } = await card();
  await award(2);
  const page = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/card/${cardToken}`);
  await expect(page.getByRole("img", { name: "2 von 3 Stempeln", exact: true })).toBeVisible();
  await page.waitForTimeout(800); // the first paint's motion
  await trace(page);
  await page.getByRole("button", { name: /^Gratiskaffee/ }).click();
  await expect(page.getByRole("img", { name: "2 von 8 Stempeln", exact: true })).toBeVisible();
  await slid(page);
});

test("an earned stamp keeps its pixels through the crossfade", async ({ browser, baseURL, browserName }) => {
  test.skip(browserName !== "chromium", "slowing the animations needs the Chrome DevTools protocol");
  const { cardToken, award } = await card();
  await award(2);
  const page = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/card/${cardToken}`);
  const grid = page.getByRole("img", { name: "2 von 3 Stempeln", exact: true });
  await expect(grid).toBeVisible();
  await page.waitForTimeout(800);
  const stamp = (await grid.locator(":scope > span").first().boundingBox())!;
  const centre = { x: Math.round(stamp.x + stamp.width / 2) - 2, y: Math.round(stamp.y + stamp.height / 4) - 2, width: 4, height: 4 };
  const at = () => page.screenshot({ clip: centre, animations: "allow" });
  const rest = await at();
  // 25 times slower, so the 220 ms crossfade is caught in several shots.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.04 });
  await page.getByRole("button", { name: /^Gratiskaffee/ }).click();
  let shots = 0;
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(700);
    if (await page.locator("[aria-hidden=true][inert]").count()) shots += 1;
    expect((await at()).equals(rest), `the earned stamp's pixels in shot ${i}`).toBe(true);
  }
  expect(shots, "shots taken during the crossfade").toBeGreaterThan(2);
});

test("the goal released after a booking moment slides the ticket instead of jumping it", async ({ browser, baseURL }) => {
  const { cardToken, award, moments } = await card();
  // The moment plays only with STAMP_ANIMATION_ENABLED on the server; its card read then carries stampMoment.
  test.skip(!moments, "the booking moment is off on this server");
  await award(2);
  const page = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/card/${cardToken}`);
  await expect(page.getByRole("img", { name: "2 von 3 Stempeln", exact: true })).toBeVisible();
  await award(1);
  await page.getByRole("button", { name: "Karte aktualisieren" }).click();
  await expect(page.getByRole("img", { name: "3 von 3 Stempeln", exact: true })).toBeVisible(); // the stamp lands on the held card
  // The ready band opens with the stamp; once it has, only the release is traced.
  await page.waitForTimeout(1500);
  await expect(page.getByRole("img", { name: "3 von 3 Stempeln", exact: true })).toBeVisible();
  await trace(page);
  await expect(page.getByRole("img", { name: "3 von 8 Stempeln", exact: true })).toBeVisible({ timeout: 15_000 });
  await slid(page);
});
