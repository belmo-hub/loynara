import { describe, expect, it } from "vitest";
import { unitWord, withUnit } from "./units";

describe("the word after a count (ENG-108)", () => {
  it.each([
    // n, German nominative, German dative, French
    [0, "Punkte", "Punkten", "point"],
    [1, "Punkt", "Punkt", "point"],
    [2, "Punkte", "Punkten", "points"],
    [10, "Punkte", "Punkten", "points"],
  ])("points, n = %i", (n, nom, dat, fr) => {
    expect(unitWord(n, "points")).toBe(nom);
    expect(unitWord(n, "points", "de", "dat")).toBe(dat);
    expect(unitWord(n, "points", "fr")).toBe(fr);
    expect(unitWord(n, "points", "fr", "dat")).toBe(fr);
  });
  it.each([
    [0, "Stempel", "Stempeln", "tampon"],
    [1, "Stempel", "Stempel", "tampon"],
    [2, "Stempel", "Stempeln", "tampons"],
    [10, "Stempel", "Stempeln", "tampons"],
  ])("stamps, n = %i", (n, nom, dat, fr) => {
    for (const kind of ["stamp", "stamps"] as const) {
      expect(unitWord(n, kind)).toBe(nom);
      expect(unitWord(n, kind, "de", "dat")).toBe(dat);
      expect(unitWord(n, kind, "fr")).toBe(fr);
    }
  });
  it("puts the count in front, and a booking taken back by one is singular too", () => {
    expect(withUnit(1, "points")).toBe("1 Punkt");
    expect(withUnit(10, "stamps", "de", "dat")).toBe("10 Stempeln");
    expect(withUnit(0, "points", "fr")).toBe("0 point");
    expect(withUnit(-1, "points")).toBe("-1 Punkt");
    expect(withUnit(-2, "points", "fr")).toBe("-2 points");
  });
});
