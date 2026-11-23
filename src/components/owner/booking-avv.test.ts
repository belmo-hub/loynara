import { describe, expect, it } from "vitest";
import { foundingTerminPrice, TERMIN_PRICE } from "@/lib/owner-contract";
import { bookingPriceLine } from "./booking-avv";

// Legal § 7 (23 Nov): the dialog's price line follows the shop's plan; the founding Termin price is 59 € until the founder decides.
describe("the Termin + Treue price line", () => {
  it("names 69 € instead of 49 € for the list price or no plan", () => {
    expect(bookingPriceLine(false)).toBe("69 € statt 49 € je Standort und Monat, nur für Standorte mit Termin + Treue.");
  });
  it("names 59 € instead of 39 € for a founding shop", () => {
    expect(bookingPriceLine(true)).toBe("59 € statt 39 € je Standort und Monat, nur für Standorte mit Termin + Treue.");
  });
  it("if the founder sets 69 €, one constant changes both the dialog and § 3 (1)", () => {
    expect(foundingTerminPrice()).toBe("59 €");
    const saved = TERMIN_PRICE.founding.termin;
    TERMIN_PRICE.founding.termin = 69;
    try {
      expect(foundingTerminPrice()).toBe("ebenfalls 69 €");
      expect(bookingPriceLine(true)).toBe("69 € statt 39 € je Standort und Monat, nur für Standorte mit Termin\u00a0+\u00a0Treue.");
    } finally { TERMIN_PRICE.founding.termin = saved; }
  });
});
