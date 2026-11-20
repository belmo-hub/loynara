import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Gift } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { StampGrid } from "@/components/ui/stamp-grid";
import { RETENTION_RULES, type RetentionSummary } from "@/lib/retention";
import { progressLine } from "@/components/customer/mix-card";
import { dayLabel, mixCardReward } from "./card-screen";
import { cardLead, CustomersView, groupCount, groupTiles, searchHref } from "./customers-view";

let address = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => address, useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ me: { role: "owner", programType: "stamp", programSlug: "cafe", locationId: "loc-1", locationName: "Laden", publicBaseUrl: "https://example.test" }, locations: [] }) }));
vi.mock("./use-load", () => ({ useLoad: (url: string | null) => [
  !url ? { state: "idle" } : url.startsWith("/api/merchant/retention") ? { state: "ok", data: summary(), at: 0 }
    : url.startsWith("/api/merchant/customers") ? { state: "ok", data: { members: [], nextCursor: null }, at: 0 } : { state: "ok", data: { rewards: [] }, at: 0 },
  () => {}] }));

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

describe("Kunden rows in the mix (ENG-257)", () => {
  const render = (node: ReturnType<typeof cardLead>) => renderToStaticMarkup(createElement("div", null, node));
  const coffee = { id: "r", title: "Gratiskaffee", cost: 8 };
  it("leads a stamp card with the mix thumbnail", () => {
    expect(render(cardLead({ programType: "stamp", balance: 5 }, coffee))).toContain('role="img"');
    expect(render(cardLead({ programType: "stamp", balance: 5 }))).toContain('aria-hidden="true"'); // the shop's colour, no dots
  });
  it.each([[0, 0, false], [21, 3, false], [150, 18, false], [300, 36, true], [420, 36, true]])("leads a points card at %i with a %i px fill to the dearest reward (ENG-292 §4)", (balance, px, reached) => {
    const html = render(cardLead({ programType: "points", balance }, { id: "r", title: "Pizza", cost: 60 }, 300));
    expect(html).toContain(`aria-label="${balance} Punkte"`);
    expect(html).toContain(`style="width:${px ? `${px}px` : 0}"`);
    expect(html.includes("data-on")).toBe(reached);
    expect(render(cardLead({ programType: "points", balance }))).toContain('aria-hidden="true"'); // no target here: the shop's colour alone
  });
});

describe("the number beside a group's title (Design, #283)", () => {
  it("is the read's total, not the 25 rows a list with a next page has loaded; with closed cards in the list there is none", () => {
    const big = summary({ openCards: 60, recent: 40, never: 30, neverAfterWeek: 12 }); // every group longer than one page of 25
    expect(groupCount(big, { activity: "all", status: "active", minAgeDays: 0 })).toBe("60");
    expect(groupCount(big, { activity: "recent", status: "all", minAgeDays: 0 })).toBe("40");
    expect(groupCount(big, { activity: "never", status: "all", minAgeDays: 7 })).toBe("12");
    expect(groupCount(big, { activity: "all", status: "all", minAgeDays: 0 })).toBeUndefined();
    expect(groupCount(big, { activity: "all", status: "closed", minAgeDays: 0 })).toBeUndefined();
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

describe("Kunden 03: the mix card only for stamps (ENG-258, Design 18 Nov)", () => {
  it("keeps a points programme on the house balance block", () => {
    const reward = { id: "r", title: "Pizza", cost: 100 };
    expect(mixCardReward("stamp", reward)).toBe(reward);
    expect(mixCardReward("points", reward)).toBeUndefined();
    expect(mixCardReward("stamp", undefined)).toBeUndefined();
  });
});

describe("Kunden's group counts and order (Design, #283 SHIP follow-up 4)", () => {
  const page = (query: string) => { address = new URLSearchParams(query); return renderToStaticMarkup(createElement(CustomersView)); };
  const groups = (html: string) => html.slice(html.indexOf('aria-labelledby="cu-groups"'), html.indexOf('aria-labelledby="cu-h"'));
  it("shows no counts in the group rows or the picker with „Alle“ or „Geschlossen“, and the read's counts with „Aktiv“", () => {
    for (const query of ["activity=all", "activity=all&status=closed"]) {
      expect(groups(page(query))).not.toContain("ow-prog-value");
      expect(groups(page(query))).toContain("<option value=\"recent\">Kürzlich aktiv</option>");
    }
    const active = groups(page("activity=all&status=active"));
    expect(active.match(/class="ow-prog-value"/g)).toHaveLength(6);
    expect(active).toContain("<option value=\"recent\">Kürzlich aktiv 12</option>");
  });
  it("puts the invite after the cards in the DOM (the grid places it under the groups from 1200)", () => {
    const html = page("activity=all&status=active");
    expect(html.indexOf("Kunden einladen")).toBeGreaterThan(html.indexOf('aria-labelledby="cu-h"'));
    expect(html.indexOf('aria-labelledby="cu-h"')).toBeGreaterThan(html.indexOf('aria-labelledby="cu-groups"'));
  });
});
