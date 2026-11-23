import { describe, expect, it } from "vitest";
import { foundingTerminPrice } from "@/lib/owner-contract";
import { bookingPriceLine } from "./booking-avv";

// Legal § 7 (23 Nov): the dialog's price line follows the shop's plan. Founder, 24 Nov: Termin + Treue is 69 € for every shop.
describe("the Termin + Treue price line", () => {
  it("names 69 € instead of 49 € for the list price or no plan", () => {
    expect(bookingPriceLine(false)).toBe("69 € statt 49 € je Standort und Monat, nur für Standorte mit Termin + Treue.");
  });
  it("names 69 € instead of 39 € for a founding shop, and § 3 (1) says „ebenfalls 69 €“", () => {
    expect(foundingTerminPrice()).toBe("ebenfalls 69 €");
    expect(bookingPriceLine(true)).toBe("69 € statt 39 € je Standort und Monat, nur für Standorte mit Termin + Treue.");
  });
});
