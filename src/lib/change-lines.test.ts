import { describe, expect, it } from "vitest";
import { changeLines, expiryChangeLine, rewardChangeLine, ruleChangeLine } from "./change-lines";

describe("card lines for a reward change waiting for its date (W31, W49)", () => {
  const coffee = { title: "Gratiskaffee", cost: 10 };
  it.each([
    [{ effectiveOn: "2026-11-24", title: "Gratiskaffee", cost: 12 }, "Ab 24.11. gibt es Gratiskaffee für 12 Stempel. Bis dahin reichen 10."],
    [{ endsOn: "2026-11-24" }, "Ab 24.11. gibt es Gratiskaffee nicht mehr. Bis dahin kannst du die Prämie noch einlösen."],
    [{ effectiveOn: "2026-11-24", title: "Gratiskaffee 0,2 l", cost: 10 }, "Ab 24.11. gibt es „Gratiskaffee 0,2 l“ statt „Gratiskaffee“. Bis dahin bleibt es bei der bisherigen Prämie."],
    [{ effectiveOn: "2026-11-24", title: "Gratiskaffee 0,2 l", cost: 12 }, "Ab 24.11. gibt es „Gratiskaffee 0,2 l“ für 12 Stempel statt „Gratiskaffee“ für 10. Bis dahin bleibt es bei der bisherigen Prämie."],
  ])("%o", (change, line) => expect(rewardChangeLine("stamps", coffee, change)).toBe(line));

  it("says „reicht 1“ and counts points", () => {
    expect(rewardChangeLine("stamps", { title: "Keks", cost: 1 }, { effectiveOn: "2026-01-05", title: "Keks", cost: 2 })).toBe("Ab 5.1. gibt es Keks für 2 Stempel. Bis dahin reicht 1.");
    expect(rewardChangeLine("points", { title: "Pizza", cost: 250 }, { effectiveOn: "2026-11-24", title: "Pizza", cost: 300 })).toBe("Ab 24.11. gibt es Pizza für 300 Punkte. Bis dahin reichen 250.");
  });
});

describe("card lines for a rule or expiry change waiting for its date (W45, W46, W52, W58, W59)", () => {
  const purchase = (rate: number, rulesText = "") => ({ earningMode: "purchase", pointsPerCurrencyUnit: rate, rulesText });
  const manual = (rulesText: string, rate = 2) => ({ earningMode: "manual", pointsPerCurrencyUnit: rate, rulesText });
  const long = "Punkte gibt es nur für Speisen und Getränke im Lokal, nicht für Lieferungen, Gutscheine oder Feiern mit Vorbestellung, und nur einmal pro Tisch und Besuch.";
  it.each([
    [purchase(2), purchase(1), { text: "Ab 24.11. gibt es 1 Punkt pro € Einkauf. Bis dahin bleibt es bei 2." }],
    [manual("10 Punkte pro Pizza."), purchase(1), { text: "Ab 24.11. gibt es 1 Punkt pro 1 € Einkaufswert. Bis dahin bleibt es bei der bisherigen Regel." }],
    [purchase(1), manual("10 Punkte pro Pizza", 1), { text: "Ab 24.11. gilt: 10 Punkte pro Pizza. Bis dahin bleibt es bei 1 Punkt pro 1 € Einkaufswert." }],
    [purchase(2), manual(long), { text: "Ab 24.11. gilt eine neue Regel. Bis dahin bleibt es bei 2 Punkten pro 1 € Einkaufswert.", link: true }],
    [manual("10 Punkte pro Pizza."), manual("5 Punkte pro Pizza."), { text: "Ab 24.11. gilt: 5 Punkte pro Pizza. Bis dahin bleibt es bei der bisherigen Regel." }],
    [manual("10 Punkte pro Pizza."), manual(long), { text: "Ab 24.11. gilt eine neue Regel. Bis dahin bleibt es bei der bisherigen.", link: true }],
    [purchase(2), purchase(2, "Nicht auf Getränke"), { text: "Ab 24.11. gilt zusätzlich: Nicht auf Getränke. Bis dahin gilt das noch nicht." }],
    [purchase(2), purchase(2, long), { text: "Ab 24.11. gilt eine weitere Regel. Bis dahin gilt sie noch nicht.", link: true }],
  ])("%o → %o", (before, after, line) => expect(ruleChangeLine("2026-11-24", before, after)).toEqual(line));

  it("splits at 140 characters of the trimmed text", () => {
    const at = "x".repeat(139) + ".";
    expect(ruleChangeLine("2026-11-24", manual("a"), manual(` ${at} `)).link).toBeUndefined();
    expect(ruleChangeLine("2026-11-24", manual("a"), manual(at + "y")).link).toBe(true);
  });

  it("announces a stricter expiry", () => expect(expiryChangeLine("2026-11-24", 24)).toBe("Ab 24.11. verfallen neue Punkte nach 24 Monaten. Punkte, die du bis dahin sammelst, verfallen nie."));
});

describe("all lines for a card, join page or Wallet back (U3)", () => {
  const old = { earningMode: "manual", pointsPerCurrencyUnit: 1, rulesText: "10 Punkte pro Pizza." };
  const long = "Punkte gibt es nur für Speisen und Getränke im Lokal, nicht für Lieferungen, Gutscheine oder Feiern mit Vorbestellung, und nur einmal pro Tisch und Besuch.";
  const program = { programType: "points" as const, rewards: [{ title: "Pizza", cost: 100, pending: { effectiveOn: "2026-11-24", title: "Pizza", cost: 120 } }, { title: "Cola", cost: 30, endsOn: "2026-11-24" }, { title: "Eis", cost: 50 }],
    pending: { effectiveOn: "2026-11-24", ...old, rulesText: long, old }, pendingExpiry: { effectiveOn: "2026-11-24", months: 24 } };
  it("lists each waiting change once, with the long rule behind its link", () => {
    expect(changeLines(program)).toEqual({
      rewards: ["Ab 24.11. gibt es Pizza für 120 Punkte. Bis dahin reichen 100.", "Ab 24.11. gibt es Cola nicht mehr. Bis dahin kannst du die Prämie noch einlösen."],
      rule: { text: "Ab 24.11. gilt eine neue Regel. Bis dahin bleibt es bei der bisherigen.", link: true },
      newRule: { on: "24.11.", text: long },
      expiry: "Ab 24.11. verfallen neue Punkte nach 24 Monaten. Punkte, die du bis dahin sammelst, verfallen nie.",
    });
  });
  it("quotes the whole rule for the Wallet back", () => expect(changeLines(program, true).rule).toEqual({ text: `Ab 24.11. gilt: ${long} Bis dahin bleibt es bei der bisherigen Regel.` }));
  it("has nothing when nothing waits", () => expect(changeLines({ programType: "stamp", rewards: [{ title: "Kaffee", cost: 10 }] })).toEqual({ rewards: [], rule: undefined, newRule: undefined, expiry: undefined }));
});
