import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { smallTargets } from "./support/targets";
import { pool } from "../src/db";

// The counter on phones: dark whatever the system setting, nothing sideways, text at least 14 px, every control at
// least 44 px, the booking button 64 px in the dock, and "Gebucht" there at once, without movement, its badge popping in.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cashierEmail: string; cashierPassword: string; ownerEmail: string; ownerPassword: string; programSlug: string };
test.afterAll(async () => { await pool.end(); });

async function scanCode() {
  const { rows } = await pool.query<{ scan_code: string }>(
    "select m.scan_code from memberships m join programs p on p.id = m.program_id where p.slug = $1 and m.closed_at is null order by m.created_at desc limit 1",
    [demo.programSlug]);
  return rows[0].scan_code;
}

async function signIn(page: Page) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const res = await page.request.post("/api/auth/sign-in/email", { data: { email: demo.cashierEmail, password: demo.cashierPassword }, headers: { Origin: origin } });
  expect(res.ok()).toBe(true);
}

/** Visible text under 14 px, and controls under 44 × 44 px by the shared rule (e2e/support/targets.ts). */
async function audit(page: Page) {
  const measured = await page.evaluate(() => {
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest("[hidden]"); };
    const smallText = [...document.querySelectorAll("body *")].filter(el => visible(el) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim()))
      .filter(el => parseFloat(getComputedStyle(el).fontSize) < 14).map(el => el.textContent!.trim().slice(0, 30));
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, smallText };
  });
  return { ...measured, smallControls: await smallTargets(page) };
}

/** Down the middle of the dock's 1 px top edge: the screen pixel 4 CSS px above it, the edge's brightest pixel, and the
 * pixel 5 CSS px under it (the edge is snapped to device pixels, so it is found, not computed). */
async function topEdge(page: Page) {
  const { x, y } = await page.evaluate(() => { const r = document.querySelector("[data-dock]")!.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.floor(r.top) }; });
  const png = await page.screenshot({ clip: { x, y: y - 4, width: 1, height: 10 }, animations: "disabled" });
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height }), g = canvas.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const rows = [...Array(img.height).keys()].map(row => [...g.getImageData(0, row, 1, 1).data.slice(0, 3)]);
    const line = rows.reduce((best, px) => px[0] + px[1] + px[2] > best[0] + best[1] + best[2] ? px : best);
    return [rows[0], line, rows[rows.length - 1]];
  }, png.toString("base64"));
}
const apart = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0);

/** A shop of its own, signed in as its owner (a reward added to the demo programme could not be taken back at once). */
async function ownShop(page: Page, goals: number[]) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const api = page.request;
  expect((await api.post("/api/auth/sign-up/email", { data: { name: "Synthetic shop", email: `shop-${crypto.randomUUID()}@example.test`, password: `Local!${crypto.randomUUID()}Aa` }, headers: { Origin: origin } })).status()).toBe(200);
  const onboard = await api.post("/api/merchant/onboard", { headers: { Origin: origin }, data: { businessName: "Synthetic Laden", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Stempelkarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Gratiskaffee", rewardCost: goals[0] } });
  expect(onboard.status()).toBe(201);
  const { programSlug } = await onboard.json() as { programSlug: string };
  for (const cost of goals.slice(1)) expect((await api.post("/api/merchant/program/rewards", { data: { action: "create", programSlug, title: "Kleiner Kaffee", cost, termsText: "Ein kleiner Kaffee." }, headers: { Origin: origin } })).status()).toBe(201);
  return async (balance: number) => {
    const guest = await (await import("@playwright/test")).request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
    const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true } })).json() as { cardToken: string };
    const found = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string; cardLocator: string };
    await guest.dispose();
    const { membershipId } = await (await api.get(`/api/cashier/lookup?code=${encodeURIComponent(found.scanCode)}`)).json() as { membershipId: string };
    if (balance) expect((await api.post("/api/cashier/award", { data: { membershipId, quantity: balance, idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() }, headers: { Origin: origin } })).ok()).toBe(true);
    return found;
  };
}

test.describe("cashier on phones", () => {
  test.use({ colorScheme: "light" });

  test("the ready screen is dark, fits and keeps comfortable targets", async ({ page }) => {
    await signIn(page);
    await page.goto("/cashier");
    await expect(page.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("main")!.closest(".ly-theme-dark")!).backgroundColor)).toBe("rgb(15, 23, 19)");
    expect(await audit(page)).toEqual({ overflow: 0, smallText: [], smallControls: [] });
  });

  test("an open card keeps the booking controls in the dock and books with one tap", async ({ page }) => {
    await signIn(page);
    // A card of its own at 0, so no earlier run leaves a reward ready on it.
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const { cardToken } = await (await page.request.post("/api/enroll", { data: { slug: demo.programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true }, headers: { Origin: origin } })).json() as { cardToken: string };
    const { scanCode: fresh } = await (await page.request.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(fresh);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    const book = page.locator(".cashier-award-now");
    await expect(book).toBeVisible();
    expect(await audit(page)).toEqual({ overflow: 0, smallText: [], smallControls: [] });
    expect(Math.round((await book.boundingBox())!.height)).toBeGreaterThanOrEqual(64);
    expect(Math.round((await page.getByRole("button", { name: "Menge erhöhen" }).boundingBox())!.height)).toBeGreaterThanOrEqual(56);

    // Scrolled to the end, nothing in the page sits under the dock.
    await page.evaluate(() => new Promise(done => { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); requestAnimationFrame(() => requestAnimationFrame(done)); }));
    const gap = await page.evaluate(() => {
      const dock = document.querySelector("[data-dock]")!.getBoundingClientRect();
      const last = [...document.querySelectorAll("main > *")].filter(el => el.getBoundingClientRect().height > 0).pop()!.getBoundingClientRect();
      return Math.round(dock.top - last.bottom);
    });
    expect(gap).toBeGreaterThanOrEqual(0);

    // The stepper answers at once.
    await page.getByRole("button", { name: "Menge erhöhen" }).click();
    await expect(page.locator(".quantity-row output")).toHaveText("2", { timeout: 100 });
    await page.getByRole("button", { name: "Menge verringern" }).click();

    await book.click();
    const booked = page.locator(".cashier-booked");
    await expect(booked).toContainText("Neuer Stand:");
    // No fade of the panel (no empty dock frame); the badge pops in with its tick already drawn (Design, 18 Nov).
    expect(await booked.evaluate(el => { const cs = getComputedStyle(el); return [cs.transitionDuration, cs.opacity, cs.transform]; })).toEqual(["0s", "1", "none"]);
    expect(await booked.locator("[class*='bookedIcon']").evaluate(el => getComputedStyle(el).animationName)).toContain("land");
    expect(await booked.locator("[class*='bookedIcon'] path").first().evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  });

  test("a card with a reward ready leads with redeeming, in thumb reach, and the status dot stays beside its label", async ({ page }) => {
    await signIn(page);
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const joined = await page.request.post("/api/enroll", { data: { slug: demo.programSlug, acceptedTerms: true, marketingOptIn: false }, headers: { Origin: origin } });
    const { cardToken } = await joined.json() as { cardToken: string };
    const { scanCode: code } = await (await page.request.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
    const { membershipId, rewards } = await (await page.request.get(`/api/cashier/lookup?code=${encodeURIComponent(code)}`)).json() as { membershipId: string; rewards: Array<{ cost: number }> };
    const award = await page.request.post("/api/cashier/award", { data: { membershipId, quantity: Math.min(...rewards.map(reward => reward.cost)), idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() }, headers: { Origin: origin } });
    expect(award.ok()).toBe(true);

    await page.goto("/cashier");
    // C4: on a phone the dot sits on the label's line, not on a line of its own.
    const [dot, label] = await Promise.all([page.locator("[data-state] > span").first().boundingBox(), page.locator("[data-state] strong").first().boundingBox()]);
    expect(dot!.y).toBeGreaterThanOrEqual(label!.y);
    expect(dot!.y + dot!.height).toBeLessThanOrEqual(label!.y + label!.height);

    await page.getByLabel("Kartennummer oder Kartencode").fill(code);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    const redeem = page.locator(".cashier-redeem-now");
    // The green band: the action, then which reward (copy R21).
    await expect(redeem).toHaveText(/^Prämie einlösen.+ · Stand reicht$/);
    expect(await audit(page)).toEqual({ overflow: 0, smallText: [], smallControls: [] });
    // At rest at 390 × 844 nothing sits under the dock: with one reward, ready, the band names it and the row is left out.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".reward-action-list")).toHaveCount(0);
    const atRest = await page.evaluate(() => {
      const dock = document.querySelector("[data-dock]")!.getBoundingClientRect();
      const last = [...document.querySelectorAll("main > *")].filter(el => el.getBoundingClientRect().height > 1).pop()!.getBoundingClientRect();
      const keys = document.querySelector(".quantity-row button")!.getBoundingClientRect();
      return { gap: Math.round(dock.top - last.bottom), keysInset: Math.round(keys.top - dock.top), scroll: document.documentElement.scrollHeight - innerHeight };
    });
    expect(atRest.gap).toBeGreaterThanOrEqual(0);
    // The sticky dock lands up to 4 px lower from sub-pixel rounding at the 2.625 device-pixel ratio (the band's taller
    // step area included); nothing is under it.
    expect(atRest.scroll, JSON.stringify(atRest)).toBeLessThanOrEqual(4);
    expect(atRest.keysInset).toBeGreaterThanOrEqual(24);
    const [redeemBox, earnBox, viewport] = [await redeem.boundingBox(), await page.locator(".cashier-award-now").boundingBox(), page.viewportSize()!];
    // Primary at the bottom, 64 px; earning steps back above it at 56 px.
    expect(Math.round(redeemBox!.height)).toBeGreaterThanOrEqual(64);
    expect(redeemBox!.y + redeemBox!.height).toBeGreaterThan(viewport.height - 120);
    expect(earnBox!.y).toBeLessThan(redeemBox!.y);
    expect(Math.round(earnBox!.height)).toBeGreaterThanOrEqual(56);
    // The taller dock still leaves the end of the page above it.
    await page.evaluate(() => new Promise(done => { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); requestAnimationFrame(() => requestAnimationFrame(done)); }));
    const gap = await page.evaluate(() => {
      const dock = document.querySelector("[data-dock]")!.getBoundingClientRect();
      const last = [...document.querySelectorAll("main > *")].filter(el => el.getBoundingClientRect().height > 0).pop()!.getBoundingClientRect();
      return Math.round(dock.top - last.bottom);
    });
    expect(gap).toBeGreaterThanOrEqual(0);
    await redeem.click();
    await expect(page.getByRole("dialog", { name: "Einlösung bestätigen?" })).toContainText(/kaffee/i);
  });

  test("a card opened by its typed number shows the safety note in view on a 390 × 844 phone, above the dock", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    const { rows } = await pool.query<{ card_locator: string }>(
      "select m.card_locator from memberships m join programs p on p.id = m.program_id where p.slug = $1 and m.closed_at is null and m.card_locator <> '' order by m.created_at desc limit 1",
      [demo.programSlug]);
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(`K-${rows[0].card_locator}`);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await page.getByRole("button", { name: "Karte öffnen", exact: true }).click();
    const note = page.getByRole("note").filter({ hasText: "Ohne Scan geöffnet: Prämie nur für die eigene Karte." });
    await expect(note).toBeInViewport({ ratio: 1 });
    const [noteBox, dockBox] = await Promise.all([note.boundingBox(), page.locator("[data-dock]").boundingBox()]);
    expect(noteBox!.y + noteBox!.height).toBeLessThanOrEqual(dockBox!.y);
  });

  test("a slow access check keeps one layout: the scan form's placeholders, then „Einen Moment …“ above them, then the form in place", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/me", async route => { await new Promise(done => setTimeout(done, 1_500)); await route.continue(); });
    await page.goto("/cashier");
    const placeholder = page.locator(".cashier-placeholder");
    await expect(placeholder).toBeVisible();
    await expect(page.locator("[data-state][data-placeholder]")).toHaveCount(1);
    const strip = page.locator("[data-state]:not([data-placeholder])");
    await expect(strip).toContainText("Einen Moment …");
    await expect(placeholder).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kassenzugang wird geprüft" })).toHaveCount(0);
    const stripTop = (await strip.boundingBox())!.y;
    await expect(page.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible();
    expect(Math.round((await page.locator("[data-state]").boundingBox())!.y)).toBe(Math.round(stripTop));
  });

  test("the waits are pinned: nothing for 250 ms after the slide, „Einen Moment …“ after 300 ms, the words panel only after 3 s", async ({ page }) => {
    await signIn(page);
    let answer!: () => void;
    const answered = new Promise<void>(done => { answer = done; });
    await page.route("**/api/me", async route => { await answered; await route.continue(); });
    // The page notes when the waiting frame's clock started (data-since), when the strip gets its words and when the panel
    // shows; the gaps are the thresholds: 560 ms (the 260 ms slide plus 300 ms) and 3 s.
    await page.addInitScript(() => {
      const marks: Record<string, number> = {};
      (window as unknown as { __marks: typeof marks }).__marks = marks;
      new MutationObserver(() => {
        const now = performance.now();
        const armed = document.querySelector<HTMLElement>(".cashier-placeholder[data-since]");
        if (!marks.frame && armed) marks.frame = Number(armed.dataset.since);
        if (!marks.words && document.querySelector("[data-state]:not([data-placeholder])")?.textContent?.includes("Einen Moment")) marks.words = now;
        if (!marks.panel && [...document.querySelectorAll("h1")].some(h => h.textContent === "Kassenzugang wird geprüft")) marks.panel = now;
      }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await page.goto("/cashier");
    await expect(page.getByRole("heading", { name: "Kassenzugang wird geprüft" })).toBeVisible({ timeout: 10_000 });
    const marks = await page.evaluate(() => (window as unknown as { __marks: Record<string, number> }).__marks);
    expect(marks.frame).toBeGreaterThan(0);
    expect(marks.words - marks.frame).toBeGreaterThanOrEqual(260 + 250);
    expect(marks.words - marks.frame).toBeLessThan(560 + 800); // room for a loaded machine; the lower bound is the pin
    expect(marks.panel - marks.frame).toBeGreaterThanOrEqual(3_000);
    // One waiting message: with the panel up, the strip keeps its slot without words.
    await expect(page.locator("[data-state][data-placeholder]")).toHaveCount(1);
    answer();
    await expect(page.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible();
  });

  test("after a booking on the typed path the code field is in view in the Gebucht dock and keeps the focus (390 × 844)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    const { rows } = await pool.query<{ card_locator: string }>(
      "select m.card_locator from memberships m join programs p on p.id = m.program_id where p.slug = $1 and m.closed_at is null and m.card_locator <> '' order by m.created_at desc limit 1",
      [demo.programSlug]);
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(`K-${rows[0].card_locator}`);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await page.getByRole("button", { name: "Karte öffnen", exact: true }).click();
    await expect(page.locator(".cashier-award-now")).toBeVisible();
    const dockBefore = await page.evaluate(() => Math.round(document.querySelector("[data-dock]")!.getBoundingClientRect().top));
    await page.locator(".cashier-award-now").click();
    const field = page.locator(".cashier-booked #cashier-code");
    await expect(field).toBeFocused();
    await expect(field).toBeInViewport({ ratio: 1 });
    await expect(field).toHaveAttribute("placeholder", "Kartennummer oder Kartencode");
    expect(Math.round((await field.boundingBox())!.height)).toBe(44);
    // The dock's edge does not move on the typed path either.
    // Up to 2 px from rounding at the profile's 2.625 device-pixel ratio.
    expect(Math.abs(await page.evaluate(() => Math.round(document.querySelector("[data-dock]")!.getBoundingClientRect().top)) - dockBefore)).toBeLessThanOrEqual(2);
  });

  test("the booking that reaches the goal moves nothing: one reward, 7 + 1, the dock's top stays", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const joined = await page.request.post("/api/enroll", { data: { slug: demo.programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true }, headers: { Origin: origin } });
    const { cardToken } = await joined.json() as { cardToken: string };
    const { scanCode: code } = await (await page.request.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
    const { membershipId, rewards } = await (await page.request.get(`/api/cashier/lookup?code=${encodeURIComponent(code)}`)).json() as { membershipId: string; rewards: Array<{ cost: number }> };
    expect(rewards).toHaveLength(1);
    expect((await page.request.post("/api/cashier/award", { data: { membershipId, quantity: rewards[0].cost - 1, idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() }, headers: { Origin: origin } })).ok()).toBe(true);
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(code);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    const dockTop = () => page.evaluate(() => Math.round(document.querySelector("[data-dock]")!.getBoundingClientRect().top));
    await expect(page.locator(".cashier-award-now")).toBeVisible();
    const before = await dockTop();
    await page.locator(".cashier-award-now").click();
    await expect(page.locator(".cashier-booked")).toBeVisible();
    await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
    // On this emulated profile (device-pixel ratio 2.625) the open dock sits up to 3.5 px below the content's end while
    // the booked one sits on it; at a ratio of 2 both are at 525. What this pins is the 82 px jump of a row dropped
    // mid-booking.
    expect(Math.abs(await dockTop() - before)).toBeLessThanOrEqual(4);
  });

  test("with two rewards and one ready the keys keep the dock's top inset (390 × 844)", async ({ page }) => {
    // A shop of its own: a reward added to the demo programme could not be taken back at once (dated changes).
    await page.setViewportSize({ width: 390, height: 844 });
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const api = page.request;
    expect((await api.post("/api/auth/sign-up/email", { data: { name: "Synthetic two rewards", email: `two-rewards-${crypto.randomUUID()}@example.test`, password: `Local!${crypto.randomUUID()}Aa` }, headers: { Origin: origin } })).status()).toBe(200);
    const onboard = await api.post("/api/merchant/onboard", { headers: { Origin: origin }, data: { businessName: "Synthetic Zwei Prämien", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Stempelkarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Gratiskaffee", rewardCost: 8 } });
    expect(onboard.status()).toBe(201);
    const { programSlug } = await onboard.json() as { programSlug: string };
    expect((await api.post("/api/merchant/program/rewards", { data: { action: "create", programSlug, title: "Kleiner Kaffee", cost: 3, termsText: "Ein kleiner Kaffee." }, headers: { Origin: origin } })).status()).toBe(201);
    const guest = await (await import("@playwright/test")).request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
    const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken: string };
    const { scanCode: code } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
    await guest.dispose();
    const { membershipId, rewards } = await (await api.get(`/api/cashier/lookup?code=${encodeURIComponent(code)}`)).json() as { membershipId: string; rewards: Array<{ cost: number }> };
    expect(rewards).toHaveLength(2);
    expect((await api.post("/api/cashier/award", { data: { membershipId, quantity: 4, idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() }, headers: { Origin: origin } })).ok()).toBe(true);
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(code);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(page.locator(".cashier-redeem-now")).toBeVisible();
    // Both rows show; the ready one the band names and redeems shows its price only, not a second „Einlösen“ (Design, 19 Nov).
    await expect(page.locator(".reward-action-list [data-lead='tile']")).toHaveCount(2);
    await expect(page.locator(".reward-action-list button")).toHaveCount(1);
    const inset = () => page.evaluate(() => Math.round(document.querySelector(".quantity-row button")!.getBoundingClientRect().top - document.querySelector("[data-dock]")!.getBoundingClientRect().top));
    const dockTop = () => page.evaluate(() => document.querySelector("[data-dock]")!.getBoundingClientRect().top);
    // The open dock's inset: 26–28 on a phone, 38 on the counter tablet (from 800 px wide).
    await page.setViewportSize({ width: 880, height: 900 });
    expect(await inset()).toBeGreaterThanOrEqual(34);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await inset()).toBeGreaterThanOrEqual(24);
    // Book at 4: the booked dock keeps the open dock's height, its edge stays, and the list still scrolls clear of it.
    const before = await dockTop();
    await page.locator(".cashier-award-now").click();
    await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
    expect(Math.abs(await dockTop() - before)).toBeLessThanOrEqual(4);
    await page.evaluate(() => new Promise(done => { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); requestAnimationFrame(() => requestAnimationFrame(done)); }));
    const clear = await page.evaluate(() => {
      const dock = document.querySelector("[data-dock]")!.getBoundingClientRect().top;
      return [...document.querySelectorAll("main [data-lead='tile']")].map(row => Math.round(dock - row.getBoundingClientRect().bottom));
    });
    expect(clear.length).toBe(2);
    for (const gap of clear) expect(gap).toBeGreaterThanOrEqual(0);
  });

  test("typed, two rewards and none ready: the open dock already holds the booked stack, so 2 → 3 keeps one top and the owner's row stays inside (390 × 844)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const card = await (await ownShop(page, [8, 3]))(2);
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(card.cardLocator);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await page.getByRole("button", { name: "Karte öffnen", exact: true }).click();
    await expect(page.locator(".cashier-award-now")).toBeVisible();
    const dock = () => page.evaluate(() => document.querySelector("[data-dock]")!.getBoundingClientRect().toJSON() as DOMRect);
    const open = await dock();
    expect(await page.evaluate(() => Math.round(document.querySelector(".quantity-row button")!.getBoundingClientRect().top - document.querySelector("[data-dock]")!.getBoundingClientRect().top))).toBeGreaterThanOrEqual(24);
    // A one-row goal (3) keeps its own height: the typed note stays in view above the dock.
    expect(await page.evaluate(() => document.querySelector(".cashier-locator-note")!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(open.top);
    await page.locator(".cashier-award-now").click();
    await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
    expect(Math.abs((await dock()).top - open.top)).toBeLessThanOrEqual(4); // 2.625 DPR rounding
    // The owner's „Rückgängig“ stands beside the field, both inside the dock's 16 px side inset; the field's placeholder
    // shortens beside it and its name keeps the full words.
    const field = page.locator(".cashier-booked #cashier-code");
    await expect(field).toHaveAttribute("placeholder", "Kartennummer");
    await expect(field).toHaveAccessibleName("Kartennummer oder Kartencode");
    const inside = await page.evaluate(() => {
      const d = document.querySelector("[data-dock]")!.getBoundingClientRect(), form = document.querySelector(".cashier-booked form")!.getBoundingClientRect(), undo = document.querySelector(".cashier-booked form button")!.getBoundingClientRect();
      return { left: Math.round(form.left - d.left), right: Math.round(d.right - form.right), undo: Math.round(d.right - undo.right) };
    });
    expect(inside.left).toBeGreaterThanOrEqual(16);
    expect(inside.right).toBeGreaterThanOrEqual(16);
    expect(inside.undo).toBeGreaterThanOrEqual(16);
  });

  test("a 12-stamp goal keeps the card at two rows: the typed note above the dock and the dock's edge kept, ready or not (390 × 844)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const api = page.request;
    expect((await api.post("/api/auth/sign-up/email", { data: { name: "Synthetic twelve", email: `twelve-${crypto.randomUUID()}@example.test`, password: `Local!${crypto.randomUUID()}Aa` }, headers: { Origin: origin } })).status()).toBe(200);
    const onboard = await api.post("/api/merchant/onboard", { headers: { Origin: origin }, data: { businessName: "Synthetic Zwölf", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Stempelkarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Gratiskaffee", rewardCost: 12 } });
    expect(onboard.status()).toBe(201);
    const { programSlug } = await onboard.json() as { programSlug: string };
    const guest = await (await import("@playwright/test")).request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
    for (const balance of [5, 12]) {
      const { cardToken } = await (await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true } })).json() as { cardToken: string };
      const { scanCode, cardLocator } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string; cardLocator: string };
      const { membershipId } = await (await api.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`)).json() as { membershipId: string };
      expect((await api.post("/api/cashier/award", { data: { membershipId, quantity: balance, idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() }, headers: { Origin: origin } })).ok()).toBe(true);
      await page.goto("/cashier");
      await page.getByLabel("Kartennummer oder Kartencode").fill(cardLocator);
      await page.getByRole("button", { name: "Prüfen", exact: true }).click();
      await page.getByRole("button", { name: "Karte öffnen", exact: true }).click();
      await expect(page.locator(".cashier-award-now")).toBeVisible();
      const at = () => page.evaluate(() => ({
        dock: document.querySelector("[data-dock]")!.getBoundingClientRect().top,
        note: document.querySelector(".cashier-locator-note")?.getBoundingClientRect().bottom ?? 0,
      }));
      const open = await at();
      expect(open.note, `balance ${balance}`).toBeGreaterThan(0);
      expect(open.note, `balance ${balance}`).toBeLessThanOrEqual(open.dock);
      await page.locator(".cashier-award-now").click();
      await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
      expect(Math.abs((await at()).dock - open.dock), `balance ${balance}`).toBeLessThanOrEqual(4); // 2.625 DPR rounding
      expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), `balance ${balance}: no page scroll`).toBeLessThanOrEqual(0);
    }
    await guest.dispose();
  });

  test("on a counter tablet (820 × 1180) the card and the dock are one group centred under the head, and booking keeps the dock", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await signIn(page);
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const { cardToken } = await (await page.request.post("/api/enroll", { data: { slug: demo.programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true }, headers: { Origin: origin } })).json() as { cardToken: string };
    const { scanCode: code } = await (await page.request.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(code);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(page.locator(".cashier-award-now")).toBeVisible();
    const layout = () => page.evaluate(() => {
      const head = document.querySelector("header")!.getBoundingClientRect(), main = document.querySelector("main")!.getBoundingClientRect();
      const dock = document.querySelector("[data-dock]")!.getBoundingClientRect(), keys = document.querySelector(".quantity-row button")?.getBoundingClientRect();
      return { above: main.top - head.bottom, below: innerHeight - dock.bottom, follows: dock.top - main.bottom, inset: keys ? keys.top - dock.top : 0, dockTop: dock.top };
    });
    const open = await layout();
    expect(Math.abs(open.above - open.below), JSON.stringify(open)).toBeLessThanOrEqual(8);
    expect(open.above).toBeGreaterThan(0);
    // The dock comes right after the content (its 16 px bottom padding); up to 4 px from rounding at this profile's
    // 2.625 device-pixel ratio (at a ratio of 2 it is 0).
    expect(open.follows).toBeGreaterThanOrEqual(0);
    expect(open.follows).toBeLessThanOrEqual(4);
    expect(open.inset).toBeGreaterThanOrEqual(34); // the open inset, 38 from 800 px wide
    // Short of the bottom edge the dock is a panel with four rounded corners; running off it (too tall a group, a phone)
    // its lower edge is flat.
    const corner = () => page.evaluate(() => getComputedStyle(document.querySelector("[data-dock]")!).borderBottomLeftRadius);
    expect(await corner()).toBe("20px");
    // Floating, the dock is a panel on the card's edges; reaching the bottom it is full width.
    const sides = () => page.evaluate(() => {
      const dock = document.querySelector("[data-dock]")!.getBoundingClientRect(), card = document.querySelector(".card-result-head > section")!.getBoundingClientRect();
      return { left: Math.round(dock.left - card.left), right: Math.round(dock.right - card.right), width: Math.round(dock.width), page: innerWidth };
    });
    expect(await sides()).toMatchObject({ left: 0, right: 0 });
    await page.setViewportSize({ width: 820, height: 640 });
    await expect.poll(corner).toBe("0px");
    expect((await sides()).width).toBe(820);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(corner).toBe("0px");
    expect((await sides()).width).toBe(390);
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect.poll(corner).toBe("20px");
    await expect.poll(sides).toMatchObject({ left: 0, right: 0 });
    await page.locator(".cashier-award-now").click();
    await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
    expect(Math.abs((await layout()).dockTop - open.dockTop)).toBeLessThanOrEqual(4); // up to 3.5 px of rounding at 2.625 (0 at a ratio of 2)
  });

  test("the dock's 1 px top edge is drawn, under the fade on a phone and on the floating panel (390 × 844, 820 × 1180)", async ({ page }) => {
    await signIn(page);
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const { cardToken } = await (await page.request.post("/api/enroll", { data: { slug: demo.programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true }, headers: { Origin: origin } })).json() as { cardToken: string };
    const { scanCode: code } = await (await page.request.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(code);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(page.locator(".cashier-award-now")).toBeVisible();
    for (const size of [{ width: 390, height: 844 }, { width: 820, height: 1180 }]) {
      await page.setViewportSize(size);
      await expect.poll(() => page.evaluate(() => document.querySelector("[data-dock]")!.hasAttribute("data-floating"))).toBe(size.width > 600);
      const [above, line, under] = await topEdge(page);
      expect(apart(line, above), `${size.width}: ${JSON.stringify({ above, line, under })}`).toBeGreaterThan(12);
      expect(apart(line, under), `${size.width}: ${JSON.stringify({ above, line, under })}`).toBeGreaterThan(12);
    }
  });

  test("with reduced motion the counter tablet's dock floats from its first frame: never the phone's flat full-width dock, four 20 px corners, and the typed floor stays on the phone (820 × 1180)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 820, height: 1180 });
    const card = await (await ownShop(page, [8]))(3);
    const corners = () => page.evaluate(() => { const s = getComputedStyle(document.querySelector("[data-dock]")!); return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius]; });
    // Every animation frame from the tap on: the dock's width as it is laid out for that frame's paint.
    const watch = () => page.evaluate(() => { const w = window as unknown as { __docks: number[] }; w.__docks = []; const until = performance.now() + 1500;
      const frame = () => { const d = document.querySelector("[data-dock]"); if (d) w.__docks.push(Math.round(d.getBoundingClientRect().width)); if (performance.now() < until) requestAnimationFrame(frame); };
      requestAnimationFrame(frame); });
    for (const [field, open] of [[card.scanCode, false], [card.cardLocator, true]] as const) {
      await page.goto("/cashier");
      await page.getByLabel("Kartennummer oder Kartencode").fill(field);
      if (!open) await watch();
      await page.getByRole("button", { name: "Prüfen", exact: true }).click();
      if (open) { await page.getByRole("button", { name: "Karte öffnen", exact: true }).waitFor(); await watch(); await page.getByRole("button", { name: "Karte öffnen", exact: true }).click(); }
      await expect(page.locator(".cashier-award-now")).toBeVisible();
      await page.waitForTimeout(400);
      const widths = await page.evaluate(() => (window as unknown as { __docks: number[] }).__docks);
      expect(widths.length, field).toBeGreaterThan(0);
      expect(widths.filter(w => w >= 820), `${field}: ${widths.join(",")}`).toEqual([]);
      expect(await corners(), field).toEqual(["20px", "20px", "20px", "20px"]);
      // The keys keep the tablet's open inset: the phone's typed floor would push them down inside the panel.
      expect(await page.evaluate(() => Math.round(document.querySelector(".quantity-row button")!.getBoundingClientRect().top - document.querySelector("[data-dock]")!.getBoundingClientRect().top)), field).toBeLessThanOrEqual(40);
    }
  });

  test("the Kasse card's stamp area is as tall as its rows: goals 3 to 8 at 390, round discs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const { cardToken } = await (await page.request.post("/api/enroll", { data: { slug: demo.programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true }, headers: { Origin: origin } })).json() as { cardToken: string };
    const { scanCode: code } = await (await page.request.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
    let goal = 3;
    // The goal is the card's own reward cost, answered by the lookup; the server's card and booking are untouched.
    await page.route(url => url.pathname === "/api/cashier/lookup", async route => {
      const answer = await (await route.fetch()).json() as { rewards: Array<{ cost: number }>; balance: number };
      await route.fulfill({ json: { ...answer, balance: 2, rewards: answer.rewards.length ? [{ ...answer.rewards[0], cost: goal }] : answer.rewards } });
    });
    for (goal = 3; goal <= 8; goal++) {
      await page.goto("/cashier");
      await page.getByLabel("Kartennummer oder Kartencode").fill(code);
      await page.getByRole("button", { name: "Prüfen", exact: true }).click();
      await expect(page.locator(".cashier-award-now")).toBeVisible();
      const grid = await page.evaluate(() => {
        const stamps = document.querySelector(".card-result-head [role='img'][data-rows]")!, discs = [...stamps.children].map(el => el.getBoundingClientRect());
        return { height: stamps.getBoundingClientRect().height, rows: new Set(discs.map(r => Math.round(r.top))).size, disc: discs[0].height, gap: parseFloat(getComputedStyle(stamps).rowGap), square: discs.every(r => Math.abs(r.width - r.height) < 0.5) };
      });
      expect(grid.rows, `goal ${goal}`).toBe(goal <= 5 ? 1 : 2);
      expect(Math.abs(grid.height - (grid.rows * grid.disc + (grid.rows - 1) * grid.gap)), `goal ${goal}: ${JSON.stringify(grid)}`).toBeLessThan(1);
      expect(grid.square, `goal ${goal}`).toBe(true);
    }
  });


  test("the same card booked twice in a row: its notice stays through „Gebucht“, one dock top and one card top (820 × 1180, 390 × 844)", async ({ page }) => {
    await signIn(page);
    const origin = new URL(test.info().project.use.baseURL!).origin;
    for (const size of [{ width: 820, height: 1180 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      const { cardToken } = await (await page.request.post("/api/enroll", { data: { slug: demo.programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true }, headers: { Origin: origin } })).json() as { cardToken: string };
      const { scanCode: code } = await (await page.request.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
      await page.goto("/cashier");
      await page.getByLabel("Kartennummer oder Kartencode").fill(code);
      await page.getByRole("button", { name: "Prüfen", exact: true }).click();
      await page.locator(".cashier-award-now").click();
      await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
      // Reopened at once from the „Gebucht“ dock's field: the card carries the notice of the booking seconds ago.
      await page.locator(".cashier-booked #cashier-code").fill(code);
      await page.locator(".cashier-booked #cashier-code").press("Enter");
      await expect(page.locator(".cashier-status--pending")).toContainText("Auf dieser Karte wurde vor");
      await expect(page.locator(".cashier-award-now")).toBeVisible();
      const at = () => page.evaluate(() => ({ dock: Math.round(document.querySelector("[data-dock]")!.getBoundingClientRect().top), card: Math.round(document.querySelector(".card-result-head")!.getBoundingClientRect().top), notice: Math.round(document.querySelector(".cashier-notice-kept, .cashier-status--pending")!.getBoundingClientRect().height) }));
      const open = await at();
      // A tap, not Playwright's click: that first scrolls the sticky dock's button to its place in the page flow, which
      // a finger never does, and would move the card itself.
      await page.locator(".cashier-award-now").dispatchEvent("click");
      await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
      await expect(page.locator(".cashier-notice-kept")).toContainText("Auf dieser Karte wurde vor");
      const booked = await at();
      expect(Math.abs(booked.dock - open.dock), `${size.width}: ${JSON.stringify({ open, booked })}`).toBeLessThanOrEqual(4); // 2.625 DPR rounding
      expect(booked.card, `${size.width}: ${JSON.stringify({ open, booked })}`).toBe(open.card);
    }
  });

  test("the phone's rebook state reserves the dock: the notice and the figure in the first screen, the foot scrolls clear of the dock (390 × 844)", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const { cardToken } = await (await page.request.post("/api/enroll", { data: { slug: demo.programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true }, headers: { Origin: origin } })).json() as { cardToken: string };
    const { scanCode: code } = await (await page.request.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(code);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await page.locator(".cashier-award-now").click();
    await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
    await page.locator(".cashier-booked #cashier-code").fill(code);
    await page.locator(".cashier-booked #cashier-code").press("Enter");
    await expect(page.locator(".cashier-status--pending")).toContainText("Auf dieser Karte wurde vor");
    const measure = () => page.evaluate(() => {
      const box = (el: Element | null | undefined) => el!.getBoundingClientRect();
      const foot = document.querySelector(".card-result-head button")!.parentElement;
      return { dock: box(document.querySelector("[data-dock]")).top, notice: box(document.querySelector(".cashier-notice-kept, .cashier-status--pending")).bottom,
        figure: box(document.querySelector(".card-result-head [data-figure]")).bottom, foot: box(foot).bottom, last: Math.max(...[...document.querySelector("main")!.children].map(child => child.getBoundingClientRect().bottom)), height: innerHeight };
    });
    const atEnd = async () => { await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" })); return measure(); };
    const first = await measure();
    expect(first.notice, JSON.stringify(first)).toBeLessThanOrEqual(first.dock);
    expect(first.figure, JSON.stringify(first)).toBeLessThanOrEqual(first.dock);
    const open = await atEnd();
    expect(open.foot, JSON.stringify(open)).toBeLessThanOrEqual(open.dock);
    expect(open.last, JSON.stringify(open)).toBeLessThanOrEqual(open.dock);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.locator(".cashier-award-now").dispatchEvent("click");
    await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand:");
    await expect(page.locator(".cashier-notice-kept")).toContainText("Auf dieser Karte wurde vor");
    const booked = await atEnd();
    expect(booked.foot, JSON.stringify(booked)).toBeLessThanOrEqual(booked.dock);
    expect(booked.last, JSON.stringify(booked)).toBeLessThanOrEqual(booked.dock);
  });

  test("with reduced motion the booking confirmation does not animate", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page);
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(await scanCode());
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await page.locator(".cashier-award-now").click();
    const booked = page.locator(".cashier-booked");
    await expect(booked).toBeVisible();
    expect(await booked.evaluate(el => getComputedStyle(el).transitionProperty)).toBe("none");
  });

  test("a failed access check says what to do, never the server's text", async ({ page }) => {
    await signIn(page);
    const screen = page.locator("section").filter({ has: page.getByRole("heading", { name: "Zugang gesperrt oder nicht eingerichtet" }) });
    await page.route("**/api/me", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal error" }) }));
    await page.goto("/cashier");
    await expect(screen).toContainText("Die Kasse kann gerade nicht geladen werden. Lade die Seite in einem Moment neu.");
    await page.unroute("**/api/me");
    await page.route("**/api/me", route => route.abort("internetdisconnected"));
    await page.reload();
    await expect(screen).toContainText("weil die Verbindung fehlt");
    expect(await screen.innerText()).not.toMatch(/Internal error|Keine Verbindung\. Bitte/);
  });
});
