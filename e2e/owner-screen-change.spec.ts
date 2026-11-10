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

test("reduced motion: the change is a cut", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await tab("Programm").click();
  await expect(page.getByRole("heading", { name: "Programm", level: 1 })).toBeVisible();
  expect(await inLayer("::view-transition-new(", true)).toBe(false);
});
