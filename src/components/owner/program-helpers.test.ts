import { describe, expect, it } from "vitest";
import { draftRules, NO_MIN_SPEND_LABEL, noMinSpendNote } from "./program-helpers";

describe("the open-minimum-spend note", () => {
  it("is shown for points programmes only, never for stamps", () => {
    expect(noMinSpendNote("points")).toBe(NO_MIN_SPEND_LABEL);
    expect(noMinSpendNote("stamp")).toBeNull();
  });
});

describe("the setup's rules draft", () => {
  it.each([
    ["stamp", "manual", 1, "Pro bestätigtem Besuch vergibt das Team Stempel an der Kasse."],
    ["points", "manual", 1, "Das Team vergibt Punkte an der Kasse."],
    ["points", "purchase", 1, "Pro 1 € Einkaufswert gibt es 1 Punkt, abgerundet. Das Team bestätigt jede Buchung an der Kasse."],
    ["points", "purchase", 3, "Pro 1 € Einkaufswert gibt es 3 Punkte, abgerundet. Das Team bestätigt jede Buchung an der Kasse."],
  ] as const)("%s, %s, rate %i: the earning sentence as before and no reward sentence", (type, mode, rate, sentence) => {
    expect(draftRules(type, mode, rate)).toBe(sentence);
  });
});
