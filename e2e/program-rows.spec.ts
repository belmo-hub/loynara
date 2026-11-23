import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";

// ENG-364 (Design round 3): on Programm a row's value („Kein Link“, „Kein Betrag“, „Aus“) goes under the words only under
// large text, once a word no longer fits beside it. At 100 % every value stays beside its words from 320 to 390; at 160 and
// 200 % no word sits under a value and nothing scrolls sideways.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };
test.beforeEach(({ page }) => page.emulateMedia({ reducedMotion: "reduce" }));

/**
 * Sets the width and the text size on the one loaded page. The page is loaded once: the owner job's specs share the demo
 * owner, and Programm's reads (winback, referrals) allow 60 per owner in 15 minutes.
 */
async function size(page: Page, width: number, percent: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(next => {
    const style = document.getElementById("test-text-size") ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: "test-text-size" }));
    style.textContent = next === 100 ? "" : `html { font-size: ${next}% !important }`;
  }, percent);
  await page.waitForFunction(expected => getComputedStyle(document.documentElement).fontSize === expected, `${16 * percent / 100}px`);
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
  // The chevron stays with its value: one unit, never alone on a line of its own.
  const chevron = body.querySelector("svg")?.getBoundingClientRect();
  const together = !chevron || Math.abs((chevron.top + chevron.bottom) / 2 - (box.top + box.bottom) / 2) < 2;
  return [{ name: text.querySelector("b")?.textContent ?? "", beside: box.top < words.bottom - 1, under, together }];
}));
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("Programm keeps each value beside its words at 100 % and never puts words under a value at 160 and 200 %", async ({ page, baseURL }) => {
  const api = await apiRequest.newContext({ baseURL });
  expect((await api.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword }, headers: { Origin: baseURL! } })).ok()).toBe(true);
  await page.context().addCookies((await api.storageState()).cookies);
  await api.dispose();
  await page.goto("/merchant/program");
  await expect(page.getByRole("heading", { name: "Extras" })).toBeVisible(); // always there, whatever the programme type
  for (const width of [320, 360, 390]) {
    await size(page, width, 100);
    const found = await rows(page);
    expect(found.length).toBeGreaterThan(3);
    expect(found.filter(row => !row.beside).map(row => row.name), `values beside their words at ${width}`).toEqual([]);
    expect(found.filter(row => row.under).map(row => row.name), `no words under a value at ${width}`).toEqual([]);
  }
  for (const percent of [160, 200]) for (const width of [320, 360, 390]) {
    await size(page, width, percent);
    const found = await rows(page);
    expect(found.filter(row => row.under).map(row => row.name), `no words under a value at ${width}, ${percent} %`).toEqual([]);
    expect(found.filter(row => !row.together).map(row => row.name), `chevrons with their values at ${width}, ${percent} %`).toEqual([]);
    // A title that fits beside its value and chevron, or on its own line, stays whole: the value moves, the word is not
    // cut into syllables (Design r4).
    expect(await page.evaluate(() => [...document.querySelectorAll("main [class*=mix-module][class*=__text] > b")].filter(title => {
      const text = title.firstChild;
      if (!(text instanceof Text) || /[\s-]/.test(text.data.trim())) return false; // one word only
      const probe = document.createElement("span"); probe.textContent = text.data; probe.style.whiteSpace = "nowrap";
      title.append(probe); const width = probe.getBoundingClientRect().width; probe.remove(); // the word unbroken
      const range = document.createRange(); range.selectNodeContents(text);
      // Room for the word: the row, less its value and chevron when they still sit beside the words.
      const body = title.closest("[class*=__body]")!, end = body.querySelector("[class*=__end]");
      const style = getComputedStyle(body), inner = body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const room = inner - (end && end.getBoundingClientRect().top < title.getBoundingClientRect().bottom ? end.getBoundingClientRect().width + parseFloat(style.columnGap) : 0);
      return width < room && new Set([...range.getClientRects()].map(line => Math.round(line.top))).size > 1;
    }).map(title => title.textContent)), `whole titles at ${width}, ${percent} %`).toEqual([]);
    expect(await sideways(page)).toBe(0);
  }
});
