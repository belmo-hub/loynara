import { expect, it } from "vitest";
import { BOOKING_PRICE_LINE } from "./booking-avv";

// Legal § 5 and § 7: the price line before the button is the same for every shop (founder, 24 Nov: no founding price any more).
it("names 69 € instead of 49 € per location and month", () => {
  expect(BOOKING_PRICE_LINE).toBe("69 € statt 49 € je Standort und Monat, nur für Standorte mit Termin\u00a0+\u00a0Treue.");
});
