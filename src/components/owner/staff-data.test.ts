import { describe, expect, it } from "vitest";
import { cashierHint } from "./staff-data";

describe("the Kasse role hint names the programme's unit (ENG-133)", () => {
  it("stamps, points by hand, and points by purchase amount", () => {
    expect(cashierHint("stamp", "manual")).toBe("Bucht an der Kasse. Bis 10 Stempel je Buchung, sieht keine Kundenliste und keine Zahlen.");
    expect(cashierHint("points", "manual")).toBe("Bucht an der Kasse. Bis 10 Punkte je Buchung, sieht keine Kundenliste und keine Zahlen.");
    expect(cashierHint("points", "purchase")).toBe("Bucht an der Kasse, sieht keine Kundenliste und keine Zahlen.");
  });
});
