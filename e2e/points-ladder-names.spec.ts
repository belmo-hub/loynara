import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Design, 31 Oct: the goal's name on the points ladder is never cut while a short neighbour keeps room it does not use.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cardToken: string };

for (const width of [320, 360, 375, 1280]) {
  test(`the goal „Haarschnitt gratis“ stays whole beside „Bartöl“ at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const real = await (await page.request.get(`/api/enroll/card/${demo.cardToken}`)).json();
    const read = { ...real, programType: "points", balance: 112, rewards: [{ id: "a", title: "Bartöl", cost: 100 }, { id: "b", title: "Haarschnitt gratis", cost: 250 }], activity: [] };
    await page.route(new RegExp(`/api/(enroll/)?card/${demo.cardToken}$`), route => route.fulfill({ json: read }));
    await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
    const goal = page.locator(".customer-card [data-title]", { hasText: "Haarschnitt gratis" });
    await expect(goal).toBeVisible();
    await expect.poll(() => goal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator(".customer-card [data-title]", { hasText: "Bartöl" })).toBeVisible();
  });
}
