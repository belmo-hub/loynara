import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cashierEmail: string; cashierPassword: string };

// Design, 23 Nov (#346): after the Kasse menu closes, nothing of it may stay over the card head taking taps. WebKit 26
// kept the closed popover displayed at opacity 0 for seconds, with „Abmelden“ live under a cashier's thumb.
for (const close of ["Escape", "button", "outside"] as const) {
  test(`the closed Kasse menu takes no taps (${close})`, async ({ page }) => {
    const origin = new URL(test.info().project.use.baseURL!).origin;
    expect((await page.request.post("/api/auth/sign-in/email", { data: { email: demo.cashierEmail, password: demo.cashierPassword }, headers: { Origin: origin } })).ok()).toBe(true);
    await page.goto("/cashier");
    const button = page.locator('button[popovertarget="cashier-menu"]');
    await button.click();
    const items = await page.locator("#cashier-menu :is(a, button)").evaluateAll(list => list.map(item => { const box = item.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }));
    expect(items.length).toBeGreaterThan(0);
    if (close === "Escape") await page.keyboard.press("Escape");
    else if (close === "button") await button.click();
    else await page.mouse.click(195, 700);
    // Past the 160 ms exit: every point where an item stood now reaches the page underneath.
    await page.waitForTimeout(600);
    expect(await page.evaluate(points => points.map(({ x, y }) => document.getElementById("cashier-menu")!.contains(document.elementFromPoint(x, y))), items)).toEqual(items.map(() => false));
  });
}

// Design r2 (23 Nov): under reduced motion WebKit 26 opened the anchored menu at opacity 0, invisible but live.
test.describe("reduced motion", () => {
  test("the open Kasse menu is fully visible and takes taps", async ({ page }) => {
    const origin = new URL(test.info().project.use.baseURL!).origin;
    expect((await page.request.post("/api/auth/sign-in/email", { data: { email: demo.cashierEmail, password: demo.cashierPassword }, headers: { Origin: origin } })).ok()).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Once the page has hydrated, as a cashier meets it, and by touch.
    await page.goto("/cashier", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.locator('button[popovertarget="cashier-menu"]').tap();
    await page.waitForTimeout(400);
    const menu = page.locator("#cashier-menu");
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    expect(await menu.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
    expect(await menu.evaluate(el => getComputedStyle(el).visibility)).toBe("visible");
    const item = await page.locator("#cashier-menu :is(a, button)").first().boundingBox();
    expect(await page.evaluate(({ x, y }) => document.getElementById("cashier-menu")!.contains(document.elementFromPoint(x, y)), { x: item!.x + item!.width / 2, y: item!.y + item!.height / 2 })).toBe(true);
  });
});
