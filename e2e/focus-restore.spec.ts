import { expect, test, type Page } from "@playwright/test";
import { restoreFocus } from "../src/components/ui/use-modal";

// restoreFocus runs when a dialog is unmounted while open (the cashier's confirmation). The function is self-contained,
// so this runs the shipped code in a bare page: <main> with an opener button and another control.
async function setUp(page: Page, opener: "usable" | "disabled" | "gone") {
  await page.setContent(`<main><p>Kasse</p><button id="opener" ${opener === "disabled" ? "disabled" : ""}>2 Stempel prüfen</button><button id="other">Andere Karte</button></main>`);
  await page.evaluate(([source, state]) => {
    const opener = document.getElementById("opener")!;
    if (state === "gone") opener.remove();
    (document.activeElement as HTMLElement | null)?.blur();
    (window as unknown as { restore: () => void }).restore = () => new Function("opener", `(${source})(opener)`)(opener);
  }, [restoreFocus.toString(), opener] as const);
  await page.evaluate(() => (window as unknown as { restore: () => void }).restore());
}
const focused = (page: Page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

test("an usable opener gets focus back", async ({ page }) => {
  await setUp(page, "usable");
  expect(await focused(page)).toBe("opener");
});

test("a busy opener: focus waits on main, then returns once it is usable", async ({ page }) => {
  await setUp(page, "disabled");
  expect(await focused(page)).toBe("MAIN");
  await page.evaluate(() => document.getElementById("opener")!.removeAttribute("disabled"));
  await expect.poll(() => focused(page)).toBe("opener");
});

test("a busy opener does not pull focus back after the user moved on", async ({ page }) => {
  await setUp(page, "disabled");
  await page.focus("#other");
  await page.evaluate(() => document.getElementById("opener")!.removeAttribute("disabled"));
  await page.waitForTimeout(100);
  expect(await focused(page)).toBe("other");
});

test("a removed opener leaves focus on main, not on the page body", async ({ page }) => {
  await setUp(page, "gone");
  expect(await focused(page)).toBe("MAIN");
});

test("focus that is already placed stays where it is", async ({ page }) => {
  await page.setContent(`<main><button id="opener">a</button><button id="other">b</button></main>`);
  await page.focus("#other");
  await page.evaluate(([source]) => new Function("opener", `(${source})(opener)`)(document.getElementById("opener")), [restoreFocus.toString()] as const);
  expect(await focused(page)).toBe("other");
});
