import { describe, expect, it } from "vitest";
import { draftRules, minimumSpendText, NO_MIN_SPEND_LABEL, noMinSpendNote, otherRewardsHint } from "./program-helpers";

describe("the spend that earns a new points reward (Marketing B)", () => {
  it("rounds up to the cent and shows cents only when there are any", () => {
    expect(minimumSpendText(500, 1, "EUR")).toBe("Erreichbar ab insgesamt 500 € Einkaufswert.");
    expect(minimumSpendText(250, 3, "EUR")).toBe("Erreichbar ab insgesamt 83,34 € Einkaufswert."); // 83,33 € earns only 249
    expect(minimumSpendText(1500, 1, "EUR")).toBe("Erreichbar ab insgesamt 1.500 € Einkaufswert.");
  });
  it("writes dirham the way the earning sentence does", () => {
    expect(minimumSpendText(100, 2, "MAD")).toBe("Erreichbar ab insgesamt 50 MAD Einkaufswert.");
  });
});

describe("the other rewards under a new reward's number (W12)", () => {
  it("follows the count: none, one, two, three or more, lowest first", () => {
    expect(otherRewardsHint("stamp", [])).toBeNull();
    expect(otherRewardsHint("stamp", [10])).toBe("Deine andere Prämie: 10 Stempel.");
    expect(otherRewardsHint("stamp", [14, 10])).toBe("Deine anderen Prämien: 10 und 14 Stempel.");
    expect(otherRewardsHint("stamp", [20, 10, 14])).toBe("Deine anderen Prämien: 10, 14 und 20 Stempel.");
    expect(otherRewardsHint("stamp", [20, 10, 20])).toBe("Deine anderen Prämien: 10 und 20 Stempel."); // each number once
    expect(otherRewardsHint("stamp", [20, 20])).toBe("Deine anderen Prämien: 20 Stempel.");
  });
  it("says Punkte for points shops, „1 Punkt“ alone, and groups thousands", () => {
    expect(otherRewardsHint("points", [1])).toBe("Deine andere Prämie: 1 Punkt.");
    expect(otherRewardsHint("points", [1, 5])).toBe("Deine anderen Prämien: 1 und 5 Punkte."); // the unit follows the highest number
    expect(otherRewardsHint("points", [1000, 250])).toBe("Deine anderen Prämien: 250 und 1.000 Punkte.");
  });
});

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
