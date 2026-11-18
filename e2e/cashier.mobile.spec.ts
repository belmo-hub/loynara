import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { smallTargets } from "./support/targets";
import { pool } from "../src/db";

// The counter on phones: dark whatever the system setting, nothing sideways, text at least 14 px, every control at
// least 44 px, the booking button 64 px in the dock, and "Gebucht" fading in over 160 ms without movement.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cashierEmail: string; cashierPassword: string; programSlug: string };
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
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(await scanCode());
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

  test("while a slow access check runs the Kasse shows its own placeholders, and words only once it is late", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/me", async route => { await new Promise(done => setTimeout(done, 1_500)); await route.continue(); });
    await page.goto("/cashier");
    await expect(page.locator(".cashier-placeholder")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kassenzugang wird geprüft" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Kassenzugang wird geprüft" })).toBeVisible();
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
    await page.locator(".cashier-award-now").click();
    const field = page.locator(".cashier-booked #cashier-code");
    await expect(field).toBeFocused();
    await expect(field).toBeInViewport({ ratio: 1 });
    await expect(field).toHaveAttribute("placeholder", "Kartennummer oder Kartencode");
    expect(Math.round((await field.boundingBox())!.height)).toBe(44);
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
