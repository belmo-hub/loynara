import { describe, expect, it } from "vitest";
import { editRequest } from "./program-rewards";

describe("editing a reward (ENG-115)", () => {
  it("sends the stored conditions back unchanged, so an edit neither erases them nor counts them as a change", () => {
    expect(editRequest({ rewardId: "r1", termsText: "Nur sonntags." }, "Sonntagstorte", 12)).toEqual({ action: "edit", rewardId: "r1", title: "Sonntagstorte", cost: 12, termsText: "Nur sonntags." });
  });
});
