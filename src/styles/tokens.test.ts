import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, mix, parseHex } from "@/components/ui/color";

const css = readFileSync(path.join(__dirname, "tokens.css"), "utf8");

/** Reads the custom properties of the first rule whose selector line starts with `selector` (comments are ignored). */
function block(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{`).exec(css);
  if (!match) throw new Error(`No rule for ${selector}`);
  const open = match.index + match[0].length;
  const body = css.slice(open, css.indexOf("}", open));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const light = block(":root");
const dark = { ...light, ...block(".ly-theme-dark") };
const text = ["--color-ink", "--color-ink-muted", "--color-accent-text", "--color-success", "--color-danger", "--color-warning"];
const grounds = ["--color-bg", "--color-surface", "--color-raised"];
const ui = ["--color-line-strong", "--color-action", "--color-focus"];

/** CIE76 colour difference (ΔE*ab) of two #RRGGBB values, D65. */
function deltaE(a: string, b: string) {
  const lab = (hex: string) => {
    const [r, g, bl] = parseHex(hex).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const [x, y, z] = [(r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + bl * 0.0722, (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883].map(f);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

describe.each([["light", light], ["dark", dark]])("%s tokens", (_name, t) => {
  it.each(text.flatMap((fg) => grounds.map((bg) => [fg, bg])))("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it("marks on a coral stamp are at least 4.5:1", () => {
    expect(contrast(t["--color-on-stamp"], t["--color-stamp"])).toBeGreaterThanOrEqual(4.5);
  });
  it("text on the action colour is at least 4.5:1", () => {
    expect(contrast(t["--color-on-action"], t["--color-action"])).toBeGreaterThanOrEqual(4.5);
  });
  it("text on the danger colour is at least 4.5:1", () => {
    expect(contrast(t["--color-on-danger"], t["--color-danger"])).toBeGreaterThanOrEqual(4.5);
  });
  // Coral means an earned stamp; an error must never read as one (SF-15).
  it("danger is more than 20 ΔE*ab away from the stamp coral", () => {
    expect(deltaE(t["--color-danger"], t["--color-stamp"])).toBeGreaterThan(20);
  });
  it.each(grounds)("faint text on %s is at least 3:1 and quieter than muted text", (bg) => {
    expect(contrast(t["--color-ink-faint"], t[bg])).toBeGreaterThanOrEqual(3);
    expect(contrast(t["--color-ink-faint"], t[bg])).toBeLessThan(contrast(t["--color-ink-muted"], t[bg]));
  });
  it.each(ui)("%s on the surface is at least 3:1", (token) => {
    expect(contrast(t[token], t["--color-surface"])).toBeGreaterThanOrEqual(3);
  });
});

// Status chips and notices (Badge, owner dashboard) put the status colour as text on a fill of itself; the quiet fill
// (--color-fill) sits behind secondary text. The shares are read from the stylesheets themselves, so changing a recipe
// there is what these checks test. sRGB mixing here; the CSS mixes in oklab, within a few units.
const STATUS_FILL = /background:\s*color-mix\(in oklab, var\((--color-(?:success|warning|danger))\), transparent (\d+(?:\.\d+)?)%\)/g;
const statusFills = ["src/components/ui/badge.module.css", "src/components/owner/owner.css"].flatMap((file) =>
  [...readFileSync(path.join(process.cwd(), file), "utf8").matchAll(STATUS_FILL)].map((m) => ({ file, token: m[1], share: 1 - Number(m[2]) / 100 })));
const quietFill = /--color-fill:\s*color-mix\(in oklab, var\(--color-ink\), transparent (\d+(?:\.\d+)?)%\)/.exec(css);

describe("tinted fill recipes", () => {
  it("are found where the status chips and notices are drawn", () => {
    for (const file of ["src/components/ui/badge.module.css", "src/components/owner/owner.css"]) {
      expect(new Set(statusFills.filter((fill) => fill.file === file).map((fill) => fill.token))).toEqual(new Set(["--color-success", "--color-warning", "--color-danger"]));
    }
    expect(quietFill).not.toBeNull();
  });
});

describe.each([["light", light], ["dark", dark]])("%s tinted fills", (_name, t) => {
  it.each(statusFills.flatMap((fill) => grounds.map((ground) => ({ file: fill.file.split("/").pop()!, token: fill.token, percent: Math.round(fill.share * 100), ground }))))("$file: $token on its $percent percent fill over $ground is at least 4.5:1", ({ token, percent, ground }) => {
    expect(contrast(t[token], mix(t[ground], t[token], percent / 100))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(grounds)("muted text on the quiet fill over %s is at least 4.5:1", (bg) => {
    const share = 1 - Number(quietFill![1]) / 100;
    expect(contrast(t["--color-ink-muted"], mix(t[bg], t["--color-ink"], share))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("token file shape", () => {
  it("defines exactly three durations and three easings", () => {
    expect(Object.keys(light).filter((k) => k.startsWith("--dur-")).sort()).toEqual(["--dur-press", "--dur-reward", "--dur-ui"]);
    expect(Object.keys(light).filter((k) => k.startsWith("--ease-")).sort()).toEqual(["--ease-drawer", "--ease-in-out", "--ease-out"]);
  });
  it("applies the same dark values for the forced and the system-following theme", () => {
    expect(block(".ly-theme-auto")).toEqual(block(".ly-theme-dark"));
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*\.ly-theme-auto\s*{/);
  });
});
