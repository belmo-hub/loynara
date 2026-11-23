import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";

// ENG-374 (money safety): the tap that closes the open Kasse menu must never press the till under it. The browser
// light-dismisses a popover="auto" and then still delivers the tap to what lies under it; over the card that was
// „1 Stempel vergeben“, a booking. Each case counts the award requests and reads the card's balance from the server;
// none of them books anything, so the demo shop stays as the later specs expect it.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cashierEmail: string; cashierPassword: string; cardToken: string };
test.describe.configure({ mode: "serial" });

/** One sign-in for the file: sign-in allows 30 per network in 15 minutes, and the owner job's other specs use most of them. */
let session: Promise<Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"]> | null = null;
function cashier() {
  session ??= (async () => {
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const api = await apiRequest.newContext({ baseURL: origin });
    expect((await api.post("/api/auth/sign-in/email", { data: { email: demo.cashierEmail, password: demo.cashierPassword }, headers: { Origin: origin } })).ok()).toBe(true);
    const { cookies } = await api.storageState();
    await api.dispose();
    return cookies;
  })();
  return session;
}

async function openCard(page: Page) {
  await page.context().addCookies(await cashier());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cashier");
  await page.locator("#cashier-code").fill((await card(page)).cardLocator);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await page.getByRole("button", { name: "Karte öffnen", exact: true }).click();
  await expect(page.getByRole("button", { name: /^1 Stempel vergeben$/ })).toBeVisible();
}
const card = async (page: Page) => (await page.request.get(`/api/card/${demo.cardToken}`, { headers: { "sec-fetch-site": "same-origin" } })).json() as Promise<{ cardLocator: string; balance: number }>;
function awards(page: Page) {
  const seen: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/cashier/award") && request.method() !== "GET") seen.push(request.url()); });
  return seen;
}
const menu = (page: Page) => page.locator("#cashier-menu");
async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Menü", exact: true }).click();
  await expect(menu(page)).toBeVisible();
}
/** The centre of a control, to tap there while the menu covers nothing of it. */
async function centre(page: Page, name: RegExp) {
  const box = (await page.getByRole("button", { name }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("a mouse tap over „1 Stempel vergeben“ only closes the open menu: no award, no new balance", async ({ page }) => {
  await openCard(page);
  const sent = awards(page), before = (await card(page)).balance;
  await openMenu(page);
  const at = await centre(page, /^1 Stempel vergeben$/);
  await page.mouse.click(at.x, at.y);
  await expect(menu(page)).toBeHidden();
  await page.waitForTimeout(800);
  expect(sent, "no award request").toEqual([]);
  expect((await card(page)).balance, "no ledger row").toBe(before);
  await expect(page.getByRole("button", { name: /^1 Stempel vergeben$/ })).toBeVisible(); // still the open card, not „Gebucht“
});

test("the same at a count of 2 over „2 Stempel prüfen“: the confirmation does not open", async ({ page }) => {
  await openCard(page);
  await page.getByRole("button", { name: "Menge erhöhen", exact: true }).click();
  await expect(page.getByRole("button", { name: /^2 Stempel prüfen$/ })).toBeVisible();
  const sent = awards(page), before = (await card(page)).balance;
  await openMenu(page);
  const at = await centre(page, /^2 Stempel prüfen$/);
  await page.mouse.click(at.x, at.y);
  await expect(menu(page)).toBeHidden();
  await page.waitForTimeout(800);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(sent).toEqual([]);
  expect((await card(page)).balance).toBe(before);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });
  test("a touch over „1 Stempel vergeben“ only closes the open menu", async ({ page }) => {
    await openCard(page);
    const sent = awards(page), before = (await card(page)).balance;
    await openMenu(page);
    const at = await centre(page, /^1 Stempel vergeben$/);
    await page.touchscreen.tap(at.x, at.y);
    await expect(menu(page)).toBeHidden();
    await page.waitForTimeout(800);
    expect(sent).toEqual([]);
    expect((await card(page)).balance).toBe(before);
  });
});

test("after the menu is closed, a normal tap on „1 Stempel vergeben“ sends exactly one award", async ({ page }) => {
  await openCard(page);
  // The award is stopped at the network, not booked: the guard is in the page, so one request leaving it is the proof,
  // and the demo shop's ledger stays as the owner job's later specs expect it.
  const sent: string[] = [];
  await page.route(url => url.pathname.startsWith("/api/cashier/award"), route => {
    if (route.request().method() === "GET") return route.continue();
    sent.push(route.request().url());
    return route.abort();
  });
  const before = (await card(page)).balance;
  await openMenu(page);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await page.getByRole("button", { name: /^1 Stempel vergeben$/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  await page.waitForTimeout(800);
  expect(sent).toHaveLength(1);
  expect((await card(page)).balance).toBe(before);
});

test("a gesture cancelled outside the open menu disarms the guard: a later synthetic click still goes through", async ({ page }) => {
  await openCard(page);
  const sent: string[] = [];
  await page.route(url => url.pathname.startsWith("/api/cashier/award"), route => {
    if (route.request().method() === "GET") return route.continue();
    sent.push(route.request().url());
    return route.abort(); // stopped at the network: nothing is booked
  });
  await openMenu(page);
  // A press outside the menu that the browser then cancels (a scroll, a palm): no click of its own follows.
  await page.getByRole("button", { name: /^1 Stempel vergeben$/ }).evaluate(button => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "touch" }));
    button.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, composed: true, pointerType: "touch" }));
    document.getElementById("cashier-menu")!.hidePopover();
  });
  await expect(menu(page)).toBeHidden();
  // Later, a screen reader activates the button with a synthetic click (detail 1, no pointer press of its own).
  await page.getByRole("button", { name: /^1 Stempel vergeben$/ }).evaluate(button => button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, detail: 1 })));
  await expect.poll(() => sent.length).toBe(1);
});
