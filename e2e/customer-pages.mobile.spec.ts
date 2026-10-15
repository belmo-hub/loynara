import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { smallTargets } from "./support/targets";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { programSlug: string };


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
      expect(await smallTargets(page, { scope: "main" })).toEqual([]);
    });
  }

  test("the recovery page shows no status message until something happened", async ({ page }) => {
    await page.goto("/recover");
    await expect(page.getByRole("heading", { name: "Karte wiederfinden" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  });
});
