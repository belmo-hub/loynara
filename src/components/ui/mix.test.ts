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

  it("keeps the warm chip's text at 4.5:1 on its tint over white", () => {
    expect(css).toContain(".warm { background: color-mix(in oklab, var(--color-accent-text), transparent 90%); color: var(--color-accent-text); }");
    expect(contrast("#9E4B2D", mix("#FFFFFF", "#9E4B2D", 0.1))).toBeGreaterThanOrEqual(4.5);
  });
});
