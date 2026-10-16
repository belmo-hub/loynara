import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, mix } from "./color";
import { merchantPalette } from "./merchant-color";

const SURFACE = { light: "#FCFBF7", dark: "#16201B" };
const samples = ["#2F6B58", "#245D47", "#FFFFFF", "#000000", "#E9C46A", "#FF0000", "#7A3E9D", "#3B82F6", "#F4DDD0", "#808080"];

describe("merchantPalette", () => {
  it.each(samples)("keeps text on the card object readable for %s", (hex) => {
    const p = merchantPalette(hex, "light");
    expect(contrast(p.merchantInk, p.merchant)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.merchantInk, p.merchantDeep)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(samples.flatMap((hex) => (["light", "dark"] as const).map((theme) => [hex, theme] as const)))("gives %s a text colour that passes on the %s surface", (hex, theme) => {
    expect(contrast(merchantPalette(hex, theme).merchantText, SURFACE[theme])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(samples)("keeps earned stamps distinguishable from the card for %s", (hex) => {
    const p = merchantPalette(hex, "light");
    expect(contrast(p.stampFill, p.merchant)).toBeGreaterThanOrEqual(2);
    expect(contrast(p.stampInk, p.stampFill)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the coral pressed stamp on the usual shop greens", () => {
    expect(merchantPalette("#2F6B58", "light").stampFill).toBe("#E9895F");
    expect(merchantPalette("#245D47", "light").stampFill).toBe("#E9895F");
  });

  it("leaves a colour that already passes untouched", () => {
    expect(merchantPalette("#245D47", "light").merchant).toBe("#245D47");
  });

  it("falls back to the brand green for anything that is not #RRGGBB", () => {
    expect(merchantPalette("red", "light").merchant).toBe("#245D47");
    expect(merchantPalette("", "light").merchant).toBe("#245D47");
  });

  it("exposes the values as CSS custom properties", () => {
    expect(Object.keys(merchantPalette("#2F6B58", "light").cssVars).sort()).toEqual(["--merchant", "--merchant-deep", "--merchant-ink", "--merchant-text", "--stamp-fill", "--stamp-ink"]);
  });
});

// The long-programme track (stamp-grid.module.css): ink fill against 22 % ink over the card, at both gradient ends.
describe("stamp track on the card", () => {
  it.each(samples.flatMap((hex) => (["light", "dark"] as const).map((theme) => [hex, theme] as const)))("%s (%s) keeps 3:1 between filled and empty", (hex, theme) => {
    const palette = merchantPalette(hex, theme);
    for (const ground of [palette.merchant, palette.merchantDeep]) {
      expect(contrast(palette.merchantInk, mix(ground, palette.merchantInk, 0.22))).toBeGreaterThanOrEqual(3);
    }
  });
});

// The points ladder (points-ladder.module.css), read from the stylesheet: the filled part against the empty part over
// the card at both gradient ends, and the reached-reward marker against the card and its check mark.
describe("points ladder on the card", () => {
  const css = readFileSync(join(__dirname, "points-ladder.module.css"), "utf8");
  const rule = (selector: string) => new RegExp(`^${selector.replace(/[.[\]]/g, "\\$&")} \\{([^}]*)\\}`, "m").exec(css)?.[1] ?? "";
  const role = (declaration: string) => /var\((--[\w-]+)/.exec(declaration)?.[1];
  const pick = (palette: ReturnType<typeof merchantPalette>, property?: string) => {
    const colour = ({ "--merchant-ink": palette.merchantInk, "--stamp-fill": palette.stampFill, "--stamp-ink": palette.stampInk } as Record<string, string>)[property ?? ""];
    if (!colour) throw new Error(`no palette colour for ${property}`);
    return colour;
  };
  const background = (selector: string) => /background: ([^;]+);/.exec(rule(selector))?.[1] ?? "";
  // color-mix(in oklab, var(--x, …) N%, transparent) or color-mix(in oklab, var(--x, …), transparent M%)
  const tint = /color-mix\(in oklab, var\((--[\w-]+)[^%]*?(?:(\d+)%)?, transparent(?: (\d+)%)?\)/.exec(background(".track"));
  const share = tint ? (tint[2] ? Number(tint[2]) : 100 - Number(tint[3] ?? 0)) / 100 : NaN;

  it.each(samples.flatMap((hex) => (["light", "dark"] as const).map((theme) => [hex, theme] as const)))("%s (%s) keeps 3:1 between filled and empty", (hex, theme) => {
    const palette = merchantPalette(hex, theme), filled = pick(palette, role(background(".fill"))), empty = pick(palette, tint?.[1]);
    for (const ground of [palette.merchant, palette.merchantDeep]) expect(contrast(filled, mix(ground, empty, share))).toBeGreaterThanOrEqual(3);
  });

  it.each(samples.flatMap((hex) => (["light", "dark"] as const).map((theme) => [hex, theme] as const)))("%s (%s) keeps reached markers readable", (hex, theme) => {
    const palette = merchantPalette(hex, theme), reached = rule(".mark[data-reached] .dot");
    const dot = pick(palette, role(/background: ([^;]+);/.exec(reached)?.[1] ?? "")), check = pick(palette, role(/color: ([^;]+);/.exec(reached)?.[1] ?? ""));
    expect(contrast(check, dot)).toBeGreaterThanOrEqual(4.5);
    for (const ground of [palette.merchant, palette.merchantDeep]) expect(contrast(dot, ground)).toBeGreaterThanOrEqual(2);
  });
});
