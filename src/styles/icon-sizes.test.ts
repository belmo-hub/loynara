import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DESIGN.md, Icons: four sizes, set by the text beside them (16 with 14 px text and in a labelled small button, 20
// with 16 px text and controls and for every status icon in a notice, alert or field error, 22 in tiles, bands, the
// tab bar, the sidebar and row arrows, 24 in a state-screen tile and the number stepper). Strokes are 2, 2.5 only on
// the current tab or nav icon, and 3 only for a check at 16 px or under.
// Drawn marks are not icons and keep their own measure: stamps and a stamp grid's goal glyph, the setup steps' tick,
// checkbox ticks, the brand mark, and illustrations (48 px and up).
const files = (root: string): string[] => readdirSync(root).flatMap(entry => {
  const path = join(root, entry);
  if (path === join("src", "app", "dev")) return [];
  return statSync(path).isDirectory() ? files(path) : [path];
});
const all = files("src").map(path => path.split("\\").join("/"));
const sources = all.filter(path => path.endsWith(".tsx") && !/\.test\.tsx$/.test(path));
const SIZES = [16, 20, 22, 24];

describe("icon sizes", () => {
  it("are 16, 20, 22 or 24 where a component passes one", () => {
    const odd = sources.flatMap(path => [...readFileSync(path, "utf8").matchAll(/\bsize=\{(\d+(?:\.\d+)?)\}/g)].map(match => ({ path, value: Number(match[1]) })))
      .filter(({ value }) => !SIZES.includes(value) && value < 48).map(({ path, value }) => `${path}: ${value}`);
    expect(odd).toEqual([]);
  });

  it("are 16, 20, 22 or 24 where a stylesheet sizes them", () => {
    const odd = all.filter(path => path.endsWith(".css")).flatMap(path => [...readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*\bsvg\b[^{}]*)\{[^}]*\b(?:width|height):\s*(\d+(?:\.\d+)?)px/g)]
      .map(match => ({ path, selector: match[1].trim(), value: Number(match[2]) })))
      .filter(({ value }) => !SIZES.includes(value)).map(({ path, selector, value }) => `${path} | ${selector}: ${value}`).sort();
    // Drawn: the brand mark, in the top bar and on the sign-in pages.
    expect(odd).toEqual(["src/components/owner/owner.css | .ow-topbar-brand svg: 32", "src/components/ui/auth-shell.module.css | .header[data-mark] svg: 44"]);
  });
});

describe("icon strokes", () => {
  const tags = sources.flatMap(path => [...readFileSync(path, "utf8").matchAll(/<[A-Z][A-Za-z]*\b[^<>]*\bstrokeWidth=\{([^}]+)\}[^<>]*>/g)].map(match => ({ path, tag: match[0], stroke: match[1].trim() })));

  it("are 2 by default; a set stroke is 3", () => {
    expect(tags.filter(({ stroke }) => stroke !== "3").map(({ path, stroke }) => `${path}: ${stroke}`)).toEqual([]);
  });

  it("are 3 only for a check at 16 px or under, or inside a drawn mark", () => {
    const heavy = tags.filter(({ tag }) => { const size = tag.match(/\bsize=\{(\d+)\}/); return !tag.startsWith("<Check") || !size || Number(size[1]) > 16; }).map(({ path }) => path);
    // Drawn: a stamp's check (sized by its grid) and the Kasse's 56 px „Gebucht“ illustration.
    expect(heavy.sort()).toEqual(["src/components/cashier/cashier-view.tsx", "src/components/ui/stamp-grid.tsx"]);
  });
});
