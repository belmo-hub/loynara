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
    await page.getByRole("button", { name: "Meine Karte erstellen", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveCount(1);
    await expect(page.locator("form").getByRole("alert")).toBeVisible();
    await expect(page.getByRole("checkbox").first()).toBeChecked();
  });

  test("the recovery page shows no status message until something happened", async ({ page }) => {
    await page.goto("/recover");
    await expect(page.getByRole("heading", { name: "Karte wiederfinden" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  });
});
