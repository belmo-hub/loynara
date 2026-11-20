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
async function card(mode: "manual" | "purchase" = "manual") {
  const costs = mode === "manual" ? [60, 150, 300] : [50, 150, 300];
  if (!slugs[mode]) {
    owners[mode] = await apiRequest.newContext(options);
    expect((await owners[mode].post("/api/auth/sign-up/email", { data: { name: "Synthetic points owner", email: `points-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const setup = await owners[mode].post("/api/merchant/onboard", { data: { businessName: "Synthetic Pizzeria", locationName: `Kassel ${mode}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", earningMode: mode, pointsPerCurrencyUnit: 1, rulesText: "Punkte an der Kasse.", rewardTitle: "Espresso", rewardCost: costs[0] } });
    expect(setup.status()).toBe(201);
    slugs[mode] = (await setup.json() as { programSlug: string }).programSlug;
    for (const cost of costs.slice(1)) expect((await owners[mode].post("/api/merchant/program/rewards", { data: { action: "create", programSlug: slugs[mode], title: cost === 150 ? "Pizza" : "Menü", cost, termsText: "Eine Prämie." } })).status()).toBe(201);
  }
  const owner = owners[mode], guest = await apiRequest.newContext(options);
  guests.push(guest);
  const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: slugs[mode], acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken: string };
  const read = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string; stampMoment?: object };
  const { membershipId, ruleVersionId } = await (await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(read.scanCode)}`)).json() as { membershipId: string; ruleVersionId: string };
  const award = async (points: number) => {
    const answer = await owner.post("/api/cashier/award", { data: { membershipId, idempotencyKey: randomUUID(), requestId: randomUUID(), ...(mode === "manual" ? { quantity: points } : { purchaseAmountMinor: points * 100, ruleVersionId }) } });
    expect(answer.status(), await answer.text()).toBe(200);
  };
  return { cardToken, scanCode: read.scanCode, award, owner, moments: "stampMoment" in read };
}

/** The ladder inside the mix card: its open markers' discs, its reached ones, and no house card anywhere. */
async function mixLadder(page: Page, label: string) {
  const ladder = page.locator('[role="img"][data-tone="mix"]');
  await expect(ladder).toHaveAttribute("aria-label", label);
  await expect(page.locator(".customer-balance-line, #cashier-card-title")).toHaveCount(0);
  const open = await ladder.evaluate(el => [...el.querySelectorAll(":scope > span:not([data-reached]) > span")].map(dot => { const s = getComputedStyle(dot); return { border: s.borderTopWidth, background: s.backgroundColor }; }));
  for (const dot of open) { expect(dot.border).toBe("0px"); expect(dot.background).not.toBe("rgba(0, 0, 0, 0)"); }
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

test("a points booking presses the crossed markers in order, 90 ms apart, then opens the band", async ({ browser, baseURL }) => {
  const { cardToken, award, moments } = await card();
  test.skip(!moments, "the booking moment is off on this server");
  await award(21);
  const page = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/card/${cardToken}`);
  await mixLadder(page, "21 von 300 Punkten");
  await page.waitForTimeout(800);
  const head = await page.locator(".customer-header").boundingBox();
  await award(165);
  await page.getByRole("button", { name: "Karte aktualisieren" }).click();
  await expect(page.locator('[role="img"][data-tone="mix"]')).toHaveAttribute("aria-label", "186 von 300 Punkten");
  const timing = await page.evaluate(() => {
    const marks = [...document.querySelectorAll('[role="img"][data-tone="mix"] > span[data-new]')];
    const presses = marks.map(m => { const a = m.querySelector(":scope > span")!.getAnimations()[0]; const t = a?.effect?.getTiming(); return { name: /land/.test((a as CSSAnimation | undefined)?.animationName ?? "") ? "land" : (a as CSSAnimation | undefined)?.animationName, delay: Number(t?.delay), duration: Number(t?.duration), cost: m.querySelector("small")!.textContent }; });
    const band = document.querySelector("[data-arrive]");
    const open = band?.getAnimations().map(a => Number(a.effect?.getTiming().delay));
    // The mark itself does not move: its transform places it on the track.
    const still = marks.every(m => m.getAnimations().length === 0);
    return { presses, open, still };
  });
  expect(timing.presses.map(p => [p.cost, p.name])).toEqual([["60", "land"], ["150", "land"]]);
  expect(timing.presses[1].delay - timing.presses[0].delay).toBeCloseTo(90, 0);
  expect(timing.still).toBe(true);
  // The band opens as the second press ends: --dur-ui + --dur-reward + 90 ms.
  const lastEnd = timing.presses[1].delay + timing.presses[1].duration;
  for (const delay of timing.open ?? []) expect(delay).toBeCloseTo(lastEnd, 0);
  expect(timing.open?.length).toBeGreaterThan(0);
  expect(await page.locator(".customer-header").boundingBox()).toEqual(head); // nothing above the card moves
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
  const pressed = await ladder.evaluate(el => [...el.querySelectorAll(":scope > span[data-new]")].map(m => [m.querySelector("small")!.textContent, (m.querySelector(":scope > span")!.getAnimations()[0] as CSSAnimation | undefined)?.animationName.replace(/^.*land.*$/, "land")]));
  expect(pressed).toEqual([["50", "land"]]);
  // The next open of the card offers the reward the booking made ready.
  await expect(page.locator(".cashier-booked")).toHaveCount(0, { timeout: 8_000 });
  await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await expect(page.locator(".cashier-redeem-now")).toBeVisible();
  await context.close();
});
