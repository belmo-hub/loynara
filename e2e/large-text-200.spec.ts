import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";

// ENG-368 (Design, #348's 320/200 pass): what Android's text-scale opt-in would hand to people with large phone text.
// At 320 px and 200 % text no page scrolls sideways and the named parts stay apart; at 100 % the same parts look as before.
// Each page loads once and changes width and text size in place: the owner job's specs share the demo owner, whose reads
// have per-owner budgets.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string; cashierEmail: string; cashierPassword: string; programSlug: string; cardToken: string };
test.describe.configure({ mode: "serial" });
test.beforeEach(({ page }) => page.emulateMedia({ reducedMotion: "reduce" }));

async function signIn(page: Page, email: string, password: string) {
  const api = await apiRequest.newContext({ baseURL: test.info().project.use.baseURL });
  expect((await api.post("/api/auth/sign-in/email", { data: { email, password }, headers: { Origin: new URL(test.info().project.use.baseURL!).origin } })).ok()).toBe(true);
  await page.context().addCookies((await api.storageState()).cookies);
  await api.dispose();
}
/** Width and text size on the loaded page (large text without hyphenation), then until the layout holds for 300 ms. */
async function size(page: Page, width: number, percent: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(next => {
    const style = document.getElementById("test-text-size") ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: "test-text-size" }));
    // Without hyphenation, as CI's Linux Chrome renders German: a fit that relies on a hyphen fails here too, not only in CI.
    style.textContent = next === 100 ? "" : `html { font-size: ${next}% !important } * { hyphens: manual !important; -webkit-hyphens: manual !important; }`;
  }, percent);
  await page.waitForFunction(expected => getComputedStyle(document.documentElement).fontSize === expected, `${16 * percent / 100}px`);
  await page.evaluate(async () => {
    let last = "", same = 0;
    for (const started = performance.now(); performance.now() - started < 3_000;) {
      await new Promise(done => setTimeout(done, 100));
      const now = `${document.documentElement.scrollWidth} ${document.documentElement.scrollHeight}`;
      same = now === last ? same + 1 : 0;
      if (same >= 3) return;
      last = now;
    }
  });
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
/** True when the two elements' text boxes cover each other. */
const apart = (page: Page, a: string, b: string) => page.evaluate(([one, two]) => {
  const boxes = (selector: string) => [...document.querySelectorAll(selector)].flatMap(element => { const range = document.createRange(); range.selectNodeContents(element); return [...range.getClientRects()].filter(box => box.width > 1); });
  const [x, y] = [boxes(one), boxes(two)];
  if (!x.length || !y.length) throw new Error(`not rendered: ${!x.length ? one : two}`);
  return !x.some(p => y.some(q => p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1));
}, [a, b]);
/** True when every element ends inside the box of its nearest match of `within`. */
const inside = (page: Page, selector: string, within: string) => page.evaluate(([one, two]) => [...document.querySelectorAll(one)].every(element => element.getBoundingClientRect().right <= element.closest(two)!.getBoundingClientRect().right + 1), [selector, within]);

test("the till: the display title breaks instead of pushing the Kasse sideways", async ({ page }) => {
  await signIn(page, demo.cashierEmail, demo.cashierPassword);
  await page.goto("/cashier");
  await expect(page.locator("#cashier-code")).toBeVisible();
  for (const width of [320, 360]) {
    await size(page, width, 200);
    expect(await sideways(page), `no sideways scroll at ${width}/200`).toBe(0);
    expect(await page.getByRole("button", { name: "Prüfen", exact: true }).evaluate(button => button.getBoundingClientRect().right <= innerWidth), `„Prüfen“ within the screen's width at ${width}/200`).toBe(true);
  }
});

test("the owner header, sub-pages, tabs and overview hold at 200 % and look as before at 100 %", async ({ page }) => {
  await signIn(page, demo.ownerEmail, demo.ownerPassword);
  await page.goto("/merchant/customers");
  await expect(page.locator(".ow-content h1")).toBeVisible();
  const bar = () => page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".ow-topbar")!, name = bar.querySelector<HTMLElement>(".ow-topbar-loc strong")!, kasse = bar.querySelector<HTMLElement>(".ow-topbar-kasse")!;
    const labels = [...document.querySelectorAll<HTMLElement>(".ow-tab-label")].map(label => Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight)));
    return { position: getComputedStyle(bar).position, height: Math.round(bar.getBoundingClientRect().height), padding: getComputedStyle(document.documentElement).scrollPaddingTop, nameCut: name.scrollWidth > name.clientWidth + 1, kasseShown: kasse.getBoundingClientRect().width > 1, lines: Math.max(...labels) };
  });
  for (const width of [320, 390]) {
    await size(page, width, 100);
    expect(await bar(), `the header as before at ${width}/100`).toMatchObject({ position: "sticky", height: 56, kasseShown: true, lines: 1 });
  }
  for (const width of [320, 390]) {
    await size(page, width, 200);
    const shown = await bar();
    expect(shown, `the header scrolls with the page and names the shop in full at ${width}/200`).toMatchObject({ position: "static", nameCut: false, kasseShown: false, padding: "49px" }); // the sub-pages' 49, no longer the bar's 56
    expect(shown.lines, `tab labels take at most two lines at ${width}/200`).toBeLessThanOrEqual(2);
    await expect(page.locator(".ow-topbar").getByRole("link", { name: "Kasse", exact: true })).toBeVisible(); // the icon keeps its name
    expect(await page.locator(".ow-subnav").getByRole("link", { name: "Zielgruppen" }).evaluate(link => link.getBoundingClientRect().right <= innerWidth), `„Zielgruppen“ within the screen's width at ${width}/200`).toBe(true);
    expect(await sideways(page), `no sideways scroll on Kunden at ${width}/200`).toBe(0);
  }
  await page.goto("/merchant");
  await expect(page.locator(".ow-content h1")).toBeVisible();
  await size(page, 320, 200);
  expect(await sideways(page), "no sideways scroll on the overview at 320/200").toBe(0);
  if (await page.locator("button[data-link]").count()) {
    expect(await inside(page, "button[data-link]", "[class*=__body]"), "„Tresenschild laden“ inside its row").toBe(true);
    for (const width of [320, 390]) { await size(page, width, 200); expect(await apart(page, "div:has(> span > span > b) > span > span > b", "button[data-link]"), `the milestone and its link apart at ${width}/200`).toBe(true); }
  }
});

test("the Kunden card's history row puts the amount and „Korrigieren“ under the words at 200 %", async ({ page }) => {
  await signIn(page, demo.ownerEmail, demo.ownerPassword);
  const members = await (await page.request.get(`/api/merchant/customers?programSlug=${demo.programSlug}`)).json() as { members: Array<{ id: string }> };
  await page.goto(`/merchant/customers?card=${members.members[0].id}`);
  await expect(page.locator("[data-entry]").first()).toBeVisible();
  const amountBeside = () => page.locator("[data-entry]").first().evaluate(row => {
    const title = row.querySelector("b")!.getBoundingClientRect(), amount = row.querySelector("[data-tone], [class*=__amount]")!.getBoundingClientRect();
    return amount.top < title.bottom - 1;
  });
  for (const width of [320, 390]) { await size(page, width, 100); expect(await amountBeside(), `the amount beside the words at ${width}/100`).toBe(true); }
  for (const width of [320, 390]) {
    await size(page, width, 200);
    expect(await amountBeside(), `the amount under the words at ${width}/200`).toBe(false);
    expect(await sideways(page)).toBe(0);
  }
});

test("Programm: the card preview's fields stack and the sub lines stay in their rows at 200 %", async ({ page }) => {
  await signIn(page, demo.ownerEmail, demo.ownerPassword);
  await page.goto("/merchant/program");
  await expect(page.getByRole("heading", { name: "Extras" })).toBeVisible();
  const fields = "[data-play] [class*=__fields] > span";
  const sideBySide = () => page.locator(fields).evaluateAll(spans => spans.length === 2 && Math.abs(spans[0].getBoundingClientRect().top - spans[1].getBoundingClientRect().top) < 1);
  for (const width of [320, 390]) { await size(page, width, 100); expect(await sideBySide(), `the two fields side by side at ${width}/100`).toBe(true); }
  await size(page, 320, 200);
  expect(await sideBySide(), "the two fields stack at 320/200").toBe(false);
  expect(await apart(page, `${fields}:first-child`, `${fields}:last-child`), "„Prämie“ and „Einlösbar ab“ apart").toBe(true);
  expect(await inside(page, "main [class*=mix-module][class*=__text] > small", "[class*=__panel]"), "every sub line inside its panel").toBe(true);
  expect(await sideways(page)).toBe(0);
});

test("guest pages: „Karte aktualisieren“ wraps, and the register link and the join card break instead of running off the screen", async ({ page }) => {
  await page.goto(`/card/${demo.cardToken}`);
  await expect(page.getByRole("button", { name: /Karte aktualisieren/ })).toBeVisible();
  for (const width of [320, 360]) { await size(page, width, 200); expect(await sideways(page), `no sideways scroll on the card at ${width}/200`).toBe(0); }
  await page.goto("/register");
  await expect(page.locator("main h1")).toBeVisible();
  await size(page, 320, 200);
  expect(await sideways(page), "no sideways scroll on Register at 320/200").toBe(0);
  await page.goto(`/join/${demo.programSlug}`);
  await expect(page.getByRole("button", { name: "Meine Karte erstellen" })).toBeVisible();
  for (const width of [320, 390]) { await size(page, width, 200); expect(await sideways(page), `no sideways scroll on join at ${width}/200`).toBe(0); }
});
