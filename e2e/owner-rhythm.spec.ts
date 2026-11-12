import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The owner area's one rhythm (Design, 12 Nov, rulings SP1 to SP5 and SP9), measured on the rendered pages:
// 24 from the page head to the first block; 20 above a section label and 8 below it, with or without its „?“;
// every card and panel 16 inside; a chip 4 under its title; a hint 8 under its block.
const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

test.describe.configure({ mode: "serial" });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.ownerEmail);
  await page.getByLabel("Passwort").fill(access.ownerPassword);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("/merchant");
});
test.afterAll(() => page.close());

const rhythm = () => page.evaluate(() => {
  const box = (el: Element) => el.getBoundingClientRect(), px = (n: number) => Math.round(n * 2) / 2, main = document.getElementById("ow-main")!;
  const before = (el: Element | null) => { let p = el?.previousElementSibling ?? null; while (p && box(p).height === 0) p = p.previousElementSibling; return p; };
  const head = main.querySelector(".ow-page > .ow-pagehead");
  const labels = [...main.querySelectorAll(".ow-rows-head, .ow-section-head, .ow-prog h2")].filter(el => !el.closest("dialog") && !(el.matches("h2") && el.closest(".ow-rows-head")));
  return {
    head: head?.nextElementSibling ? px(box(head.nextElementSibling).top - box(head).bottom) : null,
    above: labels.flatMap(el => { const block = el.closest(".ow-rows-section, .ow-prog > div") ?? el, prev = before(block) ?? before(block.parentElement); return prev ? [px(box(block).top - box(prev).bottom)] : []; }),
    below: labels.flatMap(el => el.nextElementSibling ? [px(box(el.nextElementSibling).top - box(el).bottom)] : []),
    helpGrowsRow: [...main.querySelectorAll(".ow-rows-head")].map(el => px(box(el).height - box(el.querySelector("h2")!).height)),
    padding: [...new Set([...main.querySelectorAll(".ow-card, .ow-board, .ow-qpanel")].map(el => getComputedStyle(el).padding))],
    chips: [...main.querySelectorAll(".ow-prog-text .ow-chip")].flatMap(el => el.previousElementSibling ? [px(box(el).top - box(el.previousElementSibling).bottom)] : []),
    hints: [...main.querySelectorAll(".ow-page > .ow-hint")].flatMap(el => { const prev = before(el); return prev ? [px(box(el).top - box(prev).bottom)] : []; }),
  };
});
const only = (values: Array<number | string>, ...allowed: Array<number | string>) => values.filter(value => !allowed.includes(value));

for (const path of ["/merchant/analytics", "/merchant/program", "/merchant/billing", "/merchant/locations", "/merchant/customers", "/merchant/settings", "/merchant/referrals", "/merchant/adviser"]) {
  test(`${path} keeps the owner rhythm`, async () => {
    await page.goto(path);
    await expect(page.locator("#ow-main h1")).toBeVisible();
    await expect.poll(async () => {
      const m = await rhythm();
      // `loaded`: the page's own content is there (labels, or the adviser's panels), so an empty list is not a pass.
      return { loaded: m.below.length > 0 || path.endsWith("/adviser"), head: m.head, above: only(m.above, 20, 24), below: only(m.below, 8), helpGrowsRow: only(m.helpGrowsRow, 0), padding: only(m.padding, "16px"), chips: only(m.chips, 4), hints: only(m.hints, 8) };
    }).toEqual({ loaded: true, head: 24, above: [], below: [], helpGrowsRow: [], padding: [], chips: [], hints: [] });
  });
}
