import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The owner's „Kasse“ link (ENG-256): the Kasse slides up as a sheet only when it is already prefetched; a cold start
// navigates plainly with the fade. Either way the root's inline view-transition name is given back, so a slow payload
// can never leave the old page out of a later snapshot or freeze the owner screen.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

async function signIn(page: Page) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  expect((await page.request.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword }, headers: { Origin: origin } })).ok()).toBe(true);
}

/** Records the transition types React asks the browser for. */
async function recordTransitions(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __types: string[][] };
    w.__types = [];
    const start = document.startViewTransition?.bind(document);
    if (start) document.startViewTransition = ((arg: StartViewTransitionOptions) => { w.__types.push(arg && typeof arg === "object" && arg.types ? [...arg.types] : []); return start(arg); }) as typeof document.startViewTransition;
  });
}

const kasseTypes = (page: Page) => page.evaluate(() => (window as unknown as { __types: string[][] }).__types.filter(types => types.includes("kasse-sheet")).length);
/** The owner's Kasse link that is on screen: the sidebar's on a desktop, the top bar's on a phone. */
const kasseLink = (page: Page) => page.locator(".ow-side-foot a[href=\"/cashier\"], .ow-topbar a[href=\"/cashier\"]").filter({ visible: true }).first();
const rootName = (page: Page) => page.evaluate(() => document.documentElement.style.viewTransitionName);

test("with the Kasse's payload 2 s late, a cold start opens it without the sheet and leaves the root name alone", async ({ page }) => {
  await recordTransitions(page);
  await signIn(page);
  // Every /cashier payload, the idle prefetch included, is 2 s late: the open comes before any prefetch has answered.
  await page.route(url => url.pathname === "/cashier" && url.searchParams.has("_rsc"), async route => { await new Promise(done => setTimeout(done, 2_000)); await route.continue(); });
  await page.goto("/merchant");
  await kasseLink(page).click();
  await expect(page).toHaveURL(/\/cashier$/, { timeout: 15_000 });
  await expect(page.locator(".cashier-placeholder, main h1").first()).toBeVisible();
  expect(await kasseTypes(page)).toBe(0);
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
  await page.route(url => url.pathname === "/cashier" && url.searchParams.has("_rsc"), async route => { await new Promise(done => setTimeout(done, 2_000)); await route.continue(); });
  await kasseLink(page).click();
  await expect(page).toHaveURL(/\/cashier$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible({ timeout: 15_000 });
  expect(await kasseTypes(page)).toBe(0);
  expect(await rootName(page)).toBe("");
});
