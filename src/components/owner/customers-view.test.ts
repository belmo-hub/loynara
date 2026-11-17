import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Gift } from "lucide-react";
import { describe, expect, it } from "vitest";
import { StampGrid } from "@/components/ui/stamp-grid";
import { RETENTION_RULES, type RetentionSummary } from "@/lib/retention";
import { progressLine } from "@/components/customer/mix-card";
import { dayLabel } from "./card-screen";
import { groupTiles, searchHref } from "./customers-view";

const summary = (patch: Partial<RetentionSummary> = {}): RetentionSummary => ({ asOf: "", inactiveDays: 30, locationId: "loc-1", openCards: 20, recent: 12, drifting: 5, never: 2, neverAfterWeek: 1,
  nearReward: 3, rewardReady: 1, driftingWeekAgo: 4, nearRewardMaxRemaining: 3, nearRewardId: null, programCount: 1, rules: RETENTION_RULES, ...patch });

describe("Kunden 01: the groups (ENG-122a)", () => {
  it("shows the read's counts, R1's sub-lines with its days, the live rules for the sheet, and links to each group", () => {
    const tiles = groupTiles(summary({ inactiveDays: 60 }), "Stempeln");
    expect(tiles.map(tile => [tile.label, tile.value, tile.note ?? ""])).toEqual([
      ["Alle Karten", "20", ""], ["Kürzlich aktiv", "12", "Buchung in den letzten 60 Tagen"], ["Länger nicht da", "5", "Seit 60 Tagen keine Buchung mehr"],
      ["Noch nie an der Kasse", "2", "Angemeldet, noch keine Buchung"], ["Kurz vor Prämie", "3", "Höchstens ein Viertel bis zur Prämie"], ["Prämie verdient", "1", "Stand reicht für eine Prämie"],
    ]);
    expect(tiles.every(tile => String(tile.note ?? "").length <= 40)).toBe(true); // Marketing's limit
    expect(tiles[0].help).toBe(""); // „Alle Karten“ has no rule, so the sheet leaves it out
    expect(tiles[2].help).toBe("Früher bestätigte Buchungen, aber keine in den letzten 60 Tagen. Warum, wissen wir nicht. Geschlossene Karten zählen nicht.");
    expect(tiles.map(tile => tile.href)).toEqual([
      "/merchant/customers?activity=all&status=active&locationId=loc-1", "/merchant/customers?activity=recent&days=60&locationId=loc-1", "/merchant/customers?activity=drifting&days=60&locationId=loc-1",
      "/merchant/customers?activity=never&locationId=loc-1", "/merchant/customers?activity=near_reward&locationId=loc-1", "/merchant/customers?activity=reward_ready&locationId=loc-1",
    ]);
  });
});

describe("Kunden 03: the card's „Aktueller Stand“ (ENG-122a)", () => {
  it("says what is missing to the reward in quotes (R4), in the singular for one, and when the balance reaches it", () => {
    const coffee = { title: "Gratiskaffee", cost: 10 };
    expect(progressLine(7, coffee, "stamp")).toBe("Noch 3 Stempel bis „Gratiskaffee“.");
    expect(progressLine(9, coffee, "stamp")).toBe("Noch 1 Stempel bis „Gratiskaffee“.");
    expect(progressLine(21, { title: "Pizza", cost: 100 }, "points")).toBe("Noch 79 Punkte bis „Pizza“.");
    expect(progressLine(99, { title: "Pizza", cost: 100 }, "points")).toBe("Noch 1 Punkt bis „Pizza“.");
    expect(progressLine(12, coffee, "stamp")).toBe("Stand reicht für „Gratiskaffee“.");
  });

  it("draws the reward slot in an ink ring until it is earned; then it is a coral stamp like the others", () => {
    const grid = (earned: number) => renderToStaticMarkup(createElement(StampGrid, { earned, total: 4, reward: createElement(Gift) }));
    expect(grid(2).match(/data-earned="true"/g)).toHaveLength(2);
    expect(grid(2).match(/data-reward="true"/g)).toHaveLength(1);
    expect(grid(2)).toMatch(/data-reward="true"[^>]*><svg[^>]*lucide-gift/);
    expect(grid(4)).not.toContain("data-reward");
    expect(renderToStaticMarkup(createElement(StampGrid, { earned: 2, total: 4 }))).not.toContain("data-reward"); // the guest's card and the Kasse
  });
});

describe("card search (ENG-179, fault 18)", () => {
  it("searches every location for an owner and leaves a manager's scope to the server", () => {
    expect(searchHref(" K-39BVGN ", "owner")).toBe("/merchant/customers?q=K-39BVGN&scope=all");
    expect(searchHref("K-39BVGN", "manager")).toBe("/merchant/customers?q=K-39BVGN");
    expect(searchHref("  ", "owner")).toBe("/merchant/customers");
  });
});

describe("Kunden 03: the statement's day (ENG-258)", () => {
  it("names today and yesterday, otherwise the weekday and date", () => {
    const now = new Date(2026, 10, 14, 18, 0);
    expect(dayLabel(new Date(2026, 10, 14, 8, 41).toISOString(), now)).toBe("Heute");
    expect(dayLabel(new Date(2026, 10, 13, 23, 59).toISOString(), now)).toBe("Gestern");
    expect(dayLabel(new Date(2026, 10, 12, 8, 41).toISOString(), now)).toBe("Donnerstag, 12.11.");
  });
});
