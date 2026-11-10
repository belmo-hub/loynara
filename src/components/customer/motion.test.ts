import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StampGrid } from "@/components/ui/stamp-grid";
import { CustomerCard } from "./customer-card";
import { CustomerState } from "./customer-state";
import { Reveal } from "./reveal";

describe("guest page motion", () => {
  it("opens a block in place with its grid's gap, and renders nothing while closed", () => {
    const open = renderToStaticMarkup(h(Reveal, { open: true, gap: "var(--space-4)" }, h("p", null, "Hinweis")));
    expect(open).toMatch(/data-open="true" style="--reveal-gap:var\(--space-4\)"><div><p>Hinweis<\/p><\/div><\/div>$/);
    expect(renderToStaticMarkup(h(Reveal, { open: false }, h("p", null, "Hinweis")))).toBe("");
  });

  it("draws the stamp slots in only where asked (the join page's preview)", () => {
    const drawn = renderToStaticMarkup(h(StampGrid, { earned: 0, total: 8, draw: true }));
    expect(drawn).toContain('data-draw="true"');
    expect(drawn.match(/--i:\d/g)).toHaveLength(8);
    const still = renderToStaticMarkup(h(StampGrid, { earned: 3, total: 8 }));
    expect(still).not.toContain("data-draw");
    expect(still).not.toContain("--i:");
  });

  it("sends a state's first words as plain text and marks a state that is still asking", () => {
    const out = renderToStaticMarkup(h(CustomerState, { title: "Warte auf das Team", message: "x", loading: true }));
    expect(out).toMatch(/<h1[^>]*>Warte auf das Team<\/h1>/);
    expect(out).toContain('data-loading="true"');
    expect(renderToStaticMarkup(h(CustomerState, { title: "Abgemeldet" }))).not.toContain("data-loading");
  });

  it("lays the placeholder over the card's first paint, where it is never a target for assistive technology", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { businessName: "Café", locationName: "Kassel", programType: "stamps", balance: 2, rewards: [{ id: "r", title: "Kaffee", cost: 8 }] }));
    expect(out.match(/data-arriving="true"/g)).toHaveLength(2);
    expect(out).toMatch(/<div class="[^"]*" aria-hidden="true"><div class="[^"]*"><div class="[^"]*"><span aria-hidden="true"/);
  });

  // Design's hard limits, read from the stylesheets: a file that moves something says what reduced motion gets, and
  // nothing on a guest page loops.
  it("gives every guest stylesheet that animates a reduced-motion rule, and none a loop", () => {
    const here = __dirname, ui = join(here, "../ui");
    const files = [...readdirSync(here).filter(name => name.endsWith(".css")).map(name => join(here, name)), ...["customer-shell", "stamp-grid", "points-ladder", "sheet", "number-roll"].map(name => join(ui, `${name}.module.css`))];
    const moving = files.map(path => ({ path, css: readFileSync(path, "utf8") })).filter(({ css }) => /\b(animation|transition):/.test(css));
    expect(moving.length).toBeGreaterThan(8);
    expect(moving.filter(({ css }) => !css.includes("prefers-reduced-motion")).map(({ path }) => path)).toEqual([]);
    expect(moving.filter(({ css }) => /\binfinite\b/.test(css)).map(({ path }) => path)).toEqual([]);
  });
});
