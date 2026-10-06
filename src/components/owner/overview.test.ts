import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/components/client-api";

const state = vi.hoisted(() => ({ me: null as MeResponse | null }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ me: state.me, locations: [] }) }));

import { Overview } from "./overview";
import { germanDate } from "./owner-ui";
import { buildInsights } from "./retention-insights";
import { RETENTION_RULES, type RetentionSummary } from "@/lib/retention";

function renderActivity(activity: NonNullable<MeResponse["activity"]>) {
  state.me = {
    userId: "owner", tenantId: "tenant", locationId: "location", role: "owner",
    businessName: "Test Café", locationName: "Berlin", publicBaseUrl: "http://localhost:3000",
    programSlug: "test-cafe", programType: "stamp", rewardTitle: "Kaffee", rewardCost: 5,
    stats: { members: 1, awards: 1, redemptions: 0 }, activity,
  };
  const html = renderToStaticMarkup(createElement(Overview));
  return html.match(/<time(?: [^>]*)?>.*?<\/time>/g) ?? [];
}

describe("Overview activity date contract", () => {
  it.each(["1.10.2026, 18:14:46", "13.10.2026, 18:14:46"])(
    "renders the server's German display text %s without locale reparsing",
    occurredAt => {
      expect(renderActivity([{ id: "entry", kind: "award", occurredAt, amount: 1 }]))
        .toEqual([`<time>${occurredAt}</time>`]);
    },
  );

  it("keeps the merchant's displayed date/time even when its raw timestamp is on the previous UTC day", () => {
    expect(renderActivity([{
      id: "entry", kind: "award", occurredAt: "2.10.2026, 00:14:46", createdAt: "2026-10-01T22:14:46.000Z",
    }])).toEqual(['<time dateTime="2026-10-01T22:14:46.000Z">2.10.2026, 00:14:46</time>']);
  });

  it("formats a raw timestamp when no display text is supplied", () => {
    expect(renderActivity([{ id: "entry", kind: "award", createdAt: "2026-10-13T18:14:46" }]))
      .toEqual(['<time dateTime="2026-10-13T18:14:46">13.10., 18:14</time>']);
  });
});

describe("germanDate raw timestamp fallback", () => {
  it.each([
    ["2026-10-01T18:14:46", "01.10., 18:14"],
    ["2026-10-13T18:14:46", "13.10., 18:14"],
  ])("formats %s", (timestamp, expected) => {
    expect(germanDate(timestamp, true)).toBe(expected);
  });
});

describe("Overview programme call to action follows the role", () => {
  const render = (role: "owner" | "manager" | "cashier") => {
    state.me = {
      userId: "u", tenantId: "tenant", locationId: "location", role,
      businessName: "Test Café", locationName: "Berlin", publicBaseUrl: "http://localhost:3000",
      programSlug: "test-cafe", programType: "stamp", rewardTitle: "Kaffee", rewardCost: 5,
      stats: { members: 1, awards: 1, redemptions: 0 }, activity: [],
    };
    return renderToStaticMarkup(createElement(Overview));
  };
  it("offers the owner an edit action", () => {
    const html = render("owner");
    expect(html).toContain("Programm bearbeiten");
    expect(html).not.toContain("Programm ansehen");
  });
  it("does not promise a manager an edit action on the read-only programme page", () => {
    const html = render("manager");
    expect(html).not.toContain("Programm bearbeiten");
    expect(html).toContain("Programm ansehen");
  });
});

describe("Overview retention card follows the withheld surfaces", () => {
  const render = (hiddenSurfaces?: Array<"billing" | "campaigns" | "automations" | "audiences">) => {
    state.me = {
      userId: "u", tenantId: "tenant", locationId: "location", role: "owner",
      businessName: "Test Café", locationName: "Berlin", publicBaseUrl: "http://localhost:3000",
      programSlug: "test-cafe", programType: "stamp", rewardTitle: "Kaffee", rewardCost: 5,
      stats: { members: 1, awards: 1, redemptions: 0 }, activity: [], hiddenSurfaces,
    };
    return renderToStaticMarkup(createElement(Overview));
  };
  it("is shown where campaigns exist", () => { expect(render()).toContain("Was jetzt zählt"); });
  it("stays visible in pilot production, without campaign or audience links", () => {
    const html = render(["billing", "campaigns", "automations", "audiences"]);
    expect(html).toContain("Was jetzt zählt");
    expect(html).not.toContain("/merchant/campaigns");
    expect(html).not.toContain("/merchant/audiences");
  });
});

describe("buildInsights", () => {
  const summary: RetentionSummary = { asOf: "2030-01-01T00:00:00.000Z", inactiveDays: 30, locationId: null, openCards: 20, recent: 10, drifting: 6, never: 4,
    neverAfterWeek: 3, nearReward: 2, rewardReady: 1, driftingWeekAgo: 4, nearRewardMaxRemaining: 2, nearRewardId: "22222222-2222-4222-8222-222222222222", programCount: 1, rules: RETENTION_RULES };
  const hrefs = (items: ReturnType<typeof buildInsights>) => items.flatMap(item => item.actions.map(action => action.href));

  it("turns each observation into a real destination and orders actionable items first", () => {
    const items = buildInsights({ summary, unit: "Stempel", isOwner: true, campaigns: true, referrals: [{ status: "review" }, { status: "pending" }, { status: "qualified" }] });
    expect(items.map(item => item.id)).toEqual(["referral-review", "reward-ready", "drifting", "near-reward", "never", "referral-waiting"]);
    expect(hrefs(items)).toContain("/merchant/campaigns?goal=winback&days=30");
    expect(hrefs(items)).toContain("/merchant/customers?activity=drifting&days=30&scope=all");
    expect(items.find(item => item.id === "drifting")?.why).toContain("Vor einer Woche waren es 4.");
    expect(items.find(item => item.id === "reward-ready")?.title).toBe("1 Karte kann jetzt eine Prämie einlösen");
  });

  it("preserves the exact age and location scope of customer insight counts", () => {
    const items = buildInsights({ summary: { ...summary, locationId: "11111111-1111-4111-8111-111111111111" }, unit: "Stempel", isOwner: true, campaigns: true, referrals: null });
    const never = new URL(items.find(item => item.id === "never")!.actions[0].href, "http://localhost");
    expect(never.searchParams.get("minAgeDays")).toBe("7");
    expect(never.searchParams.get("locationId")).toBe("11111111-1111-4111-8111-111111111111");
    const all = new URL(buildInsights({ summary, unit: "Stempel", isOwner: true, campaigns: false, referrals: null })[0].actions[0].href, "http://localhost");
    expect(all.searchParams.get("scope")).toBe("all");
  });

  it("carries the cheapest reward and avoids program-specific drafts for multiple programs", () => {
    const items = buildInsights({ summary, unit: "Stempel", isOwner: true, campaigns: true, referrals: null });
    const reminder = items.find(item => item.id === "near-reward")!.actions.find(action => action.href.includes("campaigns"))!;
    expect(new URL(reminder.href, "http://localhost").searchParams.get("rewardId")).toBe("22222222-2222-4222-8222-222222222222");
    const many = buildInsights({ summary: { ...summary, programCount: 2 }, unit: "Stempel", isOwner: true, campaigns: true, referrals: null });
    expect(hrefs(many).some(href => href.includes("campaigns"))).toBe(false);
  });

  it("never links to campaigns where they are withheld or for managers", () => {
    expect(hrefs(buildInsights({ summary, unit: "Stempel", isOwner: true, campaigns: false, referrals: null })).some(href => href.includes("campaigns"))).toBe(false);
    expect(hrefs(buildInsights({ summary, unit: "Stempel", isOwner: false, campaigns: true, referrals: null })).some(href => href.includes("campaigns"))).toBe(false);
  });

  it("says nothing when the data shows nothing", () => {
    const quiet = { ...summary, drifting: 0, neverAfterWeek: 0, nearReward: 0, rewardReady: 0 };
    expect(buildInsights({ summary: quiet, unit: "Stempel", isOwner: true, campaigns: true, referrals: [{ status: "qualified" }] })).toEqual([]);
  });
});
