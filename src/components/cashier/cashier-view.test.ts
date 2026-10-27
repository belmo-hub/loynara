import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashierView, type CashierCard } from "./cashier-view";

const card: CashierCard = {
  id: "m1", code: "sc_synthetic", cardLocator: "K-7QX2MA", balance: 1, programType: "points", earningMode: "manual", pointsPerCurrencyUnit: 1, currency: "EUR", ruleVersionId: "rv1",
  rewards: [{ id: "r1", name: "Kaffee", cost: 1, eligible: true }, { id: "r2", name: "Kuchen", cost: 2, eligible: false }],
};
const view = (locale: "de" | "fr", change: Partial<CashierCard> = {}) => renderToStaticMarkup(h(CashierView, {
  locationName: "Kassel", card: { ...card, ...change }, locale, onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {},
}));

describe("counts on the cashier screen (ENG-108)", () => {
  it("win-back and birthday lines in French: one point or stamp in the singular", () => {
    expect(view("fr", { winbackBonus: 1, birthdayBonus: 1 })).toContain("Bon retour : +1 point en plus");
    expect(view("fr", { winbackBonus: 1, birthdayBonus: 1 })).toContain("Anniversaire : +1 point en plus");
    expect(view("fr", { winbackBonus: 2, birthdayBonus: 2 })).toContain("Bon retour : +2 points en plus");
    expect(view("fr", { winbackBonus: 2, birthdayBonus: 2 })).toContain("Anniversaire : +2 points en plus");
    expect(view("fr", { programType: "stamps", winbackBonus: 1 })).toContain("Bon retour : +1 tampon en plus");
    expect(view("de", { winbackBonus: 1 })).toContain("Willkommen zurück: +1 Punkt extra");
  });
  it("balance, with French zero in the singular", () => {
    expect(view("de")).toMatch(/>1<\/span> <em>Punkt<\/em>/);
    expect(view("de", { balance: 2 })).toMatch(/>2<\/span> <em>Punkte<\/em>/);
    expect(view("fr")).toMatch(/>1<\/span> <em>point<\/em>/);
    expect(view("fr", { balance: 0 })).toMatch(/>0<\/span> <em>point<\/em>/);
    expect(view("fr", { balance: 2 })).toMatch(/>2<\/span> <em>points<\/em>/);
    expect(view("fr", { programType: "stamps", balance: 1 })).toMatch(/>1<\/span> <em>tampon<\/em>/);
  });
  it("reward prices, with a reward that costs exactly 1", () => {
    expect(view("de")).toContain("<small>1 Punkt</small>");
    expect(view("de")).toContain("<small>2 Punkte</small>");
    expect(view("fr")).toContain("<small>1 point</small>");
    expect(view("fr", { programType: "stamps" })).toContain("<small>1 tampon</small>");
    expect(view("fr", { programType: "stamps" })).toContain("<small>2 tampons</small>");
  });
});
