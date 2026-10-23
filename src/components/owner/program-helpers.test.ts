import { describe, expect, it } from "vitest";
import { NO_MIN_SPEND_LABEL, noMinSpendNote } from "./program-helpers";

describe("the open-minimum-spend note", () => {
  it("is shown for points programmes only, never for stamps", () => {
    expect(noMinSpendNote("points")).toBe(NO_MIN_SPEND_LABEL);
    expect(noMinSpendNote("stamp")).toBeNull();
  });
});
