import { describe, expect, it } from "vitest";
import { checkRulesText, parsePurchaseAmountMinor, purchasePoints, purchaseRuleSentence } from "./points";

describe("the earning sentence by purchase amount (ENG-099 3c)", () => {
  it("says what purchasePoints books, in the card's words for one and more points", () => {
    expect(purchaseRuleSentence(1, "EUR")).toBe("1 Punkt pro 1 € Einkaufswert, abgerundet auf ganze Punkte.");
    expect(purchaseRuleSentence(3, "EUR")).toBe("3 Punkte pro 1 € Einkaufswert, abgerundet auf ganze Punkte.");
    expect(purchaseRuleSentence(2, "MAD")).toBe("2 Punkte pro 1 MAD Einkaufswert, abgerundet auf ganze Punkte.");
    expect(purchaseRuleSentence(1, "MAD", "fr")).toBe("1 point par MAD dépensé. Les fractions de point sont arrondies à l’entier inférieur."); // the sign-up page's French line
  });

  it("asks the owner's own rule for 10 characters, extra rules by purchase amount for none", () => {
    for (const text of ["", "Nur Mo–Fr"]) expect(() => checkRulesText("points", "purchase", text)).not.toThrow();
    for (const [type, mode] of [["stamp", "manual"], ["points", "manual"]]) {
      expect(() => checkRulesText(type, mode, "Zu kurz.")).toThrow(expect.objectContaining({ issues: [expect.objectContaining({ path: ["rulesText"], code: "too_small" })] }));
      expect(() => checkRulesText(type, mode, "Ein Stempel pro Kaffee.")).not.toThrow();
    }
  });
});

describe("purchase points", () => {
  it("floors fractional points using exact minor-unit arithmetic", () => {
    expect(purchasePoints(499, 1)).toBe(4);
    expect(purchasePoints(199, 2)).toBe(3);
    expect(purchasePoints(1, 100)).toBe(1);
  });

  it("rejects invalid, zero-point, and excessive purchases", () => {
    expect(() => purchasePoints(99, 1)).toThrow("NO_POINTS");
    expect(() => purchasePoints(0, 1)).toThrow("INVALID_PURCHASE_AMOUNT");
    expect(() => purchasePoints(10_000_001, 1)).toThrow("INVALID_PURCHASE_AMOUNT");
    expect(() => purchasePoints(100.5, 1)).toThrow("INVALID_PURCHASE_AMOUNT");
    expect(() => purchasePoints(100, 0)).toThrow("INVALID_POINTS_RATE");
  });
});

describe("purchase amount entry", () => {
  it("parses two-decimal EUR and MAD amounts without floating point", () => {
    expect(parsePurchaseAmountMinor("16,70")).toBe(1670);
    expect(parsePurchaseAmountMinor("16.7")).toBe(1670);
    expect(parsePurchaseAmountMinor("100000")).toBe(10_000_000);
  });

  it("rejects empty, malformed, zero and excessive amounts", () => {
    for (const amount of ["", "0", "0,00", "1,234", "1,2,3", "-1", "100000,01"]) {
      expect(() => parsePurchaseAmountMinor(amount)).toThrow("INVALID_PURCHASE_AMOUNT");
    }
  });
});
