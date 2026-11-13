import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DESIGN.md, Icons: four sizes, set by the text beside them (16 with 14 px text, 20 with 16 px text and controls,
// 22 in tiles, bands, the tab bar, the sidebar and row arrows, 24 in a state-screen tile). Strokes are 2, 2.5 only on
// the current tab or nav icon, and 3 only for a check at 16 px or under. Illustrations (48 px and up) are not icons.
const files = (root: string): string[] => readdirSync(root).flatMap(entry => {
  const path = join(root, entry);
  if (path === join("src", "app", "dev")) return [];
  return statSync(path).isDirectory() ? files(path) : [path];
});
const sources = files("src").filter(path => path.endsWith(".tsx") && !/\.test\.tsx$/.test(path));
const found = (pattern: RegExp) => sources.flatMap(path => [...readFileSync(path, "utf8").matchAll(pattern)].map(match => ({ path: path.split("\\").join("/"), value: Number(match[1]) })));

describe("icon sizes", () => {
  it("are 16, 20, 22 or 24; anything else is an illustration or the one drawn tick", () => {
    const odd = found(/\bsize=\{(\d+(?:\.\d+)?)\}/g).filter(({ value }) => ![16, 20, 22, 24].includes(value) && value < 48).map(({ path, value }) => `${path}: ${value}`);
    // The setup steps' tick sits inside its own 16 px dot: part of that drawing, not an icon beside text.
    expect(odd).toEqual(["src/components/owner/overview.tsx: 11"]);
  });

  it("are drawn with a stroke of 2, or 3 for a small check", () => {
    expect(found(/\bstrokeWidth=\{(\d+(?:\.\d+)?)\}/g).filter(({ value }) => value !== 2 && value !== 3).map(({ path, value }) => `${path}: ${value}`)).toEqual([]);
  });
});
