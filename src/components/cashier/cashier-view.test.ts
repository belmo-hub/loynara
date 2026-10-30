import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { awardDelta, awardParts, bookedAward, cashierCard, CashierView, purchasePreviewOf, type CashierCard, type CashierLookup } from "./cashier-view";

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
  it("the reward band names the one ready reward, in German only, and none when several are ready (ENG-122g)", () => {
    expect(view("de")).toContain("<b>Prämie einlösen</b><small>Kaffee · Stand reicht</small>");
    expect(view("fr")).not.toContain("<small>Kaffee");
    expect(view("de", { balance: 2, rewards: card.rewards.map(reward => ({ ...reward, eligible: true })) })).toContain("<b>Prämie einlösen</b></span>");
  });
  it("reward prices, with a reward that costs exactly 1", () => {
    expect(view("de")).toContain("<small>1 Punkt</small>");
    expect(view("de")).toContain("<small>2 Punkte</small>");
    expect(view("fr")).toContain("<small>1 point</small>");
    expect(view("fr", { programType: "stamps" })).toContain("<small>1 tampon</small>");
    expect(view("fr", { programType: "stamps" })).toContain("<small>2 tampons</small>");
  });
});

describe("bonuses at the counter add up (ENG-133)", () => {
  it("names the Startbonus on the award button before the tap", () => {
    expect(view("de", { balance: 0, welcomeBonus: 5 })).toContain("1 Punkt + 5 Startbonus");
    expect(view("de", { balance: 0, programType: "stamps", welcomeBonus: 1, winbackBonus: 2 })).toContain("1 Stempel + 1 Startbonus + 2 extra");
    expect(view("fr", { balance: 0, welcomeBonus: 5 })).toContain("1 point + 5 en plus");
  });

  it("names each bonus after the tap", () => {
    expect(awardParts(1, "points", { welcomeBonus: 5, winbackBonus: 0 }, "de")).toBe("1 Punkt + 5 Punkte Startbonus");
    expect(awardParts(12, "points", { happyHourBonus: 12, birthdayBonus: 2, referralBonus: 1 }, "de")).toBe("12 Punkte + 12 Punkte Happy Hour + 2 Punkte Geburtstags-Bonus + 1 Punkt Empfehlungsbonus");
    expect(awardParts(1200, "points", {}, "de")).toBe("1.200 Punkte");
  });

  it("shows the booked parts under the delta chip", () => {
    const html = renderToStaticMarkup(h(CashierView, { locationName: "Kassel", booked: { tone: "success", title: "Gebucht", headline: "+6 Punkte", parts: "1 Punkt + 5 Startbonus", detail: "Neuer Stand: 6 Punkte." }, onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {} }));
    expect(html).toMatch(/\+6 Punkte<\/p><p[^>]*>1 Punkt \+ 5 Startbonus<\/p>/);
  });

  it("credited plus bonuses is the balance change; a mismatch is logged and the real change shown", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(awardDelta(0, { balance: 6, creditedQuantity: 1, welcomeBonus: 5 })).toEqual({ delta: 6, matches: true });
    expect(warn).not.toHaveBeenCalled();
    expect(awardDelta(0, { balance: 6, creditedQuantity: 1 })).toEqual({ delta: 6, matches: false });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("the booked screen, the purchase preview and the lookup keep every bonus (ENG-133 review)", () => {
  it("a first award with a Startbonus shows the balance change and names the parts", () => {
    expect(bookedAward({ balance: 0, programType: "points" }, 1, { balance: 6, balanceBefore: 0, welcomeBonus: 5, winbackBonus: 0 }, "de")).toEqual({ headline: "+6 Punkte", parts: "1 Punkt + 5 Punkte Startbonus" });
    expect(bookedAward({ balance: 0, programType: "stamps" }, 1, { balance: 2, balanceBefore: 0, welcomeBonus: 1 }, "de")).toEqual({ headline: "+2 Stempel", parts: "1 Stempel + 1 Stempel Startbonus" });
  });

  it("a plain award shows only its quantity, with no line", () => {
    expect(bookedAward({ balance: 3, programType: "points" }, 1, { balance: 4, balanceBefore: 3, welcomeBonus: 0, happyHourBonus: 0 }, "de")).toEqual({ headline: "+1 Punkt", parts: undefined });
  });

  it("counts from the server's balance before the booking, not a stale lookup", () => {
    // Another till booked 2 between lookup (balance 3) and this award.
    expect(bookedAward({ balance: 3, programType: "points" }, 1, { balance: 6, balanceBefore: 5 }, "de")).toEqual({ headline: "+1 Punkt", parts: undefined });
  });

  it("previews happy hour and the Startbonus in the purchase line and in the new balance", () => {
    expect(purchasePreviewOf({ balance: 10, happyHour: true, welcomeBonus: 5 }, 12, "de")).toEqual({ line: "+12 Punkte + 12 Punkte Happy Hour + 5 Punkte Startbonus", balanceAfter: 39 });
    expect(purchasePreviewOf({ balance: 10, happyHour: false, welcomeBonus: 0 }, 12, "de")).toEqual({ line: "+12 Punkte", balanceAfter: 22 });
  });

  it("the open card keeps the lookup's Startbonus and happy hour, so the button names them", () => {
    const lookup: CashierLookup = { membershipId: "m1", cardLocator: "K-NUG2FS", matchedBy: "code", balance: 0, programType: "points", earningMode: "manual", pointsPerCurrencyUnit: 1, currency: "EUR", ruleVersionId: "rv1", rewards: [], welcomeBonus: 5, happyHour: true };
    const opened = cashierCard(lookup, "sc_synthetic");
    expect(opened).toMatchObject({ welcomeBonus: 5, happyHour: true, programType: "points" });
    expect(renderToStaticMarkup(h(CashierView, { locationName: "Kassel", card: opened, onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {} }))).toContain("1 Punkt + 5 Startbonus");
  });
});
