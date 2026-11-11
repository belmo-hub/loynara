import { describe, expect, it } from "vitest";
import { weekLine } from "./week-line";

describe("the owner's weekly line (ENG-210, Marketing's forms of 10 Nov)", () => {
  const week = (bookings: number, returning: number, newCards: number) => weekLine({ from: "2026-11-09", bookings, returning, newCards });
  it("says the three numbers", () => {
    expect(week(12, 8, 3)).toBe("Diese Woche: 12\u00a0Buchungen, 8\u00a0davon von Karten mit früherer Buchung, und 3\u00a0neue Karten.");
    expect(week(1, 0, 1)).toBe("Diese Woche: 1\u00a0Buchung, die erste ihrer Karte, und 1\u00a0neue Karte.");
  });
  it("has every singular, zero and all form", () => {
    expect(week(0, 0, 0)).toBe("Diese Woche gab es noch keine Buchung und keine neue Karte.");
    expect(week(0, 0, 1)).toBe("Diese Woche gab es noch keine Buchung, aber 1\u00a0neue Karte.");
    expect(week(0, 0, 2)).toBe("Diese Woche gab es noch keine Buchung, aber 2\u00a0neue Karten.");
    expect(week(1, 1, 0)).toBe("Diese Woche: 1\u00a0Buchung, von einer Karte mit früherer Buchung, und keine neue Karte.");
    expect(week(3, 0, 3)).toBe("Diese Woche: 3\u00a0Buchungen, alle davon erste Buchungen ihrer Karte, und 3\u00a0neue Karten.");
    expect(week(3, 1, 0)).toBe("Diese Woche: 3\u00a0Buchungen, 1\u00a0davon von einer Karte mit früherer Buchung, und keine neue Karte.");
    expect(week(4, 4, 1)).toBe("Diese Woche: 4\u00a0Buchungen, alle von Karten mit früherer Buchung, und 1\u00a0neue Karte.");
    expect(week(1200, 1000, 0)).toContain("1.200\u00a0Buchungen, 1.000\u00a0davon von Karten");
  });
});
