import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { awardDelta, awardParts, bookedAward, CashierAccessState, cashierCard, CashierView, kasseGoal, purchasePreviewOf, type CashierCard, type CashierLookup } from "./cashier-view";

const card: CashierCard = {
  id: "m1", code: "sc_synthetic", cardLocator: "K-7QX2MA", balance: 1, programType: "points", earningMode: "manual", pointsPerCurrencyUnit: 1, currency: "EUR", ruleVersionId: "rv1",
  rewards: [{ id: "r1", name: "Kaffee", cost: 1, eligible: true }, { id: "r2", name: "Kuchen", cost: 2, eligible: false }],
};
// Inside a part the words are joined by no-break spaces; a line only breaks at a „+“.
const nb = (text: string) => text.split(" + ").map(part => part.replace(/ /g, "\u00a0")).join(" + ");
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
    expect(view("de")).toMatch(/<small>Noch <span[^>]*>1<\/span> Punkt<\/small>/);
    expect(view("de")).toMatch(/>2 Punkte<\/span>/);
    expect(view("fr")).toContain("<small>1 point</small>");
    expect(view("fr", { programType: "stamps" })).toContain("<small>1 tampon</small>");
    expect(view("fr", { programType: "stamps" })).toMatch(/>2 tampons<\/span>/);
  });
});

describe("bonuses at the counter add up (ENG-133)", () => {
  it("names the Startbonus on the award button before the tap", () => {
    expect(view("de", { balance: 0, welcomeBonus: 5 })).toContain("1 Punkt + 5 Startbonus");
    expect(view("de", { balance: 0, programType: "stamps", welcomeBonus: 1, winbackBonus: 2 })).toContain("1 Stempel + 1 Startbonus + 2 extra");
    expect(view("fr", { balance: 0, welcomeBonus: 5 })).toContain("1 point + 5 en plus");
  });

  it("names each bonus after the tap", () => {
    expect(awardParts(1, "points", { welcomeBonus: 5, winbackBonus: 0 }, "de")).toBe(nb("1 Punkt + 5 Punkte Startbonus"));
    expect(awardParts(12, "points", { happyHourBonus: 12, birthdayBonus: 2, referralBonus: 1 }, "de")).toBe(nb("12 Punkte + 12 Punkte Happy Hour + 2 Punkte Geburtstags-Bonus + 1 Punkt Empfehlungsbonus"));
    expect(awardParts(1200, "points", {}, "de")).toBe(nb("1.200 Punkte"));
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
    expect(bookedAward({ balance: 0, programType: "points" }, 1, { balance: 6, balanceBefore: 0, welcomeBonus: 5, winbackBonus: 0 }, "de")).toEqual({ headline: "+6 Punkte", parts: nb("1 Punkt + 5 Punkte Startbonus") });
    expect(bookedAward({ balance: 0, programType: "stamps" }, 1, { balance: 2, balanceBefore: 0, welcomeBonus: 1 }, "de")).toEqual({ headline: "+2 Stempel", parts: nb("1 Stempel + 1 Stempel Startbonus") });
  });

  it("keeps each part together with no-break spaces, so the line only breaks at a „+“", () => {
    expect(awardParts(12, "points", { happyHourBonus: 12, welcomeBonus: 5 }, "de")).toBe("12\u00a0Punkte + 12\u00a0Punkte\u00a0Happy\u00a0Hour + 5\u00a0Punkte\u00a0Startbonus");
  });

  it("a plain award shows only its quantity, with no line", () => {
    expect(bookedAward({ balance: 3, programType: "points" }, 1, { balance: 4, balanceBefore: 3, welcomeBonus: 0, happyHourBonus: 0 }, "de")).toEqual({ headline: "+1 Punkt", parts: undefined });
  });

  it("counts from the server's balance before the booking, not a stale lookup", () => {
    // Another till booked 2 between lookup (balance 3) and this award.
    expect(bookedAward({ balance: 3, programType: "points" }, 1, { balance: 6, balanceBefore: 5 }, "de")).toEqual({ headline: "+1 Punkt", parts: undefined });
  });

  it("previews happy hour and the Startbonus in the purchase line and in the new balance", () => {
    expect(purchasePreviewOf({ balance: 10, happyHour: true, welcomeBonus: 5 }, 12, "de")).toEqual({ total: "+29 Punkte", parts: nb("12 Punkte + 12 Punkte Happy Hour + 5 Punkte Startbonus"), balanceAfter: 39 });
    expect(purchasePreviewOf({ balance: 10, happyHour: false, welcomeBonus: 0 }, 12, "de")).toEqual({ total: "+12 Punkte", parts: undefined, balanceAfter: 22 });
  });

  it("the open card keeps the lookup's Startbonus and happy hour, so the button names them", () => {
    const lookup: CashierLookup = { membershipId: "m1", cardLocator: "K-NUG2FS", matchedBy: "code", balance: 0, programType: "points", earningMode: "manual", pointsPerCurrencyUnit: 1, currency: "EUR", ruleVersionId: "rv1", rewards: [], welcomeBonus: 5, happyHour: true };
    const opened = cashierCard(lookup, "sc_synthetic");
    expect(opened).toMatchObject({ welcomeBonus: 5, happyHour: true, programType: "points" });
    expect(renderToStaticMarkup(h(CashierView, { locationName: "Kassel", card: opened, onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {} }))).toContain("1 Punkt + 5 Startbonus");
  });
});

describe("a typed card number that opens no card (ENG-203)", () => {
  const rejected = (props: Record<string, unknown>) => renderToStaticMarkup(h(CashierView, { locationName: "Kassel", status: "rejected", message: "Prüfe die Nummer.", onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {}, ...props }));
  const field = (html: string) => html.match(/<input id="cashier-code"[^>]*>/)![0];

  it("titles the panel with the cause and ties the message to the field", () => {
    const html = rejected({ codeRejected: true, rejectedTitle: "Karte nicht gefunden" });
    expect(html).toContain('<strong>Karte nicht gefunden</strong><span id="cashier-outcome-text">Prüfe die Nummer.</span>');
    expect(field(html)).toContain('aria-describedby="cashier-code-hint cashier-outcome-text"');
    expect(field(html)).toContain('aria-invalid="true"');
  });

  it("another refusal keeps the status' own word, and the field describes itself by its hint alone", () => {
    const html = rejected({});
    expect(html).toContain("<strong>Nicht möglich</strong>");
    expect(field(html)).toContain('aria-describedby="cashier-code-hint"');
    expect(field(html)).not.toContain("aria-invalid");
  });
});

describe("the mix Kasse (ENG-256)", () => {
  const stamps: CashierCard = { ...card, programType: "stamps", balance: 5, rewards: [{ id: "r1", name: "Gratiskaffee", cost: 8, eligible: false }] };
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(h(CashierView, { locationName: "Kassel Mitte", locale: "de", onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {}, ...props }));

  it("a card opened by its typed number says so in the card's foot, in place of the state, before the rewards", () => {
    const out = render({ card: { ...stamps, matchedBy: "locator" } });
    expect(out).toMatch(/Andere Karte<\/button><p class="cashier-locator-note[^"]*" role="note">Ohne Scan geöffnet: Prämie nur für die eigene Karte\.<\/p>/);
    expect(out).not.toContain("Karte offen");
    expect(out.indexOf("Ohne Scan geöffnet")).toBeLessThan(out.indexOf("<b>Gratiskaffee</b>"));
  });

  it("an open card: the card number, the state in its foot, the reward row and the new balance before the tap", () => {
    const out = render({ card: stamps, role: "cashier" });
    expect(out).toContain("<b>K-7QX2MA</b><span>Geprüfte Karte</span>");
    expect(out).toMatch(/Andere Karte<\/button><span[^>]*data-state="open"><i aria-hidden="true"><\/i>Karte offen<\/span>/);
    expect(out).toMatch(/<b>Gratiskaffee<\/b><small>Noch <span[^>]*>3<\/span> Stempel<\/small>/);
    expect(out).toMatch(/<span>Neuer Stand<\/span><b><span[^>]*>6 von 8<\/span><\/b>/);
    expect(out).toContain("Falsch? Die Leitung kann es korrigieren.");
  });

  it("above the goal the new balance and the booked line read the true count with its unit, as the card", () => {
    const over: CashierCard = { ...card, programType: "stamps", balance: 9, rewards: [{ id: "r1", name: "Gratiskaffee", cost: 8, eligible: true }] };
    const open = render({ card: over });
    expect(open).toMatch(/<span>Neuer Stand<\/span><b><span[^>]*>10 Stempel<\/span><\/b>/);
    const booked = render({ booked: { tone: "success", title: "Gebucht", headline: "+1 Stempel", detail: "Neuer Stand: 10 Stempel.", meta: "K-7QX2MA", card: { ...over, balance: 10 } } });
    expect(booked).toContain(">10 Stempel · K-7QX2MA<");
    expect(booked).not.toContain("von 8 ·");
  });

  it("after a booking „Gebucht“ holds the dock and the closed card shows the new balance, with nothing to book or redeem", () => {
    const out = render({ booked: { tone: "success", title: "Gebucht", headline: "+1 Stempel", detail: "Neuer Stand: 6 Stempel.", meta: "K-7QX2MA", card: { ...stamps, balance: 6 } } });
    expect(out).toMatch(/data-dock="true"><section class="cashier-booked/);
    // The card's terms in one line; the live sentence and the number stay for screen readers and the specs.
    expect(out).toMatch(/>Neuer Stand: 6 Stempel\.<\/p><p[^>]*aria-hidden="true">K-7QX2MA<\/p><p[^>]*aria-hidden="true">6 von 8 · K-7QX2MA<\/p>/);
    expect(out).toContain("Bereit für die nächste Karte");
    expect(out).toContain("data-booked=\"\"");
    expect(out).toMatch(/<b data-figure="">.*>6<\/span><small> von 8<\/small><\/b>/);
    // Only the digit rolls in: „Noch“ and the unit stand still.
    expect(out).toMatch(/<small>Noch <span class="[^"]*">2<\/span> Stempel<\/small>/);
    expect(out).not.toContain("reward-action-list");
    expect(out).not.toContain("cashier-award-now");
    expect(out).toMatch(/data-state="open"><i aria-hidden="true"><\/i>Karte offen/);
  });
});

describe("points programmes keep today's Kasse card (Design, 17 Nov)", () => {
  it("a points card is not drawn on the mix card: the number, its unit and the ladder in today's panel", () => {
    const out = view("de", { balance: 1 });
    expect(out).not.toContain("<span>Geprüfte Karte</span>");
    expect(out).not.toContain("Aktueller Kontostand</span></div>");
    expect(out).toMatch(/<h2 id="cashier-card-title"[^>]*>K-7QX2MA<\/h2>/);
    expect(out).toMatch(/class="balance-display [^"]*"><span[^>]*>Aktueller Kontostand<\/span><strong><span[^>]*>1<\/span> <em>Punkt<\/em>/);
    expect(out).toContain("aria-label=\"1 von 2 Punkten\"");
  });
});

describe("the Kasse's waits (Design, 18 Nov)", () => {
  it("while the access check runs, the sheet shows the scan form's still shape: the strip as a block, no words panel", () => {
    const out = renderToStaticMarkup(h(CashierAccessState, { state: "loading", message: "" }));
    expect(out).toContain("cashier-placeholder");
    expect(out).toContain('aria-busy="true"');
    // The strip holds its place as a hidden block until its words are due.
    expect(out).toMatch(/data-state="busy" data-placeholder="true" aria-hidden="true"/);
    expect(out).not.toContain("<h1>Kassenzugang wird geprüft</h1>");
    expect(out).not.toContain("app-state-card");
  });

  it("the booking that reaches the goal keeps the one reward's row through „Gebucht“; a card opened ready leaves it out", () => {
    const one: CashierCard = { ...card, programType: "stamps", balance: 7, rewards: [{ id: "r1", name: "Gratiskaffee", cost: 8, eligible: false }] };
    const booked = { tone: "success" as const, title: "Gebucht", headline: "+1 Stempel", detail: "Neuer Stand: 8 Stempel.", meta: "K-7QX2MA", card: { ...one, balance: 8 } };
    const base = { locationName: "Kassel Mitte", locale: "de" as const, onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {} };
    // Server render has no earlier open, so this pins the opened card's side: 7 of 8 shows the row, 8 of 8 opened leaves it out.
    expect(renderToStaticMarkup(h(CashierView, { ...base, card: one }))).toContain("<b>Gratiskaffee</b>");
    expect(renderToStaticMarkup(h(CashierView, { ...base, card: { ...one, balance: 8, rewards: [{ ...one.rewards[0], eligible: true }] } }))).not.toContain("<b>Gratiskaffee</b>");
    // A booked state whose card was not opened ready keeps the row.
    expect(renderToStaticMarkup(h(CashierView, { ...base, booked }))).toContain("<b>Gratiskaffee</b>");
  });

  it("after a typed booking the code field stands in the Gebucht dock, and the scan path keeps the form out of sight", () => {
    const stamps: CashierCard = { ...card, programType: "stamps", balance: 6, rewards: [{ id: "r1", name: "Gratiskaffee", cost: 8, eligible: false }] };
    const booked = { tone: "success" as const, title: "Gebucht", headline: "+1 Stempel", detail: "Neuer Stand: 6 Stempel.", meta: "K-7QX2MA", card: stamps };
    const base = { locationName: "Kassel Mitte", locale: "de" as const, onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {}, booked };
    const typed = renderToStaticMarkup(h(CashierView, { ...base, focusCodeInput: true }));
    // Beside the live region, not in it: the region ends with the ready line, the form follows.
    expect(typed).toMatch(/Bereit für die nächste Karte<\/p><\/div><form[^>]*><input id="cashier-code" aria-label="Kartennummer oder Kartencode" placeholder="Kartennummer oder Kartencode"/);
    expect(typed.match(/id="cashier-code"/g)).toHaveLength(1);
    const scanned = renderToStaticMarkup(h(CashierView, base));
    expect(scanned).not.toMatch(/<form[^>]*><input id="cashier-code" aria-label/);
  });
});

describe("the reward the Kasse's card counts to (Design, 18 Nov)", () => {
  const two = (balance: number): CashierCard => ({ ...card, programType: "stamps", balance, rewards: [{ id: "big", name: "Gratiskaffee", cost: 8, eligible: balance >= 8 }, { id: "small", name: "Kleiner Kaffee", cost: 3, eligible: balance >= 3 }] });
  const figure = (balance: number) => renderToStaticMarkup(h(CashierView, { locationName: "Kassel Mitte", locale: "de", card: two(balance), onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {} }))
    .match(/<b data-figure="">(.*?)<\/b>/)?.[1].replace(/<[^>]+>/g, "");
  it("is the cheapest reward not reached yet, or the largest once all are reached", () => {
    expect(kasseGoal(two(2))?.cost).toBe(3);
    expect(kasseGoal(two(4))?.cost).toBe(8);
    expect(kasseGoal(two(9))?.cost).toBe(8);
    expect(kasseGoal({ balance: 9, rewards: [{ id: "one", name: "Kaffee", cost: 8, eligible: true }] })?.cost).toBe(8);
  });
  it("reads „2 von 3“, „4 von 8“ and „9 Stempel“ with rewards at 3 and 8", () => {
    expect(figure(2)).toBe("2 von 3");
    expect(figure(4)).toBe("4 von 8");
    expect(figure(9)).toBe("9 Stempel");
    // At 4 the card draws 8 dots, 4 earned; the ready 3-stamp reward stays in the list and the band.
    const out = renderToStaticMarkup(h(CashierView, { locationName: "Kassel Mitte", locale: "de", card: two(4), onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {} }));
    expect(out).toContain('aria-label="4 von 8 Stempeln"');
    expect(out).toContain("cashier-redeem-now");
    expect(out).toContain("<b>Kleiner Kaffee</b>");
  });
});

describe("a points card's booked line (Design, 18 Nov)", () => {
  it("reads „121 Punkte · K-…“ without a stop; the sentence and the number stay for screen readers", () => {
    const points: CashierCard = { ...card, balance: 121, rewards: [{ id: "r1", name: "Frühstück", cost: 250, eligible: false }] };
    const out = renderToStaticMarkup(h(CashierView, { locationName: "Kassel Mitte", locale: "de", onLookup: () => {}, onAward: () => {}, onRedeem: () => {}, onClear: () => {},
      booked: { tone: "success", title: "Gebucht", headline: "+16 Punkte", detail: "Neuer Stand: 121 Punkte.", meta: "K-HFC35B", card: points } }));
    expect(out).toMatch(/aria-hidden="true">121 Punkte · K-HFC35B<\/p>/);
    expect(out).toMatch(/class="[^"]*srOnly[^"]*">Neuer Stand: 121 Punkte\.<\/p>/);
  });
});
