import { describe, expect, it } from "vitest";
import { bonusRange } from "./winback-card";

describe("win-back bonus range", () => {
  it("reads „1 Punkt“ when one point is the most, never „1 bis 1 Punkte“", () => {
    expect(bonusRange(1)).toBe("1 Punkt");
    expect(bonusRange(2)).toBe("1 bis 2 Punkte");
    expect(bonusRange(25)).toBe("1 bis 25 Punkte");
  });
});
