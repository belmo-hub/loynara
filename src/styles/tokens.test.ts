import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, mix } from "@/components/ui/color";

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
  it.each(ui)("%s on the surface is at least 3:1", (token) => {
    expect(contrast(t[token], t["--color-surface"])).toBeGreaterThanOrEqual(3);
  });
});

// Status chips and notices (Badge, owner dashboard): the status colour as text on a 10 % fill of itself; the quiet fill
// (--color-fill, 7 % ink) behind secondary text. sRGB mixing here; the CSS mixes in oklab, within a few units.
describe.each([["light", light], ["dark", dark]])("%s tinted fills", (_name, t) => {
  it.each(["--color-success", "--color-warning", "--color-danger"].flatMap((fg) => grounds.map((bg) => [fg, bg])))("%s on its fill over %s is at least 4.5:1", (fg, bg) => {
    expect(contrast(t[fg], mix(t[bg], t[fg], 0.1))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(grounds)("muted text on the quiet fill over %s is at least 4.5:1", (bg) => {
    expect(contrast(t["--color-ink-muted"], mix(t[bg], t["--color-ink"], 0.07))).toBeGreaterThanOrEqual(4.5);
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
