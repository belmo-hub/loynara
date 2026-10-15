import { expect, test, type Page } from "@playwright/test";

const shells = ["customer", "cashier", "auth"];

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Interactive elements smaller than 44 × 44 px (inputs wrapped by their label count as the label's size). */
async function smallTargets(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>("a[href], button, select, textarea, input:not([type=hidden])")]
    .filter((el) => el.offsetParent !== null && !el.closest("dialog:not([open])"))
    .map((el) => (el.matches("input[type=checkbox], input[type=radio]") && el.closest("label") ? el.closest("label")! : el))
    .map((el) => ({ name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40), box: el.getBoundingClientRect() }))
    .filter(({ box }) => box.height < 44 || box.width < 44)
    .map(({ name, box }) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`));
}

test.describe("design system shells on phones", () => {
  // The preview pages exist only in development builds; production servers answer 404.
  test.beforeEach(async ({ request }) => {
    test.skip((await request.get("/dev/design")).status() === 404, "design preview is development-only");
  });

  for (const shell of shells) {
    test(`${shell} shell fits the screen and keeps touch targets`, async ({ page }) => {
      await page.goto(`/dev/design/shells/${shell}`);
      await expect(page.locator("main")).toBeVisible();
      expect(await horizontalOverflow(page)).toBe(0);
      expect(await smallTargets(page)).toEqual([]);
    });
  }

  test.describe("dark appearance", () => {
    test.use({ colorScheme: "dark" });
    test("follows the system setting", async ({ page }) => {
      await page.goto("/dev/design/shells/customer");
      const background = await page.locator(".ly-theme-auto", { has: page.locator("main") }).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(background).toBe("rgb(15, 23, 19)");
    });
  });
});
