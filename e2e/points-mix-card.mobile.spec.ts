import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";

// ENG-292 (Design, 19 Nov, part 1): a points programme is the mix card on the guest card and at the Kasse. A booking
// that crosses markers presses each once, 90 ms apart after --dur-ui, and the ready band opens after the last press.
// One owner per shop: the Kasse counts at the owner's one location.
const owners: Record<string, APIRequestContext> = {};
let options: Parameters<typeof apiRequest.newContext>[0];
const guests: APIRequestContext[] = [];
test.beforeAll(async ({ baseURL }) => {
  const url = baseURL ?? "http://localhost:3000";
  options = { baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } };
});
test.afterAll(async () => { for (const context of [...Object.values(owners), ...guests]) await context.dispose(); });

/** A points shop, once per run: manual with rewards at 60 / 150 / 300 (the guest card), or by purchase amount with 50 / 150 / 300 (the Kasse). */
const slugs: Record<string, string> = {};
async function card(kind: "manual" | "purchase" = "manual", middle = "Pizza") {
  const costs = kind === "manual" ? [60, 150, 300] : [50, 150, 300], mode = `${kind}:${middle}`, earningMode = kind;
  if (!slugs[mode]) {
    owners[mode] = await apiRequest.newContext(options);
    expect((await owners[mode].post("/api/auth/sign-up/email", { data: { name: "Synthetic points owner", email: `points-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const setup = await owners[mode].post("/api/merchant/onboard", { data: { businessName: "Synthetic Pizzeria", locationName: `Kassel ${kind}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", earningMode, pointsPerCurrencyUnit: 1, rulesText: "Punkte an der Kasse.", rewardTitle: "Espresso", rewardCost: costs[0] } });
    expect(setup.status()).toBe(201);
    slugs[mode] = (await setup.json() as { programSlug: string }).programSlug;
    for (const cost of costs.slice(1)) expect((await owners[mode].post("/api/merchant/program/rewards", { data: { action: "create", programSlug: slugs[mode], title: cost === 150 ? middle : "Menü", cost, termsText: "Eine Prämie." } })).status()).toBe(201);
  }
  const owner = owners[mode], guest = await apiRequest.newContext(options);
  guests.push(guest);
  const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: slugs[mode], acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken: string };
  const read = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string; stampMoment?: object };
  const { membershipId, ruleVersionId } = await (await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(read.scanCode)}`)).json() as { membershipId: string; ruleVersionId: string };
  const award = async (points: number) => {
    const answer = await owner.post("/api/cashier/award", { data: { membershipId, idempotencyKey: randomUUID(), requestId: randomUUID(), ...(kind === "manual" ? { quantity: points } : { purchaseAmountMinor: points * 100, ruleVersionId }) } });
    expect(answer.status(), await answer.text()).toBe(200);
  };
  return { cardToken, scanCode: read.scanCode, award, owner, moments: "stampMoment" in read };
}

/** The ladder inside the mix card: its open markers' discs, its reached ones, and no house card anywhere. */
async function mixLadder(page: Page, label: string, forced = false) {
  const ladder = page.locator('[role="img"][data-tone="mix"]');
  await expect(ladder).toHaveAttribute("aria-label", label);
  await expect(page.locator(".customer-balance-line, #cashier-card-title")).toHaveCount(0);
  const open = await ladder.evaluate(el => [...el.querySelectorAll(":scope > span:not([data-reached]) > span")].map(dot => { const s = getComputedStyle(dot); return { border: s.borderTopWidth, background: s.backgroundColor }; }));
  for (const dot of open) { expect(dot.border).toBe(forced ? "1px" : "0px"); expect(dot.background).not.toBe("rgba(0, 0, 0, 0)"); }
  return ladder;
}

test("the guest card draws a points programme on the mix card, the goal in its foot", async ({ browser, baseURL }) => {
  const { cardToken, award } = await card();
  await award(21);
  const page = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/card/${cardToken}`);
  const ladder = await mixLadder(page, "21 von 300 Punkten");
  await expect(ladder.locator(":scope > span")).toHaveCount(3);
  const section = page.getByRole("region", { name: "Deine Treuekarte" });
  await expect(section.locator("[data-figure]")).toHaveText("21");
  await expect(section).toContainText("Noch 39 Punkte bis zu deiner Prämie: Espresso");
  expect(await section.evaluate(el => getComputedStyle(el).borderTopLeftRadius)).toBe("28px");
});

/** Each crossed marker's press (the pop after the open hold), in order: its cost, delay and duration in ms. */
const presses = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[role="img"][data-tone="mix"] > span[data-new]')].map(m => {
  const pop = m.querySelector(":scope > span")!.getAnimations().find(a => /pop/.test((a as CSSAnimation).animationName));
  const t = pop?.effect?.getTiming();
  return { cost: m.querySelector("small")!.textContent, pop: Boolean(pop), delay: Number(t?.delay), duration: Number(t?.duration) };
}));

test("a points booking presses the crossed markers in order, 90 ms apart, then opens the band with the new words", async ({ browser, baseURL }) => {
  const { cardToken, award, moments } = await card();
  test.skip(!moments, "the booking moment is off on this server");
  await award(21);
  const page = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/card/${cardToken}`);
  await mixLadder(page, "21 von 300 Punkten");
  await page.waitForTimeout(800);
  const head = await page.locator(".customer-header").boundingBox();
  // Every frame from the tap: the foot's first line, the card's height, the band's height (Design, 20 Nov).
  await page.evaluate(() => {
    const frames: Array<{ t: number; words: string; card: number; band: number }> = [];
    (window as unknown as { frames292: typeof frames }).frames292 = frames;
    const start = performance.now();
    const tick = () => {
      const card = document.querySelector<HTMLElement>(".customer-card section")!, band = document.querySelector("[data-arrive]");
      frames.push({ t: performance.now() - start, words: card.querySelector(".reward-remaining")?.textContent ?? "", card: card.getBoundingClientRect().height, band: band?.getBoundingClientRect().height ?? 0 });
      if (performance.now() - start < 8000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await award(165);
  await page.getByRole("button", { name: "Karte aktualisieren" }).click();
  await expect(page.locator('[role="img"][data-tone="mix"]')).toHaveAttribute("aria-label", "186 von 300 Punkten");
  const timing = await page.evaluate(() => {
    const band = document.querySelector("[data-arrive]");
    return { open: band?.getAnimations().map(a => Number(a.effect?.getTiming().delay)), still: [...document.querySelectorAll('[role="img"][data-tone="mix"] > span[data-new]')].every(m => m.getAnimations().length === 0) };
  });
  const pressed = await presses(page);
  expect(pressed.map(p => [p.cost, p.pop])).toEqual([["60", true], ["150", true]]);
  expect(pressed[1].delay - pressed[0].delay).toBeCloseTo(90, 0);
  expect(timing.still).toBe(true); // the mark itself does not move: its transform places it on the track
  // The band opens as the second press ends: --dur-ui + --dur-reward + 90 ms.
  const lastEnd = pressed[1].delay + pressed[1].duration;
  for (const delay of timing.open ?? []) expect(delay).toBeCloseTo(lastEnd, 0);
  expect(timing.open?.length).toBeGreaterThan(0);
  // A crossed marker is never gone while it waits: during its delay it is the open disc, at full opacity.
  const waiting = await page.evaluate(() => {
    const ladder = document.querySelector('[role="img"][data-tone="mix"]')!, dots = [...ladder.querySelectorAll(":scope > span > span")] as HTMLElement[];
    document.getAnimations().forEach(a => { a.pause(); a.currentTime = 100; });
    const read = (el: HTMLElement) => { const s = getComputedStyle(el); return { background: s.backgroundColor, opacity: s.opacity }; };
    const out = { crossed: dots.slice(0, 2).map(read), open: read(dots[2]) };
    document.getAnimations().forEach(a => a.finish());
    return out;
  });
  for (const dot of waiting.crossed) expect(dot).toEqual(waiting.open);
  await page.waitForTimeout(5000);
  const frames = await page.evaluate(() => (window as unknown as { frames292: Array<{ t: number; words: string; card: number; band: number }> }).frames292);
  // The foot keeps the words for the balance shown until the band opens; then the new words, and the card grows smoothly.
  const firstReady = frames.findIndex(f => f.words.includes("bereit")), firstBand = frames.findIndex(f => f.band > 0);
  expect(firstReady, JSON.stringify([frames.length, frames.at(-1)])).toBeGreaterThan(0); expect(firstBand).toBeGreaterThan(0);
  expect(frames[firstReady].t).toBeGreaterThanOrEqual(frames[firstBand].t - 40);
  for (const f of frames.slice(0, firstReady)) expect(f.words).toContain("Noch");
  const jumps = frames.slice(1).map((f, i) => Math.abs(f.card - frames[i].card));
  expect(Math.max(...jumps)).toBeLessThan(12);
  expect(frames.at(-1)!.card - frames[0].card).toBeGreaterThan(12); // the second line did open
  expect(await page.locator(".customer-header").boundingBox()).toEqual(head); // nothing above the card moves
});

/** One open disc's centre (over the track) and its top inside edge (off the track), from the screen. */
async function discPixels(page: Page) {
  const dot = page.locator('[role="img"][data-tone="mix"] > span:not([data-reached]) > span').last();
  await dot.scrollIntoViewIfNeeded();
  const box = (await dot.boundingBox())!;
  const png = await page.screenshot({ clip: box, scale: "css", animations: "disabled", caret: "hide" });
  return page.evaluate(async ([src, w, h]) => {
    const image = new Image(); image.src = src as string; await image.decode();
    const ctx = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height }).getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    const at = (x: number, y: number) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
    return { centre: at(Number(w) / 2, Number(h) / 2), edge: at(Number(w) / 2, 5) };
  }, [`data:image/png;base64,${png.toString("base64")}`, box.width, box.height] as const);
}

for (const colorScheme of ["light", "dark"] as const) test(`an open marker is opaque: its centre over the track is its edge off it (${colorScheme})`, async ({ browser, baseURL }) => {
  const { cardToken, award } = await card();
  await award(21);
  const page = await (await browser.newContext({ baseURL, colorScheme, viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/card/${cardToken}`);
  await mixLadder(page, "21 von 300 Punkten");
  await page.waitForTimeout(800);
  const { centre, edge } = await discPixels(page);
  for (const c of [0, 1, 2]) expect(Math.abs(centre[c] - edge[c]), `${centre} against ${edge}`).toBeLessThanOrEqual(2);
});

test("in forced colours an open marker is a Canvas disc with its ring", async ({ browser, baseURL }) => {
  const { cardToken, award } = await card();
  await award(21);
  const page = await (await browser.newContext({ baseURL, forcedColors: "active", viewport: { width: 390, height: 1200 } })).newPage();
  await page.goto(`/card/${cardToken}`);
  await mixLadder(page, "21 von 300 Punkten", true);
  const dot = await page.locator('[role="img"][data-tone="mix"] > span:not([data-reached]) > span').last().evaluate(el => getComputedStyle(el).borderTopWidth);
  expect(dot).toBe("1px");
  const { centre, edge } = await discPixels(page);
  for (const c of [0, 1, 2]) expect(Math.abs(centre[c] - edge[c]), `${centre} against ${edge}`).toBeLessThanOrEqual(2);
});

const LONG = "Pizza Margherita mit Büffelmozzarella";
/** The ladder's names: none cut with an ellipsis; a hidden one keeps its cost. */
const namesWhole = async (ladder: ReturnType<Page["locator"]>) => {
  const names = await ladder.evaluate(el => [...el.querySelectorAll("small[data-title]")].map(n => ({ hidden: getComputedStyle(n).visibility === "hidden", cut: n.scrollWidth > n.clientWidth + 1, cost: getComputedStyle(n.previousElementSibling!).visibility })));
  expect(names).toHaveLength(3);
  for (const n of names) { if (!n.hidden) expect(n.cut).toBe(false); expect(n.cost).toBe("visible"); }
};
// Design, 20 Nov: in the mix tone a name without room hides as at 390 (its cost and dot stay), never „Pizza Marghe…“.
for (const width of [390, 880, 1440]) test(`no reward name is cut at ${width}`, async ({ browser, baseURL }) => {
  const { cardToken, award } = await card("manual", LONG);
  await award(21);
  const page = await (await browser.newContext({ baseURL, viewport: { width, height: 900 } })).newPage();
  await page.goto(`/card/${cardToken}`);
  const ladder = await mixLadder(page, "21 von 300 Punkten");
  await page.waitForTimeout(500);
  await namesWhole(ladder);
});

test("the Kasse draws a points card on the mix card and presses the marker a booking crossed", async ({ browser, baseURL }) => {
  const { scanCode, award, owner } = await card("purchase");
  await award(42);
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/cashier");
  await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Karte gefunden." })).toBeAttached();
  const ladder = await mixLadder(page, "42\u00a0von 300\u00a0Punkten");
  await expect(ladder.locator(":scope > span")).toHaveCount(3);
  await expect(page.locator(".card-result-head")).toContainText("Aktueller Kontostand");
  await expect(page.locator(".card-result-head [data-figure]")).toHaveText("42\u00a0Punkte");
  await page.getByRole("button", { name: "Kaufbetrag eingeben" }).first().click();
  await page.getByLabel("Kaufbetrag (EUR)").fill("12,50");
  await page.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.getByRole("button", { name: "Ja, vergeben", exact: true }).click();
  await expect(page.locator(".cashier-booked")).toContainText("54\u00a0Punkte");
  expect((await presses(page)).map(p => [p.cost, p.pop])).toEqual([["50", true]]);
  // The next open of the card offers the reward the booking made ready.
  await expect(page.locator(".cashier-booked")).toHaveCount(0, { timeout: 8_000 });
  await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await expect(page.locator(".cashier-redeem-now")).toBeVisible();
  await context.close();
});

// Design, 20 Nov: at the Kasse the crossed markers press 90 ms apart, as on the guest card, and no name is cut.
for (const [width, height] of [[390, 844], [880, 900], [1280, 900]]) test(`the Kasse staggers two crossed markers and keeps every name whole (${width})`, async ({ browser, baseURL }) => {
  const { scanCode, award, owner } = await card("purchase", LONG);
  await award(42);
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width, height } });
  const page = await context.newPage();
  await page.goto("/cashier");
  await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  const ladder = await mixLadder(page, "42\u00a0von 300\u00a0Punkten");
  await page.waitForTimeout(400);
  await namesWhole(ladder);
  await page.getByRole("button", { name: "Kaufbetrag eingeben" }).first().click();
  await page.getByLabel("Kaufbetrag (EUR)").fill("120,00");
  await page.getByRole("button", { name: "Buchen", exact: true }).click();
  await page.getByRole("button", { name: "Ja, vergeben", exact: true }).click();
  await expect(page.locator(".cashier-booked")).toContainText("162\u00a0Punkte");
  const pressed = await presses(page);
  expect(pressed.map(p => [p.cost, p.pop])).toEqual([["50", true], ["150", true]]);
  expect(pressed[1].delay - pressed[0].delay).toBeCloseTo(90, 0);
  await context.close();
});
