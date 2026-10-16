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
});
