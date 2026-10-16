import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { contrast, mix, parseHex } from "./color";
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

// The points ladder (points-ladder.module.css), read from the stylesheet. Every declaration of a rule is checked
// against a list, values must have one of the shapes below, and colours are composited unrounded, so an override, an
// opacity or a see-through fill fails here instead of slipping past the contrast maths.
describe("points ladder on the card", () => {
  const css = readFileSync(join(__dirname, "points-ladder.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /** Declarations of every rule whose whole selector is `selector`, @media blocks included; nothing outside `allowed`. */
  const rule = (selector: string, allowed: string[]) => {
    const list = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, head]) => head.split(",").some((part) => part.trim() === selector))
      .flatMap(([, , body]) => body.split(";").map((item) => item.trim()).filter(Boolean).map((item) => [item.slice(0, item.indexOf(":")).trim(), item.slice(item.indexOf(":") + 1).trim()]));
    expect(list.map(([name]) => name).filter((name) => !allowed.includes(name)), selector).toEqual([]);
    return (name: string) => {
      const values = list.filter(([key]) => key === name).map(([, value]) => value);
      expect(values, `${selector} ${name}`).toHaveLength(1);
      return values[0];
    };
  };
  // Each card colour with the token it falls back to outside a card (the cashier); the browser check in
  // e2e/points-ladder.mobile.spec.ts covers what this cannot see: other selectors, opacity, geometry, the fallback.
  const OPAQUE = /^var\((--[\w-]+), var\((--[\w-]+)\)\)$/; // var(--merchant-ink, var(--color-ink))
  const TINT = /^color-mix\(in oklab, var\((--[\w-]+), var\((--[\w-]+)\)\)(?: (\d+)%)?, transparent(?: (\d+)%)?\)$/;
  const FALLBACK: Record<string, string> = { "--merchant-ink": "--color-ink", "--stamp-fill": "--color-stamp", "--stamp-ink": "--color-on-stamp" };
  const named = (palette: ReturnType<typeof merchantPalette>, name = "", fallback = "") => {
    const found = ({ "--merchant-ink": palette.merchantInk, "--stamp-fill": palette.stampFill, "--stamp-ink": palette.stampInk } as Record<string, string>)[name];
    if (!found || FALLBACK[name] !== fallback) throw new Error(`no palette colour for "${name}" falling back to "${fallback}"`);
    return found;
  };
  const colour = (palette: ReturnType<typeof merchantPalette>, value: string) => { const match = OPAQUE.exec(value); return named(palette, match?.[1], match?.[2]); };
  // WCAG luminance of a colour laid over another in sRGB, without rounding to #RRGGBB.
  const rgb = (hex: string) => parseHex(hex).map((v) => v / 255);
  const lum = (c: number[]) => { const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const over = (ground: number[], top: number[], share: number) => ground.map((v, i) => v + (top[i] - v) * share);

  let track = "", fill = "", tint: RegExpExecArray | null = null, share = NaN;
  beforeAll(() => {
    track = rule(".track", ["position", "left", "right", "top", "height", "overflow", "border-radius", "background"])("background");
    fill = rule(".fill", ["position", "inset", "transform-origin", "background", "transition"])("background");
    tint = TINT.exec(track);
    share = !tint ? NaN : (tint[3] ? Number(tint[3]) : tint[4] ? 100 - Number(tint[4]) : 50) / 100;
  });
  // 4096 colours on a 0x11 grid, the samples, and the worst colour of all 16.7 million (#757778, 3.009:1 at review).
  const steps = Array.from({ length: 16 }, (_, i) => (i * 17).toString(16).padStart(2, "0"));
  const colours = [...steps.flatMap((r) => steps.flatMap((g) => steps.map((b) => `#${r}${g}${b}`))), ...samples, "#757778"];

  it("has no rules beyond the ones checked here and in e2e/points-ladder.mobile.spec.ts", () => {
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(([, head]) => head.replace(/^[\s\S]*\{/, "").split(",").map((part) => part.trim()));
    expect(selectors).toEqual([".ladder", ".track", ".fill", ".mark", ".dot", ".mark[data-reached] .dot", ".cost", ".mark[data-label-hidden] .cost", ".fill"]);
  });

  it("reads a supported track and fill", () => {
    expect(track).toMatch(TINT);
    expect(fill).toMatch(OPAQUE);
    expect(share).toBeGreaterThan(0);
  });

  it.each(["light", "dark"] as const)("keeps 3:1 between filled and empty on every colour (%s)", (theme) => {
    const failures = colours.flatMap((hex) => {
      const palette = merchantPalette(hex, theme), filled = rgb(colour(palette, fill)), empty = rgb(named(palette, tint?.[1], tint?.[2]));
      return [palette.merchant, palette.merchantDeep].map((ground) => [hex, ratio(filled, over(rgb(ground), empty, share))] as const).filter(([, value]) => value < 3);
    });
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it.each(samples.flatMap((hex) => (["light", "dark"] as const).map((theme) => [hex, theme] as const)))("%s (%s) keeps reached markers readable", (hex, theme) => {
    const palette = merchantPalette(hex, theme), reached = rule(".mark[data-reached] .dot", ["border", "background", "color", "border-radius"]);
    const dot = colour(palette, reached("background")), check = colour(palette, reached("color"));
    expect(contrast(check, dot)).toBeGreaterThanOrEqual(4.5);
    for (const ground of [palette.merchant, palette.merchantDeep]) expect(contrast(dot, ground)).toBeGreaterThanOrEqual(2);
  });
});
