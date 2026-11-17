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
  it("earns as many stamps as the balance, clamped to 0 … goal, at every size", () => {
    for (let n = 0; n <= 8; n++) {
      expect(earned(card({ balance: n }))).toBe(n);
      expect(earned(card({ balance: n, size: "kasse" }))).toBe(n);
      expect(dots(card({ balance: n, size: "thumb" }))).toEqual([n, 8]);
      expect(card({ balance: n })).toContain(`aria-label="${n} von 8 Stempeln"`);
    }
    expect(earned(card({ balance: -2 }))).toBe(0);
    expect(earned(card({ balance: 11 }))).toBe(8);
    expect(text(card({ balance: 11 }))).toContain("8 von 8");
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
    expect(kasse).toContain("5<small> von 8</small>"); // a reader hears „5 von 8“, not „5von 8“
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

  it("names the region „Karte“ everywhere but on the guest's own full card", () => {
    expect(card()).toContain('aria-label="Deine Treuekarte"');
    for (const props of [{ voice: "owner" as const }, { size: "example" as const }, { size: "kasse" as const }]) expect(card(props)).toMatch(/^<section[^>]*aria-label="Karte"/);
  });

  it("draws every dot of a 13 to 30 stamp thumbnail inside 64 x 44", () => {
    for (let n = 1; n <= 30; n++) {
      const cols = thumbColumns(n), rows = Math.ceil(n / cols), [dot, gap] = cols === 6 ? [6, 3] : [8, 4];
      expect(rows * dot + (rows - 1) * gap, `${n} stamps`).toBeLessThanOrEqual(44);
      expect(cols * dot + (cols - 1) * (cols === 4 ? 6 : gap), `${n} stamps`).toBeLessThanOrEqual(64);
    }
    expect([8, 10, 12, 16, 20, 30].map(thumbColumns)).toEqual([4, 5, 4, 4, 5, 6]);
    expect(dots(card({ size: "thumb", balance: 7, reward: { ...coffee, cost: 30 } }))).toEqual([7, 30]);
    expect(card({ size: "thumb", reward: { ...coffee, cost: 30 } })).toContain('data-dense="true"');
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
