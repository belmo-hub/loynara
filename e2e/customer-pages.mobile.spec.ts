import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { programSlug: string };

/** Controls below 44 px; links inside running text are exempt (WCAG 2.5.8 inline exception). */
async function smallControls(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main a[href], main button, main input:not([type=hidden]):not([type=checkbox])")]
    .filter((el) => el.offsetParent !== null && !(el.tagName === "A" && el.closest("p, label span")))
    .map((el) => ({ name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40), h: Math.round(el.getBoundingClientRect().height) }))
    .filter(({ h }) => h < 44));
}

const pages = [
  ["join", () => `/join/${encodeURIComponent(demo.programSlug)}`, "Mach deinen Besuch zählbar."],
  ["recover", () => "/recover", "Karte wiederfinden"],
  ["verify-email", () => "/verify-email", "Bestätigungslink ungültig."],
  ["unsubscribe", () => "/unsubscribe", "E-Mail-Angebote abbestellen"],
] as const;

test.describe("guest pages on phones", () => {
  for (const [name, path, heading] of pages) {
    test(`${name} fits the screen with comfortable targets`, async ({ page }) => {
      await page.goto(path());
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      expect(await smallControls(page)).toEqual([]);
    });
  }

  test("a failed sign-up shows one alert inside the join form and keeps the consent", async ({ page }) => {
    // The referral and release specs find this alert as `form` → role=alert; they need their own databases, so this pins the hook here.
    await page.route("**/api/enroll", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Synthetischer Fehler" }) }));
    await page.goto(`/join/${encodeURIComponent(demo.programSlug)}`);
    await page.getByRole("checkbox").first().check();
    const enrolled = page.waitForResponse(response => new URL(response.url()).pathname === "/api/enroll" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Meine Karte erstellen", exact: true }).click();
    expect((await enrolled).status()).toBe(500);
    // The alert carries the server's message, so it came from this failed request and not from client-side validation.
    await expect(page.locator("form").getByRole("alert")).toHaveCount(1);
    await expect(page.locator("form").getByRole("alert")).toContainText("Synthetischer Fehler");
    await expect(page.getByRole("checkbox").first()).toBeChecked();
  });

  test("the recovery page shows no status message until something happened", async ({ page }) => {
    await page.goto("/recover");
    await expect(page.getByRole("heading", { name: "Karte wiederfinden" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("a full-width button with a long label wraps instead of widening the page", async ({ page }) => {
    // The saved-card choice on /tap ("Mit meiner gespeicherten Karte fortfahren") needs an NFC tap to appear, so the
    // shared block-button style is checked here on a clone of the join button, at the narrowest supported width.
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/join/${encodeURIComponent(demo.programSlug)}`);
    const submit = page.getByRole("button", { name: "Meine Karte erstellen", exact: true });
    await submit.evaluate(button => {
      const long = document.createElement("button");
      long.className = button.className; long.type = "button"; long.id = "long-label";
      long.textContent = "Mit meiner gespeicherten Karte fortfahren und weitere Schritte prüfen";
      button.after(long);
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    expect(await page.locator("#long-label").evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(56);
  });
});
