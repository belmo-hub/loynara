import { describe, expect, it } from "vitest";
import { awardLimitText, manualAwardLimit, purchaseAwardLimits, quantityPickerMax } from "./award-limits";

describe("manual award limits", () => {
  it("matches the server caps per role", () => {
    expect([manualAwardLimit("cashier"), manualAwardLimit("manager"), manualAwardLimit("owner")]).toEqual([10, 100, 1000]);
  });
  it("never lets the picker exceed the server cap; unknown role gets the strictest", () => {
    expect([quantityPickerMax("cashier"), quantityPickerMax("manager"), quantityPickerMax("owner")]).toEqual([10, 100, 100]);
    for (const role of ["cashier", "manager", "owner"] as const) expect(quantityPickerMax(role)).toBeLessThanOrEqual(manualAwardLimit(role));
    expect(quantityPickerMax(null)).toBe(10);
    expect(quantityPickerMax(undefined)).toBe(10);
  });
});

describe("the counter's limit message (ENG-280)", () => {
  it("names the role's limit and the next step", () => {
    expect(purchaseAwardLimits("manager")).toEqual({ amountMinor: 200_000, points: 2_000 });
    expect(awardLimitText("cashier", true, "points", "EUR")).toBe("Höchstens 500,00 EUR oder 500 Punkte pro Buchung. Bitte den Betrag prüfen. Stimmt alles, bucht die Inhaberin oder der Inhaber.");
    expect(awardLimitText("owner", true, "points", "EUR")).toBe("Höchstens 10.000,00 EUR oder 10.000 Punkte pro Buchung. Bitte den Betrag prüfen.");
    expect(awardLimitText("cashier", false, "stamp", "EUR")).toBe("Höchstens 10 Stempel pro Buchung. Bitte die Menge prüfen. Stimmt alles, bucht die Inhaberin oder der Inhaber.");
  });
});
