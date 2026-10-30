import { describe, expect, it } from "vitest";
import { rewardChangeLine } from "./change-lines";

describe("card lines for a reward change waiting for its date (W31, W49)", () => {
  const coffee = { title: "Gratiskaffee", cost: 10 };
  it.each([
    [{ effectiveOn: "2026-11-24", title: "Gratiskaffee", cost: 12 }, "Ab 24.11. gibt es Gratiskaffee für 12 Stempel. Bis dahin reichen 10."],
    [{ endsOn: "2026-11-24" }, "Ab 24.11. gibt es Gratiskaffee nicht mehr. Bis dahin kannst du die Prämie noch einlösen."],
    [{ effectiveOn: "2026-11-24", title: "Gratiskaffee 0,2 l", cost: 10 }, "Ab 24.11. gibt es „Gratiskaffee 0,2 l“ statt „Gratiskaffee“. Bis dahin bleibt es bei der bisherigen Prämie."],
    [{ effectiveOn: "2026-11-24", title: "Gratiskaffee 0,2 l", cost: 12 }, "Ab 24.11. gibt es „Gratiskaffee 0,2 l“ für 12 Stempel statt „Gratiskaffee“ für 10. Bis dahin bleibt es bei der bisherigen Prämie."],
  ])("%o", (change, line) => expect(rewardChangeLine("stamps", coffee, change)).toBe(line));

  it("says „reicht 1“ and counts points", () => {
    expect(rewardChangeLine("stamps", { title: "Keks", cost: 1 }, { effectiveOn: "2026-01-05", title: "Keks", cost: 2 })).toBe("Ab 5.1. gibt es Keks für 2 Stempel. Bis dahin reicht 1.");
    expect(rewardChangeLine("points", { title: "Pizza", cost: 250 }, { effectiveOn: "2026-11-24", title: "Pizza", cost: 300 })).toBe("Ab 24.11. gibt es Pizza für 300 Punkte. Bis dahin reichen 250.");
  });
});
