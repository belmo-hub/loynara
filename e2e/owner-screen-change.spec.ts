import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The screen change in the owner area (DESIGN.md, Motion): the old screen fades out, the new one fades in, the bars stay.
const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

// One sign-in for the file: the login limit counts every attempt.
test.describe.configure({ mode: "serial" });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.ownerEmail);
  await page.getByLabel("Passwort").fill(access.ownerPassword);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("/merchant");
});
test.afterAll(() => page.close());
test.beforeEach(async () => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/merchant");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

const tab = (name: string) => page.getByRole("navigation", { name: "Bereiche" }).getByRole("link", { name, exact: true });
const inLayer = (prefix: string, running = false) => page.evaluate(([start, mustRun]) => document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(start as string) && (!mustRun || animation.playState === "running")), [prefix, running] as const);
/** Resolves in the frame in which the incoming screen's fade exists. */
const fadeStarted = () => page.waitForFunction(() => document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition-new(")));
const settled = () => page.waitForFunction(() => !document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition")));

test("a step in fades to the end: a page that swaps its loading frame for its form does not cut the change short", async () => {
  await tab("Programm").click();
  await expect(page.getByRole("heading", { name: "Programm", level: 1 })).toBeVisible();
  await settled();
  await page.getByRole("link", { name: /Prämie hinzufügen/ }).click();
  await fadeStarted();
  await page.waitForTimeout(100);
  expect(await inLayer("::view-transition-new(", true), "the fade is still running 100 ms after it started").toBe(true);
  await expect(page).toHaveURL(/\/merchant\/program\/rewards\/new$/);
  await expect(page, "the new screen names itself to assistive tech").toHaveTitle(/ – Loynara$/);
});

// ENG-219: WebKit (every iPhone browser) does not always paint the old screen's fade and then draws it as styled at
// rest for the whole change. At rest it must be invisible, in every browser, so it can never lie over the new screen.
test("the old screen is invisible at rest: only its running fade shows it", async () => {
  await tab("Programm").click();
  await fadeStarted();
  const rest = await page.evaluate(() => document.getAnimations().flatMap(animation => {
    const layer = (animation.effect as KeyframeEffect | null)?.pseudoElement ?? "";
    if (!/^::view-transition-old\((?!root\)|ow-topbar\)|ow-subnav\)|ow-tabs\))/.test(layer)) return [];
    animation.cancel();
    return [getComputedStyle(document.documentElement, layer).opacity];
  }));
  expect(rest.length, "the old screen is a layer of the change").toBeGreaterThan(0);
  expect(rest, "the old screen's opacity without its fade").toEqual(rest.map(() => "0"));
});

test("a tab opens its screen at the top, also after a little scrolling; going back returns to the place left", async () => {
  // Next.js keeps the offset when the new page's top still counts as in view; on iPhone Safari that left the heading under
  // the bar. Without the bars' scroll padding Chrome takes the same branch, so the shell's own reset is what is tested.
  const padding = await page.addStyleTag({ content: "html:root { scroll-padding-top: 0 !important; }" });
  await page.evaluate(() => window.scrollTo({ top: 20, behavior: "instant" }));
  await tab("Programm").click();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeVisible();
  await settled();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await padding.evaluate(node => (node as Element).remove());

  const row = page.locator(".ow-prog-row").last();
  await row.scrollIntoViewIfNeeded();
  const left = await page.evaluate(() => Math.round(window.scrollY));
  expect(left).toBeGreaterThan(100);
  await row.click();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeHidden();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(left);
});

test("a second tab tap during the change lands", async () => {
  const customers = await tab("Kunden").boundingBox();
  await tab("Programm").click();
  await fadeStarted();
  // A raw tap at the tab's place: the bar is captured for the change and takes no hit tests while it runs.
  await page.mouse.click(customers!.x + customers!.width / 2, customers!.y + customers!.height / 2);
  await expect(page).toHaveURL(/\/merchant\/customers$/);
  await expect(page.getByRole("heading", { name: "Kundenkarten", level: 1 })).toBeVisible();
});

test("on a slow connection the tapped tab looks current at once and the screen in view stays", async () => {
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  await page.route(/\/merchant\/more(\?|$)/, async route => { await held; await route.continue(); });
  await tab("Mehr").click();
  await expect(tab("Mehr")).toHaveAttribute("data-pending", "true");
  await expect(tab("Mehr")).toHaveCSS("font-weight", "800");
  await expect(tab("Übersicht")).toHaveCSS("font-weight", "600");
  await expect(page).toHaveURL(/\/merchant$/);
  release();
  await expect(page).toHaveURL(/\/merchant\/more$/);
  await expect(tab("Mehr")).not.toHaveAttribute("data-pending", "true");
  await page.unroute(/\/merchant\/more(\?|$)/);
});

test("on a slow connection a tapped row holds the selected look until its screen shows", async () => {
  await tab("Programm").click();
  await expect(page.getByRole("heading", { name: "Programm", level: 1 })).toBeVisible();
  await settled();
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  await page.route(/\/merchant\/program\/rule(\?|$)/, async route => { await held; await route.continue(); });
  await page.getByRole("link", { name: /Regel auf der Karte/ }).click();
  await expect(page.locator(".ow-prog-row:has([data-pending])")).toHaveCount(1);
  await expect(page.locator(".ow-prog-row:has([data-pending])"), "the fill is visible, not only the mark").toHaveCSS("background-image", /gradient/);
  await expect(page).toHaveURL(/\/merchant\/program$/);
  release();
  await expect(page).toHaveURL(/\/merchant\/program\/rule$/);
  await page.unroute(/\/merchant\/program\/rule(\?|$)/);
});

test("two quick taps on a slow connection: only the tab tapped last looks pending", async () => {
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  const slow = /\/merchant\/(program|customers)(\?|$)/;
  await page.route(slow, async route => { await held; await route.continue(); });
  await tab("Programm").click();
  await expect(tab("Programm")).toHaveAttribute("data-pending", "true");
  await tab("Kunden").click();
  await expect(page.locator(".ow-tabs [data-pending]")).toHaveCount(1);
  await expect(tab("Kunden")).toHaveAttribute("data-pending", "true");
  release();
  await expect(page).toHaveURL(/\/merchant\/customers$/);
  await page.unroute(slow);
});

test("opening a customer card and going back are screen changes; a filter is not", async () => {
  await page.goto("/merchant/customers?activity=all");
  const first = page.locator(".ow-content ul a.ow-prog-row").first();
  await expect(first).toBeVisible();
  await settled();
  // Any layer of a change in the half second around the filter pick.
  const changed = page.evaluate(() => new Promise<boolean>(done => {
    let seen = false;
    const end = performance.now() + 500;
    const look = () => {
      seen ||= document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition"));
      if (performance.now() < end) requestAnimationFrame(look); else done(seen);
    };
    look();
  }));
  await page.getByRole("group", { name: "Kartenstatus" }).getByRole("button", { name: "Aktiv" }).click();
  expect(await changed, "a filter stays in place").toBe(false);
  await expect(first).toBeVisible();

  await first.click();
  await fadeStarted();
  expect(await inLayer("::view-transition-old(ow-under)"), "the list leaves as the old screen").toBe(true);
  await expect(page).toHaveURL(/[?&]card=/);
  await settled();
  let listReads = 0;
  const count = (request: { url(): string }) => { if (request.url().includes("/api/merchant/customers?")) listReads++; };
  page.on("request", count);
  await page.locator(".ow-content a.ow-back:visible").click();
  await fadeStarted();
  expect(await inLayer("::view-transition-new(ow-under)"), "the list comes back as the new screen").toBe(true);
  await settled();
  await expect(first).toBeVisible();
  page.off("request", count);
  expect(listReads, "the list stayed mounted under the card: it is not read again").toBe(0);
});

test("reduced motion: the change is a cut", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await tab("Programm").click();
  await expect(page.getByRole("heading", { name: "Programm", level: 1 })).toBeVisible();
  expect(await inLayer("::view-transition-new(", true)).toBe(false);
});
