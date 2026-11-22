import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cssDeclarations } from "@/styles/raw-values";

// ENG-137 (SF-4, SF-5): D-020 pins headings to Manrope 800, and the owner screens carry no eyebrow or kicker. A later
// `.owner-app h1 { font-weight: 700 }` once won over the page title's 800 at equal specificity; these keep that from
// coming back. The rendered weights are measured in the PR's capture (getComputedStyle on every page's h1/h2/h3).

const files = (root: string): string[] => readdirSync(root).flatMap(entry => {
  const path = join(root, entry);
  if (path === join("src", "app", "dev")) return [];
  return statSync(path).isDirectory() ? files(path) : [path];
});
const ownerCss = readFileSync(join(__dirname, "owner.css"), "utf8");
const HEADING = /(?:^|[\s>+~(,])h[1-3](?![\w-])/;

describe("owner heading weight", () => {
  const rules = cssDeclarations(ownerCss);

  it("sets h1, h2 and h3 to the heavy weight under .owner-app", () => {
    const base = rules.filter(rule => rule.selector === ".owner-app :is(h1, h2, h3)");
    expect(base.find(rule => rule.property === "font-weight")?.value).toBe("var(--weight-heavy)");
  });

  it("has no rule that gives a heading another weight, in owner.css or any stylesheet", () => {
    // The Kasse's reward list moves with its area ticket (H, ENG-149), where its states are captured.
    const sheets = files("src").filter(path => path.endsWith(".css") && !path.endsWith(join("cashier", "cashier-view.module.css")));
    const lowered = sheets.flatMap(path => cssDeclarations(readFileSync(path, "utf8"))
      .filter(rule => HEADING.test(rule.selector) && (rule.property === "font-weight" || (rule.property === "font" && !rule.value.startsWith("var(--weight-heavy)"))) && rule.value !== "var(--weight-heavy)")
      .map(rule => `${path} | ${rule.selector} | ${rule.property}: ${rule.value}`));
    expect(lowered).toEqual([]);
  });

  // DESIGN.md, Tracking: nothing under 22 px is tightened. A rule that tightens must set a display size itself, or be
  // one of the drawings that keep their own shape.
  // Also exempt, and out of this check's sight (it reads stylesheets): the printed counter sign, a standalone
  // document in src/lib/counter-sign.ts. Print kit v2 redraws it in Manrope (set D6).
  it("tightens tracking only on display sizes, in owner.css or any stylesheet", () => {
    const DISPLAY = /var\(--(?:text-(?:22|28)|display-[\w-]+)\)/;
    const OWN_SHAPE = /^\.ow-pass|^\.word$|^\.stepper output$/; // Apple's and Google's passes, the brand word mark, the Kasse's 96 px amount
    const sheets = files("src").filter(path => path.endsWith(".css"));
    const tight = sheets.flatMap(path => {
      const all = cssDeclarations(readFileSync(path, "utf8"));
      return all.filter(rule => rule.property === "letter-spacing" && rule.value.startsWith("-") && !OWN_SHAPE.test(rule.selector)
        && !all.some(other => other.selector === rule.selector && (other.property === "font-size" || other.property === "font") && DISPLAY.test(other.value)))
        .map(rule => `${path} | ${rule.selector} | ${rule.value}`);
    });
    expect(tight).toEqual([]);
    expect(rules.find(rule => rule.selector === ".owner-app :is(h1, h2, h3)" && rule.property === "letter-spacing")?.value).toBe("0");
  });

  it("gives every section head one style: 14/800 muted with no tracking", () => {
    const heads = rules.filter(rule => rule.selector.includes(".owner-app .ow-section-head,"));
    const style = Object.fromEntries(heads.map(rule => [rule.property, rule.value]));
    expect(style).toMatchObject({ "font-size": "var(--text-14)", "font-weight": "var(--weight-heavy)", "letter-spacing": "0", color: "var(--color-ink-muted)" });
    for (const head of [".ow-prog h2:where(:not(dialog *))", ".owner-app .ow-tiles-title", ".ow-diary h2", ".ow-group > legend", ".ow-qlegend", ".ow-q .ow-qsub", ".ow-q .ow-qlabel", ".ow-cardline-label"]) {
      expect(heads[0].selector.split(",").map(part => part.trim())).toContain(head);
    }
  });
});

describe("no eyebrows or kickers", () => {
  const sources = files("src").filter(path => /\.(tsx?|css)$/.test(path) && !path.endsWith("owner-type.test.ts"));

  it("has no ow-eyebrow class, PageHead eyebrow prop or Board kicker anywhere", () => {
    const found = sources.flatMap(path => readFileSync(path, "utf8").split("\n")
      .map((line, index) => /ow-eyebrow|\beyebrow=|<Board kicker=/.test(line) ? `${path}:${index + 1}` : null).filter(Boolean));
    expect(found).toEqual([]);
  });

  it("has no uppercase tracked label in owner.css", () => {
    const tracked = cssDeclarations(ownerCss).filter(rule => rule.property === "text-transform" && rule.value === "uppercase");
    expect(tracked.map(rule => rule.selector)).toEqual([]);
  });
});
