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

test("no shown name sits under another reward's shown price (80 / 160 / 250 at 375 px)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const real = await (await page.request.get(`/api/enroll/card/${demo.cardToken}`)).json();
  const rewards = [{ id: "a", title: "Bartöl", cost: 80 }, { id: "b", title: "Rasur", cost: 160 }, { id: "c", title: "Haarschnitt gratis", cost: 250 }];
  await page.route(new RegExp(`/api/(enroll/)?card/${demo.cardToken}$`), route => route.fulfill({ json: { ...real, programType: "points", balance: 12, rewards, activity: [] } }));
  await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
  await expect(page.locator(".customer-card [data-title]", { hasText: "Haarschnitt gratis" })).toBeVisible();
  await expect.poll(() => page.locator(".customer-card [data-titles]").evaluate(ladder => {
    const shown = (el: Element) => getComputedStyle(el).visibility !== "hidden";
    const marks = [...ladder.children].slice(1);
    return marks.flatMap((mark, i) => [...mark.querySelectorAll("[data-title]")].filter(shown).flatMap(name => {
      const a = name.getBoundingClientRect();
      return marks.filter((_, j) => j !== i).map(other => other.querySelector("small")!).filter(shown)
        .filter(price => { const b = price.getBoundingClientRect(); return a.left < b.right && a.right > b.left; }).map(price => `${name.textContent} over ${price.textContent}`);
    }));
  })).toEqual([]);
});

// Design, 12 Nov (ruling 49): with the thousands separator a price is wider than the 24 px the layout once assumed.
for (const width of [320, 375]) for (const [name, costs] of [["1.000 / 2.500 / 10.000", [1000, 2500, 10000]], ["two six-figure costs close together", [500, 240000, 250000]], ["a six-figure cost near a seven-figure goal", [833250, 1000000]], ["four five-figure costs", [62700, 77100, 96750, 100000]]] as const) {
  test(`no two shown prices touch at ${width}px (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const real = await (await page.request.get(`/api/enroll/card/${demo.cardToken}`)).json();
    // Short names, so no price hides under a name and every label has to find its own room.
    const rewards = costs.map((cost, i) => ({ id: String(i), title: ["Tee", "Öl", "Bad", "Ei"][i], cost }));
    await page.route(new RegExp(`/api/(enroll/)?card/${demo.cardToken}$`), route => route.fulfill({ json: { ...real, programType: "points", balance: 12, rewards, activity: [] } }));
    await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
    const ladder = page.locator(".customer-card [data-titles]");
    await expect(ladder).toBeVisible();
    const goal = ladder.locator("> span").last().locator("small").first();
    await expect(goal).toBeVisible();
    await expect.poll(() => ladder.evaluate(el => {
      const prices = [...el.children].slice(1).map(mark => mark.querySelector("small")!).filter(price => getComputedStyle(price).visibility !== "hidden");
      return prices.flatMap((a, i) => prices.slice(i + 1).filter(b => { const p = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return p.left < q.right && p.right > q.left; }).map(b => `${a.textContent} touches ${b.textContent}`));
    })).toEqual([]);
  });
}
