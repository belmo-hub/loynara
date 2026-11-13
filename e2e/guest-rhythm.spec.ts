import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The customer, sign-in and state screens' rhythm at 390 px (Design, 12 Nov, rulings SP5, SP7, SP11 and sign 15),
// measured on the rendered pages: the first block 24 under the bar; a tile only on an error, the title 16 under it;
// a lead 4 under its title; 16 between fields and 24 above a form's button; cards 16 inside; 20 above a label, 8 below.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cardToken: string; programSlug: string };
test.use({ viewport: { width: 390, height: 844 } });

const read = (page: Page) => page.evaluate(() => {
  const box = (el: Element) => el.getBoundingClientRect(), px = (n: number) => Math.round(n * 2) / 2;
  const seen = (el: Element | null | undefined): el is Element => Boolean(el && box(el).height > 0);
  const bar = Math.max(0, ...[...document.querySelectorAll("header")].filter(el => !el.closest("main") && seen(el)).map(el => box(el).bottom));
  const title = document.querySelector("main h1")!, lead = title.nextElementSibling, before = title.previousElementSibling;
  const tile = seen(before) && before.querySelector("svg") ? before : null;
  const form = document.querySelector("main form");
  const fields = form ? [...form.children].filter(seen) : [];
  return {
    first: px(box(tile ?? title).top - bar),
    tileToTitle: tile ? px(box(title).top - box(tile).bottom) : null,
    titleToLead: seen(lead) && lead.matches("p") ? px(box(lead).top - box(title).bottom) : null,
    form: fields.slice(1).map((el, i) => px(box(el).top - box(fields[i]).bottom)),
  };
});

for (const [name, path, want] of [
  ["Karte wiederfinden", "/recover", { first: 24, tileToTitle: null, titleToLead: 4, form: [24] }],
  ["an unknown card link (an error: the tile)", "/card/not-a-real-card-token-0000000000000000000000000000", { first: 24, tileToTitle: 16, titleToLead: 4, form: [] }],
  ["a page that does not exist (no tile)", "/gibt-es-nicht", { first: 24, tileToTitle: null, titleToLead: 4, form: [] }],
  ["sign-in", "/login", { first: 24, tileToTitle: null, titleToLead: 4, form: [16, 8, 24] }],
] as const) {
  test(`${name} keeps the rhythm`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await expect.poll(() => read(page)).toEqual(want);
  });
}

test("the customer's card: 16 inside every card, 20 above a section label and 8 below it", async ({ page }) => {
  await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
  await expect(page.locator(".customer-qr img")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect(), px = (n: number) => Math.round(n * 2) / 2;
    const sections = [...document.querySelectorAll('main section[aria-labelledby^="customer-"]')].filter(el => box(el).height > 0);
    const prev = (el: Element) => { let p = el.previousElementSibling; while (p && box(p).height === 0) p = p.previousElementSibling; return p; };
    return {
      sections: sections.length > 0,
      above: sections.flatMap(el => { const p = prev(el); return p ? [px(box(el).top - box(p).bottom)] : []; }).filter(gap => gap !== 20),
      below: sections.map(el => { const label = el.querySelector("h2")!; return px(box(label.nextElementSibling!).top - box(label).bottom); }).filter(gap => gap !== 8),
      padding: [...new Set(sections.map(el => getComputedStyle(el.querySelector("h2")!.nextElementSibling!).padding).filter(value => value !== "0px" && value !== "16px"))],
    };
  })).toEqual({ sections: true, above: [], below: [], padding: [] });
});

// Heights (Design, 12 Nov, ruling SP6 and call 6): customer and sign-in fields and primaries are 48.
const heights = (page: Page, selector: string) => page.locator(selector).evaluateAll(list => [...new Set(list.filter(el => el.getBoundingClientRect().height > 0).map(el => Math.round(el.getBoundingClientRect().height)))]);

test("sign-in: fields and the button are 48 high", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
  expect(await heights(page, "main input, main button[type=submit]")).toEqual([48]);
});

test("a page that does not exist ends in 48 px ways out", async ({ page }) => {
  await page.goto("/gibt-es-nicht");
  await expect(page.locator("main h1")).toBeVisible();
  expect(await heights(page, "main section a[class*=button]")).toEqual([48]);
});

test("join: the button is 48 high and the sentence that names it sits 8 above it", async ({ page }) => {
  await page.goto(`/join/${encodeURIComponent(demo.programSlug)}`);
  const button = page.getByRole("button", { name: "Meine Karte erstellen" });
  await expect(button).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const button = document.querySelector("main form button[type=submit]")!, notice = document.getElementById("join-notice")!;
    return { button: Math.round(button.getBoundingClientRect().height), caption: Math.round(button.getBoundingClientRect().top - notice.getBoundingClientRect().bottom) };
  })).toEqual({ button: 48, caption: 8 });
});
