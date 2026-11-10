import { describe, expect, it } from "vitest";
import { weekLine } from "./week-line";

describe("the owner's weekly line", () => {
  const week = (bookings: number, returning: number, newCards: number) => weekLine({ from: "2026-11-09", bookings, returning, newCards });
  it("says the three numbers", () => {
    expect(week(12, 8, 3)).toBe("Diese Woche: 12 Buchungen, 8 davon von Karten, die schon einmal da waren. 3 neue Karten.");
  });
  it("has singular, zero and all-returning forms", () => {
    expect(week(1, 0, 1)).toBe("Diese Woche: 1 Buchung. 1 neue Karte.");
    expect(week(1, 1, 0)).toBe("Diese Woche: 1 Buchung, von einer Karte, die schon einmal da war.");
    expect(week(4, 4, 0)).toBe("Diese Woche: 4 Buchungen, alle von Karten, die schon einmal da waren.");
    expect(week(0, 0, 0)).toBe("Diese Woche gab es noch keine Buchung.");
    expect(week(0, 0, 2)).toBe("Diese Woche gab es noch keine Buchung. 2 neue Karten.");
    expect(week(1200, 1000, 0)).toContain("1.200 Buchungen, 1.000 davon");
  });
});
