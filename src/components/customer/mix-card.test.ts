import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MixCard, mixColumns, thumbColumns } from "./mix-card";

const coffee = { id: "r1", title: "Gratiskaffee", cost: 8 };
const card = (props: Partial<Parameters<typeof MixCard>[0]> = {}) => renderToStaticMarkup(h(MixCard, { businessName: "Demo Kaffeebar Kassel", locationName: "Kassel Mitte", programType: "stamps", balance: 5, reward: coffee, ...props }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const earned = (html: string) => (html.match(/<span[^>]*data-on="true"/g) ?? []).length;
const dots = (html: string) => [(html.match(/<i data-on="true"/g) ?? []).length, (html.match(/<i/g) ?? []).length];

describe("the mix card (ENG-253)", () => {
  it("earns as many stamps as the balance, the grid clamped to 0 … goal, at every size", () => {
    for (let n = 0; n <= 8; n++) {
      expect(earned(card({ balance: n }))).toBe(n);
      expect(earned(card({ balance: n, size: "kasse" }))).toBe(n);
      expect(dots(card({ balance: n, size: "thumb" }))).toEqual([n, 8]);
      expect(card({ balance: n })).toContain(`aria-label="${n} von 8 Stempeln"`);
    }
    expect(earned(card({ balance: -2 }))).toBe(0);
    expect(earned(card({ balance: 11 }))).toBe(8);
  });

  // Design, 18 Nov: above the goal the figure never clamps; the true count stands with its unit in place of „von 8“.
  it("above the goal shows the true count with its unit, in every voice, and says it to a screen reader", () => {
    const guest = card({ balance: 9 }), owner = card({ balance: 9, voice: "owner" }), kasse = card({ balance: 9, size: "kasse", label: "Aktueller Kontostand" });
    for (const html of [guest, owner]) {
      expect(text(html)).toMatch(/\b9 Stempel\b/);
      expect(text(html)).not.toContain("von 8");
      expect(html).toContain('aria-label="9 Stempel"');
      expect(earned(html)).toBe(8);
    }
    expect(kasse).toMatch(/<b data-figure="">.*9.*<small>\u00a0Stempel<\/small><\/b>/);
    expect(text(kasse)).not.toContain("von 8");
    expect(guest).toContain("Deine Prämie ist bereit:");
    expect(owner).toContain("Stand reicht für „Gratiskaffee“.");
    // At the goal it still reads „8 von 8“.
    expect(text(card({ balance: 8 }))).toContain("8 von 8");
  });

  // ENG-273, Design 18 Nov: the figure never clamps; above the goal the true count stands with its unit in place of „von 8“.
  it("reads „N von G“ up to the goal and the true count above it, in guest and owner voice and to a screen reader", () => {
    for (const voice of ["guest", "owner"] as const) {
      expect(text(card({ balance: 5, voice }))).toMatch(/\b5 von 8\b/);
      expect(text(card({ balance: 8, voice }))).toMatch(/\b8 von 8\b/);
      const over = card({ balance: 9, voice });
      expect(text(over)).toMatch(/\b9 Stempel\b/);
      expect(text(over)).not.toContain("von 8");
      expect(over).toContain('aria-label="9 Stempel"');
      expect(earned(over)).toBe(8);
    }
    expect(card({ balance: 9, size: "thumb" })).toContain('aria-label="9 Stempel"');
    expect(text(card({ balance: 9, size: "kasse", label: "Aktueller Kontostand" }))).toContain("9 Stempel Aktueller Kontostand");
    expect(card({ balance: 35, reward: { ...coffee, cost: 31 } })).toContain('aria-label="35 Stempel"'); // the track above 30
    expect(text(card({ programType: "points", balance: 186, reward: { ...coffee, cost: 120 } }))).toContain("186 Punkte");
  });

  it("lays 8 and 12 stamps in fours and 10 in fives", () => {
    expect([8, 10, 12].map(mixColumns)).toEqual([4, 5, 4]);
    expect(card({ reward: { ...coffee, cost: 10 } })).toContain("--cols:5");
    expect(earned(card({ balance: 12, reward: { ...coffee, cost: 12 } }))).toBe(12);
    expect(dots(card({ size: "thumb", balance: 9, reward: { ...coffee, cost: 12 } }))).toEqual([9, 12]);
    expect(dots(card({ size: "thumb", reward: { ...coffee, cost: 10 } }))).toEqual([5, 10]);
    expect(card({ size: "thumb", reward: { ...coffee, cost: 10 } })).toContain('data-five="true"');
  });

  it("speaks to the guest: the line, then the reward, or that it is ready", () => {
    expect(text(card())).toContain("Noch 3 Stempel bis zu deiner Prämie: Gratiskaffee");
    expect(text(card({ balance: 7 }))).toContain("Noch 1 Stempel bis zu deiner Prämie: Gratiskaffee");
    expect(text(card({ balance: 8 }))).toContain("Deine Prämie ist bereit: Gratiskaffee");
  });

  it("gives the owner the neutral line, without „deiner Prämie“", () => {
    const owner = text(card({ voice: "owner" }));
    expect(owner).toContain("Noch 3 Stempel bis „Gratiskaffee“.");
    expect(owner).not.toContain("deiner Prämie");
  });

  it("shows Programm's two fields", () => {
    expect(text(card({ size: "example" }))).toContain("Prämie Gratiskaffee Einlösbar ab 8 Stempeln");
  });

  it("at the Kasse: the card number, its note, the labelled balance and the page's own foot", () => {
    const kasse = card({ size: "kasse", title: "K-C7YPM6", sub: "Geprüfte Karte", label: "Aktueller Kontostand", foot: h("a", null, "Andere Karte") });
    expect(text(kasse)).toMatch(/^D K-C7YPM6 Geprüfte Karte 5 von 8 Aktueller Kontostand .*Andere Karte$/);
    expect(kasse).toMatch(/>5<\/span><small>\u00a0von 8<\/small>/); // a reader hears „5\u00a0von 8“, not „5von 8“
    expect(text(card({ size: "kasse" }))).not.toContain("Prämie");
  });

  it("keeps a points programme on its ladder, with no stamp grid", () => {
    const points = card({ programType: "points", balance: 186, reward: { id: "p", title: "Frühstück für zwei", cost: 250 } });
    expect(earned(points)).toBe(0);
    expect(points).not.toContain("--cols");
    expect(text(points)).toContain("186 Punkte");
    expect(text(points)).toContain("Noch 64 Punkte bis zu deiner Prämie: Frühstück für zwei");
    expect(dots(card({ programType: "points", size: "thumb", reward: { id: "p", title: "Frühstück", cost: 250 } }))).toEqual([0, 0]);
  });

  // ENG-292 (Design, 19 Nov §0.1, §1.2): the ladder in the mix tone, with the booking's landing and first-paint growth passed through.
  it("draws a points programme's ladder in the mix tone, landing the crossed markers and growing only when asked", () => {
    const rewards = [{ id: "a", title: "Espresso", cost: 60 }, { id: "b", title: "Pizza", cost: 150 }, { id: "c", title: "Menü", cost: 300 }];
    const points = (props = {}) => card({ programType: "points", balance: 186, reward: rewards[2], rewards, ...props });
    expect(points()).toMatch(/role="img"[^>]*data-tone="mix"/);
    expect(points()).not.toContain("data-new");
    expect(points()).not.toContain("data-grow");
    const landed = points({ landedFrom: 21 });
    expect(landed.match(/data-new="true"/g)).toHaveLength(2);
    expect(landed).toMatch(/data-reached="true" data-new="true"[^>]*><span[^>]*><svg.*?<\/svg><\/span><small[^>]*>60</);
    expect(points({ grow: true })).toContain('data-grow="true"');
    // The figure is the true balance with „Punkte“ under it, never „von N“.
    expect(points()).toMatch(/<b data-figure=""><span[^>]*>186<\/span><\/b><span>Punkte<\/span>/);
    // A stamp card takes neither: its markup is the one it had.
    expect(card({ landedFrom: 2, grow: true })).toBe(card());
  });

  it("dims the open marker as the open stamp, titles at the card's 78 %, and rings it in forced colours", () => {
    const css = readFileSync(join(__dirname, "../ui/points-ladder.module.css"), "utf8");
    expect(css).toContain('.ladder[data-tone="mix"] .mark:not([data-reached]) .dot { border: 0; background: color-mix(in oklab, var(--merchant-ink) 14%, transparent); }');
    expect(css).toContain('.ladder[data-tone="mix"] .title { color: var(--on-card); }');
    expect(css).toMatch(/@media \(forced-colors: active\) \{[^@]*\.ladder\[data-tone="mix"\] \.mark:not\(\[data-reached\]\) \.dot \{ border: 1px solid CanvasText; \}/);
  });

  it("names the region „Karte“ everywhere but on the guest's own full card", () => {
    expect(card()).toContain('aria-label="Deine Treuekarte"');
    for (const props of [{ voice: "owner" as const }, { size: "example" as const }, { size: "kasse" as const }]) expect(card(props)).toMatch(/^<section[^>]*aria-label="Karte"/);
  });

  it("draws every dot of a thumbnail, 8 px up to 12 stamps and 6 px from 13, centred with equal insets inside 64 x 44", () => {
    for (let n = 1; n <= 30; n++) {
      const cols = thumbColumns(n), rows = Math.ceil(n / cols), dense = n > 12;
      const [dot, colGap, rowGap] = dense ? [6, 2, 2] : [8, cols === 5 ? 4 : 6, 4];
      const width = cols * dot + (cols - 1) * colGap, height = rows * dot + (rows - 1) * rowGap;
      expect(width, `${n} stamps`).toBeLessThanOrEqual(64);
      expect(height, `${n} stamps`).toBeLessThanOrEqual(44);
      if (dense) {
        expect(rows, `${n} stamps`).toBeLessThanOrEqual(5);
        expect((64 - width) % 2, `${n} stamps`).toBe(0); // equal insets left and right, on whole pixels
        expect((44 - height) % 2, `${n} stamps`).toBe(0);
        expect(44 - height, `${n} stamps clear the top and bottom`).toBeGreaterThan(0);
      }
    }
    expect([8, 10, 12, 13, 16, 20, 21, 25, 30].map(thumbColumns)).toEqual([4, 5, 4, 4, 4, 5, 6, 6, 6]);
    expect(card({ size: "thumb", reward: { ...coffee, cost: 12 } })).not.toContain("data-dense");
    expect(card({ size: "thumb", reward: { ...coffee, cost: 13 } })).toContain('data-dense="true"');
    expect(card({ size: "thumb", reward: { ...coffee, cost: 20 } })).not.toContain("data-five");
    expect(readFileSync(join(__dirname, "mix-card.module.css"), "utf8")).toContain(".thumb[data-dense] { grid-template-columns: repeat(var(--cols), 6px); gap: 2px; }");
    expect(card({ size: "thumb", balance: 5, reward: { ...coffee, cost: 25 } })).toContain('aria-label="5 von 25 Stempeln"');
    expect(dots(card({ size: "thumb", balance: 5, reward: { ...coffee, cost: 30 } }))).toEqual([5, 30]);
  });

  it("keeps the stamps, the edge and the thumbnail visible in forced colours, and the balance in tabular figures", () => {
    const css = readFileSync(join(__dirname, "mix-card.module.css"), "utf8");
    const forced = css.slice(css.lastIndexOf("@media (forced-colors: active)"));
    for (const rule of [".card { border: 1px solid CanvasText; }", ".stamp { border: 1px solid CanvasText; }", ".thumb { forced-color-adjust: none; background: Canvas; border: 1px solid CanvasText; }", ".thumb i[data-on] { background: CanvasText; }"]) expect(forced).toContain(rule);
    expect(css).toMatch(/\.n b \{[^}]*font-variant-numeric: tabular-nums;/);
  });

  it("puts every stamp on a whole pixel", () => {
    const css = readFileSync(join(__dirname, "mix-card.module.css"), "utf8");
    expect(css).toContain("width: round(var(--st), 1px);");
  });
});

describe("the Kasse card's grid (Design, 18 Nov)", () => {
  it("keeps two rows: above 8 stamps ceil(goal / 2) columns, at the Kasse size only", () => {
    expect(card({ size: "kasse", reward: { ...coffee, cost: 12 } })).toContain("--cols:6");
    expect(card({ size: "kasse", reward: { ...coffee, cost: 10 } })).toContain("--cols:5");
    expect(card({ size: "kasse" })).toContain("--cols:4");
    expect(card({ reward: { ...coffee, cost: 12 } })).toContain("--cols:4"); // the guest card keeps the mock's grid
  });
  it("draws earned stamps as plain discs from 9 columns", () => {
    const twenty = card({ size: "kasse", balance: 5, reward: { ...coffee, cost: 20 } });
    expect(twenty).toContain("--cols:10");
    expect(earned(twenty)).toBe(5);
    expect(twenty).not.toContain("lucide-check");
    expect(card({ size: "kasse", balance: 5, reward: { ...coffee, cost: 12 } })).toContain("lucide-check");
  });
});
