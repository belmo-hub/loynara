import { describe, expect, it } from "vitest";
import { draftRules, minimumSpendText, NO_MIN_SPEND_LABEL, noMinSpendNote, otherRewardsHint, ruleKind } from "./program-helpers";

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
    ["stamp", "manual", "Pro bestätigtem Besuch vergibt das Team Stempel an der Kasse."],
    ["points", "manual", "Das Team vergibt Punkte an der Kasse."],
    ["points", "purchase", ""], // the card states the earning itself; the field is for extra rules (W51)
  ] as const)("%s, %s: the earning as before, no reward sentence", (type, mode, sentence) => {
    expect(draftRules(type, mode)).toBe(sentence);
  });
});

describe("the rules field (W35, W51)", () => {
  it("is the owner's own rule for stamps and manual points, extra rules by purchase amount", () => {
    expect([ruleKind("stamp", "manual"), ruleKind("stamp", "purchase"), ruleKind("points", "manual"), ruleKind("points", "purchase")]).toEqual(["stamp", "stamp", "manual", "purchase"]);
  });
});
