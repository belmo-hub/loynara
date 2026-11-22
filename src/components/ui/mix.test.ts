import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { contrast, mix } from "./color";
import { MixChip, MixPanel, MixRow, MixSection, mixButton } from "./mix";

const css = readFileSync(join(__dirname, "mix.module.css"), "utf8");
const tokens = readFileSync(join(__dirname, "../../styles/tokens.css"), "utf8");
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("mix tokens and patterns (ENG-254)", () => {
  it("adds only the row heights and the tile; everything else reuses the house tokens", () => {
    expect([...tokens.matchAll(/(--mix-[\w-]+):\s*([^;]+);/g)].map(m => `${m[1]} ${m[2]}`)).toEqual(["--mix-row 52px", "--mix-row-2 64px", "--mix-row-card 72px", "--mix-tile 40px"]);
    expect(css).toContain(".panel { min-width: 0; overflow: hidden; background: var(--color-surface); border: 1px solid var(--color-line); border-radius: var(--radius-lg); }");
    expect(css).not.toMatch(/box-shadow/);
    expect(css).toMatch(/\.stack, \.sec \{[^}]*gap: var\(--space-4\)/);
    expect(css).toContain("margin-top: calc(var(--space-8) - var(--space-4))");
    expect(css).toContain("margin-bottom: calc(var(--space-3) - var(--space-4))");
    expect(css).toMatch(/\.tile \{[^}]*width: var\(--mix-tile\); height: var\(--mix-tile\); border-radius: var\(--radius-md\)/);
  });

  it("marks the lead so a tile row is 64 and a card row 72", () => {
    expect(html(h(MixRow, { title: "Neuigkeit", end: "Keine" }))).not.toContain("data-lead");
    expect(html(h(MixRow, { title: "Tresenschild laden", icon: "i" }))).toContain('data-lead="tile"');
    expect(html(h(MixRow, { title: "K-4RT9QE", thumb: h("span") }))).toContain('data-lead="card"');
    expect(css).toContain('.row[data-lead="card"] > .body { min-height: var(--mix-row-card); }');
  });

  it("draws a hairline only between two rows, never a transparent one that forced colours would show on the first row", () => {
    // File-wide ban; only the chip's transparent edge is on purpose (ENG-262: forced colours draw it as the chip's shape).
    expect(css.replace(/\.chip \{[^}]*\}/, "")).not.toMatch(/border(-top)?: 1px solid transparent/);
    expect(css).toMatch(/\.body \{[^}]*padding: var\(--space-2\) calc\(var\(--space-5\) - 1px\) var\(--space-2\) 0; \}/);
    expect(css).toContain(".row + .row > .body { padding-top: 7px; border-top: 1px solid var(--color-line); }");
  });

  it("keeps a chip's shape and the chevron's colour in forced colours, with the chip at its normal size (ENG-262)", () => {
    expect(css).toMatch(/\.chip \{[^}]*height: 24px; padding: 0 calc\(var\(--space-2\) - 1px\); border: 1px solid transparent;/);
    expect(css).toContain("@media (forced-colors: active) { .chev { color: currentColor; } }");
    expect(css).toContain(".h > svg { color: var(--color-action); }");
    expect(css).toContain("@media (forced-colors: active) { .h > svg { color: currentColor; } }");
  });

  it("links a row with its chevron, and shows a plain value muted", () => {
    const linked = html(h(MixRow, { title: "Programmregeln", href: "/x" }));
    expect(linked).toMatch(/^<a [^>]*href="\/x"/);
    expect(linked).toContain("<svg");
    expect(html(h(MixRow, { title: "Neuigkeit", end: "Keine" }))).not.toContain("<svg");
  });

  it("puts a section's chip at its title's end and its note under the panels", () => {
    const out = html(h(MixSection, { title: "Aussehen", aside: h(MixChip, { children: "Beispiel" }), note: "Hinweis", children: h(MixPanel, { children: "p" }) }));
    expect(out).toMatch(/<h2[^>]*>Aussehen<\/h2><span[^>]*>Beispiel<\/span><\/div><div[^>]*>p<\/div><p[^>]*>Hinweis<\/p>/);
  });

  it("builds button classes from the variant and size", () => {
    expect(mixButton().split(" ")).toHaveLength(2);
    expect(mixButton({ variant: "quiet", lg: true, block: true }).split(" ")).toHaveLength(4);
  });

  it("keeps a mix title's 26 px line and a kicker's weight and colour inside the owner app, whose heading rule would win", () => {
    const owner = readFileSync(join(__dirname, "../owner/owner.css"), "utf8");
    expect(owner).toContain(".owner-app :is(h1, h2, h3) { font-family: inherit; font-weight: var(--weight-heavy); letter-spacing: 0; line-height: 1.2;");
    expect(css).toContain(":global(.owner-app) .h { line-height: 26px; }");
    expect(css).toContain(":global(.owner-app) .kicker { font-weight: var(--weight-strong); color: var(--color-ink-muted); }");
  });

  it("draws the focus ring inside a row, so the panel's overflow cannot clip it", () => {
    expect(css).toContain(".row.row.row:focus-visible, .more.more.more:focus-visible { outline: 2px solid var(--color-focus); outline-offset: -3px; border-radius: var(--radius-lg); }");
    // It must outrank the owner app's own ring (one class, :is() with an attribute, :focus-visible = 0,3,0).
    const owner = readFileSync(join(__dirname, "../owner/owner.css"), "utf8");
    expect(owner).toContain(".owner-app :is(a, button, input, select, textarea, summary, [tabindex]):focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }");
    const classes = (selector: string) => (selector.match(/\.[\w-]+|:focus-visible|\[[^\]]+\]/g) ?? []).length;
    expect(classes(".row.row.row:focus-visible")).toBeGreaterThan(classes(".owner-app [tabindex]:focus-visible"));
    expect(css).toMatch(/\.panel \{[^}]*overflow: hidden/);
  });

  it("presses buttons to .97 and rows to .985, with hover fills for a fine pointer and none of it under reduced motion", () => {
    expect(css).toContain(".btn:active { transform: scale(.97); }");
    expect(css).toContain("a.row:active, button.row:active, .more:active { transform: scale(.985); }");
    expect(css).toContain("transition: transform var(--dur-press) var(--ease-out), background-color var(--dur-press) var(--ease-out);");
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{\s*a\.row:hover/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.row, \.more, \.btn \{ transition: none; \}\s*\.btn:active, a\.row:active, button\.row:active, \.more:active \{ transform: none; \}/);
  });

  it("keeps the primary button's edge in forced colours, a reading measure for notes and the mock's text wrapping", () => {
    expect(css).toContain("@media (forced-colors: active) { .primary { border: 1px solid ButtonText; } }");
    expect(css).toContain("@media (min-width: 600px) { .note { max-width: 640px; } }");
    expect(css).toMatch(/\.h \{[^}]*text-wrap: balance;/);
    for (const role of [".note", ".sub", ".text > small"]) expect(css).toMatch(new RegExp(`${role.replace(/[.>]/g, m => `\\${m}`)} \\{[^}]*text-wrap: pretty;`));
    expect(css).toContain(':global(.ly-theme-dark) .tile[data-tone="mute"] { background: var(--color-raised); }');
  });

  it("keeps the warm chip's text at 4.5:1 on its tint over white", () => {
    expect(css).toContain(".warm { background: color-mix(in oklab, var(--color-accent-text), transparent 90%); color: var(--color-accent-text); }");
    expect(contrast("#9E4B2D", mix("#FFFFFF", "#9E4B2D", 0.1))).toBeGreaterThanOrEqual(4.5);
  });
});
