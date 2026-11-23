import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, request as apiRequest, test, type Locator, type Page } from "@playwright/test";

// ENG-363 (Design round 3): rows whose second part goes under the first only under large text. At 100 % the longest
// real labels and values keep every part on its own line, as before, from 320 to 390 (facts also at 650, beside the card);
// at 200 % no part sits on another and nothing scrolls sideways.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string; cashierEmail: string; cashierPassword: string; programSlug: string; cardToken: string };
test.describe.configure({ mode: "serial" });
// Measured still: the card's rows arrive with motion, and a box read mid-motion is not where the row ends up.
test.beforeEach(({ page }) => page.emulateMedia({ reducedMotion: "reduce" }));

async function signIn(page: Page, email: string, password: string) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const api = await apiRequest.newContext({ baseURL: origin });
  expect((await api.post("/api/auth/sign-in/email", { data: { email, password }, headers: { Origin: origin } })).ok()).toBe(true);
  await page.context().addCookies((await api.storageState()).cookies);
  await api.dispose();
}
const text = (locator: Locator, value: string) => locator.evaluate((element, next) => { element.textContent = next; }, value);
/** Waits until the page stands still (capped at 2 s), so a box is read where the part ends up. */
const settled = (page: Page) => page.evaluate(async () => {
  // Until nothing animates and the layout reads the same 100 ms apart (a container query can start a transition late).
  const shape = () => `${document.documentElement.scrollWidth} ${document.documentElement.scrollHeight} ${[...document.querySelectorAll("main *")].slice(0, 400).map(element => { const box = element.getBoundingClientRect(); return `${box.x | 0},${box.y | 0},${box.width | 0}`; }).join(" ")}`;
  let last = "";
  for (const started = performance.now(); performance.now() - started < 3_000;) {
    await new Promise(done => setTimeout(done, 100));
    const now = shape();
    if (now === last && !document.getAnimations().some(animation => animation.playState === "running")) return;
    last = now;
  }
});const scale = async (page: Page, percent: number) => { await page.addStyleTag({ content: `html { font-size: ${percent}% !important }` }); await settled(page); };
/** True when b starts on a line a still covers: the two sit side by side, not one under the other. */
async function beside(a: Locator, b: Locator) {
  const [x, y] = [await a.boundingBox(), await b.boundingBox()];
  if (!x || !y) throw new Error("row part not rendered");
  return y.y < x.y + x.height - 1;
}
/** True when the two boxes cover each other: one part sits on the other. */
async function overlap(a: Locator, b: Locator) {
  const [x, y] = [await a.boundingBox(), await b.boundingBox()];
  if (!x || !y) throw new Error("row part not rendered");
  return x.x < y.x + y.width - 1 && y.x < x.x + x.width - 1 && x.y < y.y + y.height - 1 && y.y < x.y + x.height - 1;
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** A card number from the owner's list, read once: the card API would spend the demo card's read budget, which other specs need. */
let cardNumber: Promise<string> | null = null;
function anyCardNumber() {
  cardNumber ??= (async () => {
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const api = await apiRequest.newContext({ baseURL: origin });
    expect((await api.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword }, headers: { Origin: origin } })).ok()).toBe(true);
    const list = await (await api.get(`/api/merchant/customers?programSlug=${demo.programSlug}`)).json() as { members: Array<Record<string, unknown>> };
    await api.dispose();
    const found = list.members.flatMap(member => Object.values(member)).find((value): value is string => typeof value === "string" && /^K-[A-Z0-9]{6}$/.test(value));
    if (!found) throw new Error("no card number in the owner's list");
    return found;
  })();
  return cardNumber;
}

async function openKasseCard(page: Page) {
  const number = await anyCardNumber();
  await page.goto("/cashier");
  await page.locator("#cashier-code").fill(number);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await page.getByRole("button", { name: "Karte öffnen", exact: true }).click();
  await expect(page.locator("[class*=__kasse] [class*=__foot] button")).toBeVisible();
  await settled(page);
}
const kasse = (page: Page) => ({ id: page.locator("[class*=__kasse] [class*=__id]").first(), n: page.locator("[class*=__kasse] [class*=__n]").first(), button: page.locator("[class*=__kasse] [class*=__foot] button").first(), note: page.locator("[class*=__kasse] [class*=__foot] > p").first() });

test("the Kasse card keeps the balance beside the number and the note beside the button at 100 %, and keeps them apart at 200 %", async ({ page }) => {
  await signIn(page, demo.cashierEmail, demo.cashierPassword);
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await openKasseCard(page);
    const card = kasse(page);
    expect(await beside(card.id, card.n), `balance beside the number at ${width}`).toBe(true);
    if (await card.note.count()) expect(await beside(card.button, card.note), `note beside the button at ${width}`).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openKasseCard(page);
  await scale(page, 200);
  const card = kasse(page);
  expect(await overlap(card.id, card.n)).toBe(false);
  if (await card.note.count()) expect(await overlap(card.button, card.note)).toBe(false);
  expect(await sideways(page)).toBe(0);
});

test("the card's activity row keeps the longest bonus label beside its amount at 100 %, and keeps it apart at 200 %", async ({ page }) => {
  const row = () => page.locator("[class*=__activityBody]").first();
  const label = () => row().locator("b").first();
  const amount = () => row().locator("[class*=__amount]");
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/card/${demo.cardToken}`);
    await expect(row()).toBeVisible();
    await settled(page);
    await text(label(), "Willkommen-zurück-Bonus");
    expect(await beside(label(), amount()), `amount beside the label at ${width}`).toBe(true);
  }
  await scale(page, 200);
  await text(label(), "Gesammelt");
  expect(await overlap(row().locator("> :first-child"), amount())).toBe(false);
  expect(await sideways(page)).toBe(0);
});

test("the Kunden card keeps the longest details and dates beside their labels at 100 %, and keeps them apart at 200 %", async ({ page }) => {
  await signIn(page, demo.ownerEmail, demo.ownerPassword);
  const members = await (await page.request.get(`/api/merchant/customers?programSlug=${demo.programSlug}`)).json() as { members: Array<{ id: string }> };
  const open = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/merchant/customers?card=${members.members[0].id}`);
    await expect(page.locator("[class*=__value]").first()).toBeVisible();
    await settled(page);
  };
  const pairs = async (key: string, value: string) => {
    const rows = page.locator(`div:has(> [class*=${key}]):has(> [class*=${value}])`);
    const out: Array<[Locator, Locator]> = [];
    for (let index = 0; index < await rows.count(); index++) out.push([rows.nth(index).locator(`> [class*=${key}]`), rows.nth(index).locator(`> [class*=${value}]`)]);
    return out;
  };
  for (const width of [320, 360, 390]) {
    await open(width);
    for (const [key, value] of await pairs("__key", "__value")) {
      await text(value, "Noch kein bestätigter Vorgang");
      expect(await beside(key, value), `value beside „${await key.textContent()}“ at ${width}`).toBe(true);
    }
  }
  for (const width of [320, 360, 650]) {
    await open(width);
    for (const [label, figure] of await pairs("__label", "__figure")) {
      await text(figure, "27. Sept. 2026");
      expect(await beside(label, figure), `figure beside „${await label.textContent()}“ at ${width}`).toBe(true);
    }
  }
  await open(390);
  await scale(page, 200);
  const [[key, value]] = await pairs("__key", "__value");
  await text(value, "Noch kein bestätigter Vorgang");
  expect(await overlap(key, value)).toBe(false);
  // Every value ends inside its panel, none runs out of it.
  const outside = await page.evaluate(() => [...document.querySelectorAll("[class*=__value], [class*=__figure]")].filter(element => {
    const panel = element.closest("[class*=__details], [class*=__facts]")!.getBoundingClientRect(), box = element.getBoundingClientRect();
    return box.right > panel.right + 1;
  }).map(element => element.textContent));
  expect(outside).toEqual([]);
  expect(await sideways(page)).toBe(0);
});
