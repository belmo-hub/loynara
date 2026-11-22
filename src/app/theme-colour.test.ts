import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Design 36c (12 Nov): the browser and home-screen colours are the tokens, so they cannot drift from them.
const read = (file: string) => readFileSync(file, "utf8");
const tokens = read("src/styles/tokens.css");
const token = (selector: string, name: string) => {
  const body = tokens.slice(tokens.indexOf(`${selector} {`));
  return new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(body)![1].toUpperCase();
};
const hexes = (text: string) => [...text.matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map(match => match[1].toUpperCase());
const lightBg = token(":root", "--color-bg"), darkBg = token(".ly-theme-dark", "--color-bg");
const lightRaised = token(":root", "--color-raised"), darkRaised = token(".ly-theme-dark", "--color-raised");

describe("theme colours", () => {
  it("paints the always-dark Kasse dark from the splash on", () => {
    const layout = read("src/app/cashier/layout.tsx"), manifest = JSON.parse(read("public/cashier.webmanifest"));
    expect(hexes(layout)).toEqual([darkBg]);
    expect(layout).toContain('statusBarStyle: "black"');
    expect([manifest.theme_color, manifest.background_color].map((hex: string) => hex.toUpperCase())).toEqual([darkBg, darkBg]);
    expect(manifest.id).toBe("/cashier");
  });
  it("gives customer and sign-in pages the page ground, owner pages the top bar", () => {
    expect(hexes(read("src/app/layout.tsx"))).toEqual([lightBg, darkBg]);
    expect(hexes(read("src/app/merchant/layout.tsx"))).toEqual([lightRaised, darkRaised]);
  });
});
