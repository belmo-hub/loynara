import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PointsLadder } from "@/components/ui/points-ladder";
import { StampGrid } from "@/components/ui/stamp-grid";
import { CardFace } from "./card-face";
import { CustomerCard } from "./customer-card";
import { CustomerState } from "./customer-state";
import { Reveal } from "./reveal";

describe("guest page motion", () => {
  it("opens a block in place with its grid's gap, still when it is open from the start, and renders nothing while closed", () => {
    const open = renderToStaticMarkup(h(Reveal, { open: true, gap: "var(--space-4)", children: h("p", null, "Hinweis") }));
    expect(open).toMatch(/data-open="true" data-still="true" style="--reveal-gap:var\(--space-4\)"><div><div><p>Hinweis<\/p><\/div><\/div><\/div>$/);
    expect(renderToStaticMarkup(h(Reveal, { open: false, children: h("p", null, "Hinweis") }))).toBe("");
  });

  // Design, 10 Nov: Bars grow belongs to the guest card page's first paint without a booking moment. The tap page, the
  // Kasse and the owner's previews show the fill at its value; the preview card on the join page arrives as one block.
  const rewards = [{ id: "a", title: "Cappuccino", cost: 80 }, { id: "b", title: "Frühstück", cost: 150 }];
  const card = { businessName: "Café", locationName: "Kassel", programType: "points" as const, balance: 120, rewards };
  it("grows the ladder fill only on the card page's first paint, and not against a booking moment", () => {
    expect(renderToStaticMarkup(h(CustomerCard, card))).toContain('data-grow="true"');
    expect(renderToStaticMarkup(h(CustomerCard, { ...card, moment: { credited: 20, balance: 120 } }))).not.toContain("data-grow");
    expect(renderToStaticMarkup(h(CardFace, card))).not.toContain("data-grow");
    expect(renderToStaticMarkup(h(PointsLadder, { balance: 120, rewards }))).not.toContain("data-grow");
    expect(renderToStaticMarkup(h(StampGrid, { earned: 12, total: 40 }))).not.toContain("data-grow");
    expect(renderToStaticMarkup(h(StampGrid, { earned: 12, total: 40, grow: true }))).toContain('data-grow="true"');
    const ladder = readFileSync(join(__dirname, "../ui/points-ladder.module.css"), "utf8");
    expect(ladder).toContain(".ladder[data-grow] .fill { animation: grow");
    expect(ladder).not.toMatch(/^\.fill \{[^}]*animation/m);
  });

  it("no longer draws the join preview's slots in one by one", () => {
    const grid = renderToStaticMarkup(h(StampGrid, { earned: 0, total: 8 }));
    expect(grid).not.toContain("data-draw");
    expect(grid).not.toContain("--i:");
    for (const file of ["stamp-grid", "points-ladder"]) expect(readFileSync(join(__dirname, `../ui/${file}.module.css`), "utf8")).not.toContain("draw");
  });

  it("leaves the first paint's activity rows still under the placeholder", () => {
    const activity = [1, 2, 3, 4].map(n => ({ id: `e${n}`, label: "Gesammelt", date: "Heute", change: 1 }));
    const out = renderToStaticMarkup(h(CustomerCard, { ...card, activity }));
    expect(out.split("Gesammelt").length - 1).toBe(3);
    expect(out).not.toContain("data-arrives");
  });

  it("takes the old words out of the layout at once, and closes a sheet faster than it opens", () => {
    const state = readFileSync(join(__dirname, "customer-state.module.css"), "utf8");
    expect(state).toContain(".swap { display: grid; position: relative; }");
    expect(state).toMatch(/\.out \{ position: absolute; inset: 0 0 auto 0;/);
    const sheet = readFileSync(join(__dirname, "../ui/sheet.module.css"), "utf8");
    expect(sheet).toContain("transition-duration: 160ms; transition-timing-function: var(--ease-out);");
    expect(sheet).toContain(".sheet::backdrop { background: rgba(15, 23, 19, .48); opacity: 0; transition: opacity 160ms var(--ease-out); }");
  });

  it("sends a state's first words as plain text and marks a state that is still asking", () => {
    const out = renderToStaticMarkup(h(CustomerState, { title: "Warte auf das Team", message: "x", loading: true }));
    expect(out).toMatch(/<h1[^>]*>Warte auf das Team<\/h1>/);
    expect(out).toContain('data-loading="true"');
    expect(renderToStaticMarkup(h(CustomerState, { title: "Abgemeldet" }))).not.toContain("data-loading");
  });

  it("lays the placeholder over the card's first paint, where it is never a target for assistive technology", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { businessName: "Café", locationName: "Kassel", programType: "stamps", balance: 2, rewards: [{ id: "r", title: "Kaffee", cost: 8 }] }));
    expect(out.match(/data-arriving="true"/g)).toHaveLength(1);
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
