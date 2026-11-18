import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The owner's „Kasse“ link (ENG-256): the Kasse slides up as a sheet only when it is already prefetched; a cold start
// navigates plainly with the fade. Either way the root's inline view-transition name is given back, so a slow payload
// can never leave the old page out of a later snapshot or freeze the owner screen.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

// One sign-in for the file: a production build's auth limiter allows only a few sign-ins in ten seconds, so the owner's
// session cookies are taken once and given to every test's page.
let session: Awaited<ReturnType<import("@playwright/test").APIRequestContext["storageState"]>> | null = null;
async function signIn(page: Page) {
  if (!session) {
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const api = await (await import("@playwright/test")).request.newContext({ baseURL: origin });
    expect((await api.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword }, headers: { Origin: origin } })).ok()).toBe(true);
    session = await api.storageState();
    await api.dispose();
  }
  await page.context().addCookies(session.cookies);
}

/**
 * Records the transition types React asks the browser for, any transition that fails (a DOM-update timeout rejects
 * `ready`/`finished`), and the view-transition animations seen on screen (pseudo-element and keyframes).
 */
async function recordTransitions(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __types: string[][]; __vtErrors: string[]; __anims: string[] };
    w.__types = []; w.__vtErrors = []; w.__anims = [];
    const start = document.startViewTransition?.bind(document);
    if (start) document.startViewTransition = ((arg: StartViewTransitionOptions) => {
      w.__types.push(arg && typeof arg === "object" && arg.types ? [...arg.types] : []);
      const transition = start(arg);
      for (const step of [transition.ready, transition.finished]) step.catch((error: Error) => { if (error?.name !== "AbortError") w.__vtErrors.push(`${error?.name}: ${error?.message}`); });
      return transition;
    }) as typeof document.startViewTransition;
    const look = () => {
      for (const animation of document.getAnimations()) {
        const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
        if (pseudo?.startsWith("::view-transition")) { const seen = `${pseudo} ${(animation as CSSAnimation).animationName}`; if (!w.__anims.includes(seen)) w.__anims.push(seen); }
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
const vtErrors = (page: Page) => page.evaluate(() => (window as unknown as { __vtErrors: string[] }).__vtErrors);
const anims = (page: Page) => page.evaluate(() => (window as unknown as { __anims: string[] }).__anims);
/** Opens the Kasse and returns when the URL committed (ms since the epoch). */
async function openKasse(page: Page) {
  await kasseLink(page).click();
  await expect(page).toHaveURL(/\/cashier$/, { timeout: 15_000 });
  return Date.now();
}
/** Holds every /cashier payload 2 s and notes when the last one was let through. */
async function lateKasse(page: Page) {
  const released = { at: 0 };
  await page.route(url => url.pathname === "/cashier" && url.searchParams.has("_rsc"), async route => { await new Promise(done => setTimeout(done, 2_000)); released.at = Date.now(); await route.continue(); });
  return released;
}

const kasseTypes = (page: Page) => page.evaluate(() => (window as unknown as { __types: string[][] }).__types.filter(types => types.includes("kasse-sheet")).length);
/** The owner's Kasse link that is on screen: the sidebar's on a desktop, the top bar's on a phone. */
const kasseLink = (page: Page) => page.locator(".ow-side-foot a[href=\"/cashier\"], .ow-topbar a[href=\"/cashier\"]").filter({ visible: true }).first();
const rootName = (page: Page) => page.evaluate(() => document.documentElement.style.viewTransitionName);

test("with the Kasse's payload 2 s late, a cold start opens it without the sheet and leaves the root name alone", async ({ page }) => {
  await recordTransitions(page);
  await signIn(page);
  // Every /cashier payload, the idle prefetch included, is 2 s late: the open comes before any prefetch has answered.
  const released = await lateKasse(page);
  await page.goto("/merchant");
  // The owner screen is never held: the Kasse commits as soon as its payload is through (server render included).
  expect(await openKasse(page) - released.at).toBeLessThan(1_500);
  await expect(page.locator(".cashier-placeholder, main h1").first()).toBeVisible();
  expect(await kasseTypes(page)).toBe(0);
  expect(await vtErrors(page)).toEqual([]);
  expect(await rootName(page)).toBe("");
});

// Polled from the test, not the page: a page on a fake clock does not run its own polling.
const prefetched = (page: Page) => expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").some(entry => { const url = new URL(entry.name, location.href); return url.pathname === "/cashier" && url.searchParams.has("_rsc") && (entry as PerformanceResourceTiming).responseEnd > 0; })), { timeout: 15_000 }).toBe(true);

test("in a fresh tab the first open slides once the idle prefetch has answered, even with the payload 2 s late", async ({ page }) => {
  await recordTransitions(page);
  await signIn(page);
  await page.goto("/merchant");
  await prefetched(page);
  await page.route(url => url.pathname === "/cashier" && url.searchParams.has("_rsc"), async route => { await new Promise(done => setTimeout(done, 2_000)); await route.continue(); });
  await kasseLink(page).click();
  await expect(page).toHaveURL(/\/cashier$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Kassenzugang wird geprüft" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible({ timeout: 15_000 });
  expect(await kasseTypes(page)).toBe(1);
  // The name is released when the transition's animations end, well before the 10 s safety timeout.
  await expect.poll(() => rootName(page), { timeout: 3_000 }).toBe("");
});

test("after the router cache's window has passed, the open fades instead of holding the owner screen", async ({ page }) => {
  await recordTransitions(page);
  await signIn(page);
  await page.goto("/merchant");
  await prefetched(page);
  // Six minutes idle: the page's clocks (the router's Date.now, the gate's performance.now) move past the 5 minute
  // static stale time, while the prefetch's own timing entry stays where it was, as in a long-idle tab.
  await page.evaluate(() => {
    const skip = 6 * 60_000, now = Date.now.bind(Date), high = performance.now.bind(performance);
    Date.now = () => now() + skip;
    performance.now = () => high() + skip;
  });
  const released = await lateKasse(page);
  expect(await openKasse(page) - released.at).toBeLessThan(1_500);
  await expect(page.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible({ timeout: 15_000 });
  expect(await kasseTypes(page)).toBe(0);
  expect(await vtErrors(page)).toEqual([]);
  expect(await rootName(page)).toBe("");
});

const kundenTab = (page: Page) => page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Kunden" });

test("from Kunden after a tab change the customer list dims with the page under the sheet", async ({ page }) => {
  await recordTransitions(page);
  await signIn(page);
  await page.goto("/merchant");
  await prefetched(page);
  await kundenTab(page).click();
  await expect(page).toHaveURL(/\/merchant\/customers/);
  await expect(page.locator(".ow-under")).toBeVisible();
  await page.waitForTimeout(1_000); // the Kunden screen's own change settles, as a person would wait to read it
  await openKasse(page);
  await expect(page.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible({ timeout: 15_000 });
  expect(await kasseTypes(page)).toBe(1);
  expect(await anims(page)).toContain("::view-transition-old(ow-under) kasse-dim");
  expect(await vtErrors(page)).toEqual([]);
});

test("five opens from Kunden by the tab bar run without a view-transition timeout", async ({ page }) => {
  test.setTimeout(120_000);
  await recordTransitions(page);
  await signIn(page);
  for (let run = 0; run < 5; run++) {
    await page.goto("/merchant");
    await prefetched(page);
    await kundenTab(page).click();
    await expect(page.locator(".ow-under")).toBeVisible();
  await page.waitForTimeout(1_000); // the Kunden screen's own change settles, as a person would wait to read it
    await openKasse(page);
    await expect(page.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible({ timeout: 15_000 });
    expect(await vtErrors(page), `run ${run + 1}`).toEqual([]);
  }
});

test("a hidden tab sends no Kasse prefetch however long it waits, and exactly one prefetch round when it is back", async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    (window as unknown as { __setVisible: (v: DocumentVisibilityState) => void }).__setVisible = v => { visibility = v; document.dispatchEvent(new Event("visibilitychange")); };
  });
  const prefetches: number[] = [];
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname === "/cashier" && url.searchParams.has("_rsc") && request.headers()["next-router-prefetch"]) prefetches.push(Date.now()); });
  await signIn(page);
  await page.goto("/merchant");
  await prefetched(page);
  await page.waitForTimeout(1_500);
  // Hidden, and past the router cache's window: the minute timer comes round while the tab is away.
  await page.evaluate(() => {
    const skip = 6 * 60_000, now = Date.now.bind(Date), high = performance.now.bind(performance);
    Date.now = () => now() + skip; performance.now = () => high() + skip;
    (window as unknown as { __setVisible: (v: DocumentVisibilityState) => void }).__setVisible("hidden");
  });
  const before = prefetches.length;
  await page.waitForTimeout(62_000);
  expect(prefetches.length).toBe(before);
  await page.evaluate(() => (window as unknown as { __setVisible: (v: DocumentVisibilityState) => void }).__setVisible("visible"));
  await expect.poll(() => prefetches.length, { timeout: 10_000 }).toBeGreaterThan(before);
  await page.waitForTimeout(2_000);
  // One round: the router asks for the Kasse's segments together (the route tree and the page), once.
  const round = prefetches.slice(before);
  expect(round.length).toBeLessThanOrEqual(2);
  expect(Math.max(...round) - Math.min(...round)).toBeLessThan(1_000);
});
