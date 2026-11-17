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
// WebKit keeps a finished layer animation after a change (#263), so only unfinished ones count.
const settled = () => page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState !== "finished" && (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition")));

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

// ENG-221: WebKit paints the fades only under keyframe names the last change did not use, so the changes alternate two
// identical pairs. The pixels are checked in WebKit (owner-screen-change.mobile.spec.ts); here the alternation.
test("each screen change takes the other pair of keyframes", async () => {
  const names = async () => {
    await fadeStarted();
    const used = await page.evaluate(() => document.getAnimations().flatMap(animation => /^::view-transition-(old|new)\((?!root\)|ow-topbar\)|ow-subnav\)|ow-tabs\))/.test((animation.effect as KeyframeEffect | null)?.pseudoElement ?? "") ? [(animation as CSSAnimation).animationName] : []));
    await settled();
    return [...new Set(used)].sort().join(" ");
  };
  await tab("Programm").click();
  const first = await names();
  await tab("Kunden").click();
  const second = await names();
  await tab("Programm").click();
  const third = await names();
  expect([first, second].sort(), "two changes in a row use both pairs").toEqual(["ow-fade ow-fade-out", "ow-fade-b ow-fade-out-b"]);
  expect(third, "the third change takes the first pair again").toBe(first);
  // A customer card opens and closes on the same path: those are changes of their own too.
  await page.goto("/merchant/customers?activity=all");
  const row = page.locator(".ow-content ul a.ow-prog-row").first();
  await expect(row).toBeVisible();
  await settled();
  const before = await page.evaluate(() => document.documentElement.hasAttribute("data-ow-fade"));
  await row.click();
  const opened = await names();
  await page.locator(".ow-content a.ow-back:visible").click();
  const closed = await names();
  expect(opened, "opening a card takes the pair the list did not").toBe(before ? "ow-fade ow-fade-out" : "ow-fade-b ow-fade-out-b");
  expect(closed, "closing it takes the other one").not.toBe(opened);
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

  const row = page.locator('.ow-content a[href^="/merchant/program/"]').last();
  await row.scrollIntoViewIfNeeded();
  const left = await page.evaluate(() => Math.round(window.scrollY));
  expect(left).toBeGreaterThan(100);
  await row.click();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeHidden();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(left);
});

/** Takes the bars' scroll padding away: Next.js then keeps a small offset on a change, as iPhone Safari did. */
const withoutPadding = () => page.addStyleTag({ content: "html:root { scroll-padding-top: 0 !important; }" });
const y = () => page.evaluate(() => Math.round(window.scrollY));

test("a back link opens its screen at the top too", async () => {
  await withoutPadding();
  await tab("Aktionen").click();
  await page.locator(".ow-content a.ow-prog-row").filter({ hasText: "Kampagnen" }).click();
  await expect(page).toHaveURL(/\/merchant\/campaigns/);
  await settled();
  await page.evaluate(() => window.scrollTo({ top: 20, behavior: "instant" }));
  await page.locator(".ow-content a.ow-back:visible").click();
  await expect(page.getByRole("heading", { level: 1, name: "Aktionen" })).toBeVisible();
  await settled();
  expect(await y(), "„‹ Aktionen“ after 20 px of scrolling").toBe(0);
});

test("„‹ Programm“ returns to the row it was left from", async () => {
  await tab("Programm").click();
  await settled();
  // The whole list is there once its side reads are in (the reminder row needs them); then its last row is furthest down.
  await expect(page.locator('.ow-content a[href^="/merchant/program/"]').filter({ hasText: "Erinnerung vor der Prämie" })).toBeAttached();
  const last = page.locator('.ow-content a[href^="/merchant/program/"]').last();
  // The list swaps its first rows once the side reads are in; scrolling waits until the row stays put.
  await expect(async () => { await last.scrollIntoViewIfNeeded({ timeout: 500 }); }).toPass();
  expect(await y()).toBeGreaterThan(100);
  const href = await last.getAttribute("href");
  await last.click();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeHidden();
  await settled();
  await page.locator(".ow-content a.ow-back:visible").click();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeVisible();
  // Programm puts the row back in view by itself, clear of the bars, and gives it the focus.
  const row = page.locator(`.ow-content a[href="${href}"]`);
  await expect(row).toBeFocused();
  await expect(row).toBeInViewport({ ratio: 1 });
  expect(await y(), "not the page's top").toBeGreaterThan(100);
});

test("Enter on a focused tab opens its screen at the top and keeps the focus on the tab", async () => {
  await withoutPadding();
  await page.evaluate(() => window.scrollTo({ top: 20, behavior: "instant" }));
  await tab("Programm").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeVisible();
  await settled();
  expect(await y()).toBe(0);
  await expect(tab("Programm")).toBeFocused();
});

test("a push to a section of a page lands on that section, not at the page's top", async () => {
  await page.goto("/merchant/automations");
  await page.getByRole("link", { name: "Absender eintragen" }).click();
  await expect(page).toHaveURL(/\/merchant\/settings#absender$/);
  await settled();
  // On a short page the section cannot reach the bars: the page then stands at its end with the section in view, and no
  // empty space is added below to make room (Design, 13 Nov).
  await expect.poll(() => page.evaluate(() => {
    const bars = Math.max(...[...document.querySelectorAll(".ow-topbar, .ow-subnav")].map(bar => bar.getBoundingClientRect().bottom));
    const top = document.getElementById("absender")!.getBoundingClientRect().top;
    const atEnd = document.documentElement.scrollHeight - window.innerHeight - window.scrollY <= 2;
    return Math.abs(Math.round(top - bars)) <= 2 || (atEnd && top >= bars - 2 && top < window.innerHeight);
  }), { message: "the section's top sits at the bars, or the page is at its end with the section in view" }).toBe(true);
});

test("a second tab tap during the change lands", async () => {
  const customers = await tab("Kunden").boundingBox();
  await tab("Programm").click();
  await fadeStarted();
  // A raw tap at the tab's place: the bar is captured for the change and takes no hit tests while it runs.
  const [x, y] = [customers!.x + customers!.width / 2, customers!.y + customers!.height / 2];
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
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
  await expect(tab("Übersicht")).toHaveCSS("font-weight", "650");
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
  await expect(page.locator('.ow-content a[href^="/merchant/program/"]:has([data-pending])')).toHaveCount(1);
  await expect(page.locator('.ow-content a[href^="/merchant/program/"]:has([data-pending])'), "the fill is visible, not only the mark").toHaveCSS("background-image", /gradient/);
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
