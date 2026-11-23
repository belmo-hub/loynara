import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";

// ENG-364 (Design round 3): on Programm a row's value („Kein Link“, „Kein Betrag“, „Aus“) goes under the words only under
// large text, once a word no longer fits beside it. At 100 % every value stays beside its words from 320 to 390; at 160 and
// 200 % no word sits under a value and nothing scrolls sideways.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };
test.beforeEach(({ page }) => page.emulateMedia({ reducedMotion: "reduce" }));

async function open(page: Page, width: number, percent: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/merchant/program");
  await expect(page.getByRole("heading", { name: "Für die Ergebnisse" })).toBeVisible();
  if (percent !== 100) {
    await page.addStyleTag({ content: `html { font-size: ${percent}% !important }` });
    await page.waitForFunction(size => getComputedStyle(document.documentElement).fontSize === size, `${16 * percent / 100}px`);
  }
  // Until the layout reads the same 100 ms apart: a container query can start a transition a frame late.
  await page.evaluate(async () => {
    let last = "";
    for (const started = performance.now(); performance.now() - started < 3_000;) {
      await new Promise(done => setTimeout(done, 100));
      const now = [...document.querySelectorAll("main *")].slice(0, 600).map(element => { const box = element.getBoundingClientRect(); return `${box.x | 0},${box.y | 0},${box.width | 0}`; }).join(" ");
      if (now === last) return;
      last = now;
    }
  });
}
/** For each row with a value: its words, whether the value sits beside them, and whether any word runs under the value. */
const rows = (page: Page) => page.evaluate(() => [...document.querySelectorAll("main [class*=mix-module][class*=__body]")].flatMap(body => {
  const text = body.querySelector("[class*=__text]"), value = body.querySelector("[class*=__val]");
  if (!text || !value) return [];
  const box = value.getBoundingClientRect(), words = text.getBoundingClientRect();
  const lines = [...text.querySelectorAll("b, small")].flatMap(element => { const range = document.createRange(); range.selectNodeContents(element); return [...range.getClientRects()]; });
  // 3 px of slack: at 100 % on a 320 phone „Durchschnittsbon“ grazes the value's line box by 2 px, as on rc.
  const under = lines.some(line => line.left < box.right - 3 && box.left < line.right - 3 && line.top < box.bottom - 3 && box.top < line.bottom - 3);
  return [{ name: text.querySelector("b")?.textContent ?? "", beside: box.top < words.bottom - 1, under }];
}));
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("Programm keeps each value beside its words at 100 % and never puts words under a value at 160 and 200 %", async ({ page, baseURL }) => {
  const api = await apiRequest.newContext({ baseURL });
  expect((await api.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword }, headers: { Origin: baseURL! } })).ok()).toBe(true);
  await page.context().addCookies((await api.storageState()).cookies);
  await api.dispose();
  for (const width of [320, 360, 390]) {
    await open(page, width, 100);
    const found = await rows(page);
    expect(found.length).toBeGreaterThan(3);
    expect(found.filter(row => !row.beside).map(row => row.name), `values beside their words at ${width}`).toEqual([]);
    expect(found.filter(row => row.under).map(row => row.name), `no words under a value at ${width}`).toEqual([]);
  }
  for (const percent of [160, 200]) for (const width of [320, 390]) {
    await open(page, width, percent);
    expect((await rows(page)).filter(row => row.under).map(row => row.name), `no words under a value at ${width}, ${percent} %`).toEqual([]);
    expect(await sideways(page)).toBe(0);
  }
});
