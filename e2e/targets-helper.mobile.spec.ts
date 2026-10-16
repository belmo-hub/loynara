import { expect, test } from "@playwright/test";
import { smallTargets } from "./support/targets";

// The shared tap-target check must neither excuse standalone controls nor invent hit area. Each fixture is one case
// from review; the helper runs in both phone engines (WebKit and Chromium).
const page = (body: string) => `<!doctype html><meta name="viewport" content="width=device-width">
  <style>body { margin: 0; padding: 40px 20px; font: 16px/1.5 sans-serif; } .t { position: relative; display: inline-block; }</style>
  <main>${body}</main>`;

const cases: Array<[string, string, string[]]> = [
  ["a link inside a sentence is exempt", `<p>Lies die <a href="/a">Bedingungen</a> zuerst.</p>`, []],
  ["a link inside a checkbox sentence is exempt", `<label style="display:flex;min-height:48px;gap:8px"><input type="checkbox"><span>Ich akzeptiere die <a href="/a">Bedingungen</a>.</span></label>`, []],
  ["a link alone in a paragraph is a target", `<p><a href="/a">Allein</a></p>`, ["Allein"]],
  ["a link beside a button is a target", `<div><a href="/a">Mehr</a> <button style="width:50px;height:50px">Go</button></div>`, ["Mehr"]],
  ["a link before a line break is a target", `<p><a href="/a">Impressum</a><br>Copyright 2026</p>`, ["Impressum"]],
  ["a 2 × 2 button is a target", `<button style="width:2px;height:2px;padding:0;border:0"></button>`, [""]],
  ["a 43.6 px button is under the minimum", `<button style="width:43.6px;height:43.6px;padding:0;box-sizing:border-box">x</button>`, ["x"]],
  ["a ::after that ignores the pointer adds no hit area", `<style>.t::after { content: ""; position: absolute; inset: -12px; pointer-events: none; }</style><a class="t" href="/a" style="width:20px;height:20px">n</a>`, ["n"]],
  ["a 1 px ::after adds no hit area", `<style>.t::after { content: ""; position: absolute; inset: -12px; width: 1px; height: 1px; }</style><a class="t" href="/a" style="width:20px;height:20px">o</a>`, ["o"]],
  ["a real ::after overlay counts", `<style>.t::after { content: ""; position: absolute; inset: -12px; }</style><a class="t" href="/a" style="width:20px;height:20px">p</a>`, []],
  ["a real ::after overlay counts below the fold too", `<div style="height:2000px"></div><style>.t::after { content: ""; position: absolute; inset: -12px; }</style><a class="t" href="/a" style="width:20px;height:20px">q</a>`, []],
  ["a checkbox counts as its label", `<label style="display:flex;align-items:center;min-height:48px"><input type="checkbox"> Ja</label>`, []],
  ["a visually hidden file input counts as its label", `<label for="f" style="display:inline-flex;min-height:48px;min-width:120px">Logo wählen</label><input id="f" type="file" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">`, []],
];

test.describe("shared tap-target check", () => {
  for (const [name, body, expected] of cases) {
    test(name, async ({ page: tab }) => {
      await tab.setContent(page(body));
      const found = (await smallTargets(tab)).map(line => line.replace(/ [\d.]+x[\d.]+$/, ""));
      expect(found).toEqual(expected);
      // The check scrolls targets into view to hit-test them and must leave the page where it was.
      expect(await tab.evaluate(() => window.scrollY)).toBe(0);
    });
  }
});
