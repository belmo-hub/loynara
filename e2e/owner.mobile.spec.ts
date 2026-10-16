import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { smallTargets } from "./support/targets";

// The owner dashboard on phones: nothing sideways, text at least 14 px (12 px only for bottom-bar labels; the
// wallet-pass mock is a scaled illustration), controls at least 44 px, dark with the system, a bottom bar whose
// "Mehr" opens the navigation panel, and page changes without an entrance animation.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };
const pages = ["", "/adviser", "/analytics", "/audiences", "/automations", "/billing", "/campaigns", "/customers", "/customers/import",
  "/locations", "/program", "/program/card", "/referrals", "/settings", "/staff"];

async function signIn(page: Page) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const res = await page.request.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword }, headers: { Origin: origin } });
  expect(res.ok()).toBe(true);
}

async function audit(page: Page) {
  const measured = await page.evaluate(() => {
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden], [inert]"); };
    const exempt = (el: Element) => Boolean(el.closest(".ow-tab, .ow-pass, .ow-cardprev-face"));
    const smallText = [...document.querySelectorAll("body *")].filter(el => visible(el) && !exempt(el) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim()))
      .filter(el => parseFloat(getComputedStyle(el).fontSize) < 14).map(el => el.textContent!.trim().slice(0, 30));
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, smallText };
  });
  // The wallet-pass mock and the card preview are scaled illustrations, not controls.
  return { ...measured, smallControls: await smallTargets(page, { exempt: ".ow-pass, .ow-cardprev-face" }) };
}

test.describe("owner dashboard on phones", () => {
  test("every page fits, keeps 14 px text and 44 px controls", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    for (const path of pages) {
      await page.goto(`/merchant${path}`);
      await expect(page.locator(".ow-body")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect({ path, ...(await audit(page)) }).toEqual({ path, overflow: 0, smallText: [], smallControls: [] });
    }
  });

  test("the bottom bar reaches the main areas and Mehr opens the navigation panel", async ({ page }) => {
    await signIn(page);
    await page.goto("/merchant");
    const bar = page.getByRole("navigation", { name: "Bereiche" });
    await expect(bar.getByRole("link")).toHaveText(["Übersicht", "Programm", "Kunden", "Aktionen"]);
    await bar.getByRole("link", { name: "Kunden" }).click();
    await expect(page).toHaveURL(/\/merchant\/customers$/);
    expect(await page.locator(".ow-body").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
    await bar.getByRole("button", { name: "Mehr" }).click();
    await expect(page.getByRole("complementary", { name: "Bereichsnavigation" })).toHaveAttribute("data-open", "true");
  });

  test.describe("in dark mode", () => {
    test.use({ colorScheme: "dark" });
    test("the dashboard follows the system", async ({ page }) => {
      await signIn(page);
      await page.goto("/merchant");
      await expect(page.locator(".ow-body")).toBeVisible();
      expect(await page.locator(".owner-app").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(15, 23, 19)");
      expect((await audit(page)).smallText).toEqual([]);
    });
  });
});
