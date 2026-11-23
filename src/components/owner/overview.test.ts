import { describe, expect, it } from "vitest";
import { germanDate } from "./owner-ui";
import { buildInsights } from "./retention-insights";
import { RETENTION_RULES, type RetentionSummary } from "@/lib/retention";

describe("germanDate raw timestamp fallback", () => {
  it.each([
    // Instants, read on the shop's clock (Berlin, summer time), whatever the machine's zone (time-zone rule, 22 Nov).
    ["2026-10-01T16:14:46Z", "1.10., 18:14"],
    ["2026-10-13T16:14:46Z", "13.10., 18:14"],
  ])("formats %s", (timestamp, expected) => {
    expect(germanDate(timestamp, "feed")).toBe(expected);
  });
});

describe("buildInsights", () => {
  const summary: RetentionSummary = { asOf: "2030-01-01T00:00:00.000Z", inactiveDays: 30, locationId: null, openCards: 20, recent: 10, drifting: 6, never: 4,
    neverAfterWeek: 3, nearReward: 2, rewardReady: 1, driftingWeekAgo: 4, nearRewardMaxRemaining: 2, nearRewardId: "22222222-2222-4222-8222-222222222222", programCount: 1, rules: RETENTION_RULES };
  const hrefs = (items: ReturnType<typeof buildInsights>) => items.flatMap(item => item.actions.map(action => action.href));

  it("turns each observation into a real destination and orders actionable items first", () => {
    const items = buildInsights({ summary, isOwner: true, campaigns: true, referrals: [{ status: "review" }, { status: "pending" }, { status: "qualified" }] });
    expect(items.map(item => item.id)).toEqual(["referral-review", "reward-ready", "drifting", "near-reward", "never", "referral-waiting"]);
    expect(hrefs(items).some(href => href.includes("goal=winback"))).toBe(false); // never an unreleased e-mail campaign (O8)
    expect(hrefs(items)).toContain("/merchant/customers?activity=drifting&days=30&scope=all");
    expect(items.find(item => item.id === "reward-ready")?.title).toBe("1 Karte kann jetzt eine Prämie einlösen");
  });

  it("preserves the exact age and location scope of customer insight counts", () => {
    const items = buildInsights({ summary: { ...summary, locationId: "11111111-1111-4111-8111-111111111111" }, isOwner: true, campaigns: true, referrals: null });
    const never = new URL(items.find(item => item.id === "never")!.actions[0].href, "http://localhost");
    expect(never.searchParams.get("minAgeDays")).toBe("7");
    expect(never.searchParams.get("locationId")).toBe("11111111-1111-4111-8111-111111111111");
    const all = new URL(buildInsights({ summary, isOwner: true, campaigns: false, referrals: null })[0].actions[0].href, "http://localhost");
    expect(all.searchParams.get("scope")).toBe("all");
  });

  it("carries the cheapest reward and avoids program-specific drafts for multiple programs", () => {
    const items = buildInsights({ summary, isOwner: true, campaigns: true, referrals: null });
    const reminder = items.find(item => item.id === "near-reward")!.actions.find(action => action.href.includes("campaigns"))!;
    expect(new URL(reminder.href, "http://localhost").searchParams.get("rewardId")).toBe("22222222-2222-4222-8222-222222222222");
    const many = buildInsights({ summary: { ...summary, programCount: 2 }, isOwner: true, campaigns: true, referrals: null });
    expect(hrefs(many).some(href => href.includes("campaigns"))).toBe(false);
  });

  it("never links to campaigns where they are withheld or for managers", () => {
    expect(hrefs(buildInsights({ summary, isOwner: true, campaigns: false, referrals: null })).some(href => href.includes("campaigns"))).toBe(false);
    expect(hrefs(buildInsights({ summary, isOwner: false, campaigns: true, referrals: null })).some(href => href.includes("campaigns"))).toBe(false);
    // ENG-112: the Leitung reads the win-back counts too, but only the owner can switch the bonus on.
    const forManager = buildInsights({ summary, isOwner: false, campaigns: true, referrals: null, winback: { enabled: false, inWindow: 0 } }).find(item => item.id === "drifting")!;
    expect(forManager.actions.map(action => action.label)).toEqual(["Karten ansehen"]);
  });

  it("points drifting cards to the Wallet win-back where it is offered (O8)", () => {
    const drifting = (winback?: { enabled: boolean; inWindow: number } | null) => buildInsights({ summary, isOwner: true, campaigns: true, referrals: null, winback }).find(item => item.id === "drifting")!;
    expect(drifting(null).actions).toEqual([{ label: "Karten ansehen", href: "/merchant/customers?activity=drifting&days=30&scope=all" }]);
    expect(drifting(null).next).toBeUndefined();
    expect(drifting({ enabled: false, inWindow: 0 }).actions.at(-1)).toEqual({ label: "Willkommen-zurück-Bonus einschalten", href: "/merchant/program/winback" });
    const on = drifting({ enabled: true, inWindow: 3 });
    expect(on.next).toBe("3 Karten bekommen den Willkommen-zurück-Bonus, wenn sie rechtzeitig wiederkommen.");
    expect(on.actions.map(action => action.label)).toEqual(["Karten ansehen"]);
    expect(drifting({ enabled: true, inWindow: 1 }).next).toBe("1 Karte bekommt den Willkommen-zurück-Bonus, wenn sie rechtzeitig wiederkommt.");
    // ENG-111 (Marketing): no card in the window, no „0 Karten bekommen …“; the bar keeps its title and „Ansehen“.
    const none = drifting({ enabled: true, inWindow: 0 });
    expect(none.next).toBeUndefined();
    expect(none.actions.map(action => action.label)).toEqual(["Karten ansehen"]);
  });

  it("says nothing when the data shows nothing", () => {
    const quiet = { ...summary, drifting: 0, neverAfterWeek: 0, nearReward: 0, rewardReady: 0 };
    expect(buildInsights({ summary: quiet, isOwner: true, campaigns: true, referrals: [{ status: "qualified" }] })).toEqual([]);
  });
});
