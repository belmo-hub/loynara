import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Motion in the owner area (DESIGN.md, Motion): a screen arrives once, a tap during the arrival lands, data that takes a
// placeholder's place only fades, a segmented control's pill slides after a pointer pick, and reduced motion has none of it.
const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

// One sign-in for the file: the login limit counts every attempt.
test.describe.configure({ mode: "serial" });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // Every animation that starts is noted from the document's first frame on.
  await page.addInitScript(() => {
    const started: string[] = [];
    (window as unknown as { started: string[] }).started = started;
    document.addEventListener("animationstart", event => started.push(event.animationName), true);
  });
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.ownerEmail);
  await page.getByLabel("Passwort").fill(access.ownerPassword);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("/merchant");
});
test.afterAll(() => page.close());
test.beforeEach(() => page.emulateMedia({ reducedMotion: "no-preference" }));

const started = (name: string) => page.evaluate(wanted => (window as unknown as { started: string[] }).started.filter(item => item === wanted).length, name);
const team = () => page.locator('.ow-content a.ow-prog-row[href="/merchant/staff"]');

test("a screen arrives once and a tap during the arrival lands", async () => {
  await page.goto("/merchant/more", { waitUntil: "commit" });
  const row = await page.waitForSelector('.ow-content a.ow-prog-row[href="/merchant/staff"]', { state: "attached" });
  const box = (await row.boundingBox())!;
  // A raw tap while the blocks are still rising in: no waiting for the row to come to rest.
  expect(await page.evaluate(() => document.getAnimations().some(animation => (animation as CSSAnimation).animationName === "ow-arrive" && animation.playState === "running")), "the arrival is running at the tap").toBe(true);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/merchant\/staff$/);

  await page.goto("/merchant/more");
  await expect(team()).toBeVisible();
  await page.waitForTimeout(600);
  const before = await started("ow-arrive") + await started("ow-row");
  expect(before, "the blocks and rows arrived").toBeGreaterThan(0);
  // What a refresh of the page's data looks like to the page: the same nodes, drawn again.
  await page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("resize")); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(600);
  expect(await started("ow-arrive") + await started("ow-row"), "nothing arrives a second time").toBe(before);
  expect(await page.evaluate(() => [...document.querySelectorAll(".ow-content *")].filter(node => getComputedStyle(node).transform !== "none" && !node.closest("svg")).length), "no transform is left behind").toBe(0);
});

test("data that takes a placeholder's place fades in and does not arrive again", async () => {
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  // The page's own read (the shell needs none of it), so the screen stands with its placeholders until it answers.
  await page.route(/\/api\/merchant\/analytics\?/, async route => { await held; await route.continue(); });
  await page.goto("/merchant/analytics");
  await expect(page.locator('.ow-content .ow-board[aria-busy="true"]')).toBeVisible();
  await page.waitForTimeout(600);
  const arrived = await started("ow-arrive");
  expect(arrived, "the screen arrived with its placeholders").toBeGreaterThan(0);
  release();
  await expect(page.locator(".ow-content .ow-board-big")).toBeVisible();
  expect(await page.locator(".ow-content [data-swap]").count(), "what replaced a placeholder is marked to fade").toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(await started("ow-arrive"), "no block rises a second time").toBe(arrived);
  await page.unroute(/\/api\/merchant\/analytics\?/);
});

test("a segmented control's pill slides after a pointer pick and not after a keyboard pick", async () => {
  await page.goto("/merchant/analytics");
  const segment = (days: number) => page.getByRole("group", { name: "Zeitraum" }).getByRole("button", { name: `${days} Tage` });
  await expect(segment(90)).toBeVisible();
  await segment(90).click();
  await expect(segment(90)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => started("ow-slide"), { message: "the pill slid" }).toBe(1);
  await segment(30).focus();
  await page.keyboard.press("Enter");
  await expect(segment(30)).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(300);
  expect(await started("ow-slide"), "a keyboard pick changes at once").toBe(1);
});

test("reduced motion: nothing arrives, slides or grows", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/merchant/more");
  await expect(team()).toBeVisible();
  await page.goto("/merchant/analytics");
  await page.getByRole("group", { name: "Zeitraum" }).getByRole("button", { name: "90 Tage" }).click();
  await page.waitForTimeout(600);
  for (const name of ["ow-arrive", "ow-row", "ow-fade", "ow-slide", "ow-grow", "ow-drop"]) expect(await started(name), name).toBe(0);
});
