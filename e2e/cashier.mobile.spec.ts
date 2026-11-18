import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { smallTargets } from "./support/targets";
import { pool } from "../src/db";

// The counter on phones: dark whatever the system setting, nothing sideways, text at least 14 px, every control at
// least 44 px, the booking button 64 px in the dock, and "Gebucht" fading in over 160 ms without movement.
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
    expect(await booked.evaluate(el => { const cs = getComputedStyle(el); return [cs.transitionProperty, cs.transitionDuration, cs.transform]; })).toEqual(["opacity", "0.16s", "none"]);
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
    // The sticky dock lands up to 2 px lower from sub-pixel rounding at the 2.625 device-pixel ratio; nothing is under it.
    expect(atRest.scroll, JSON.stringify(atRest)).toBeLessThanOrEqual(2);
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
    await expect(page.locator(".reward-action-list button")).toHaveCount(2);
    const inset = await page.evaluate(() => Math.round(document.querySelector(".quantity-row button")!.getBoundingClientRect().top - document.querySelector("[data-dock]")!.getBoundingClientRect().top));
    expect(inset).toBeGreaterThanOrEqual(24);
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
