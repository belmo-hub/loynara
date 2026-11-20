import { describe, expect, it } from "vitest";
import { thumbFill } from "./points-thumb";

describe("the points thumbnail's fill (Design ENG-292 §4.1, 20 Nov)", () => {
  it("rounds to whole pixels, shows any balance, and fills fully only once reached", () => {
    expect([0, 1, 21, 150, 299, 300, 420].map(b => thumbFill(b, 300))).toEqual([0, 1, 3, 18, 35, 36, 36]);
  });
});
