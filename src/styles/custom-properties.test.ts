import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A var(--name) without a definition does not fail loudly: the browser drops the whole declaration, so a background or
// border silently disappears. That happened when the dashboard's --ow-* aliases were removed while inline styles still
// used them. Every custom property read without a fallback must be defined somewhere: a stylesheet, an inline style
// object, next/font's `variable`, or the merchant palette.

function files(root: string): string[] {
  return readdirSync(root).flatMap(entry => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(css|tsx?)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("custom properties", () => {
  it("every var(--name) without a fallback has a definition", () => {
    const sources = files("src").map(path => ({ path, text: readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));
    const defined = new Set<string>();
    for (const { text } of sources) {
      for (const match of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(match[1]); // CSS declarations
      for (const match of text.matchAll(/["'](--[\w-]+)["']\s*:/g)) defined.add(match[1]); // inline style objects
      for (const match of text.matchAll(/variable:\s*["'](--[\w-]+)["']/g)) defined.add(match[1]); // next/font
    }
    const missing = sources.flatMap(({ path, text }) => [...text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)]
      .filter(match => !defined.has(match[1]))
      .map(match => `${path}: ${match[1]}`));
    expect([...new Set(missing)]).toEqual([]);
  });
});
