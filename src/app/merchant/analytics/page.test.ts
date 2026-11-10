import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => {
  const row = (name: string, awardActions: number, pointUnits: number) => ({ name, awardActions, stampUnits: 0, pointUnits });
  const DAY = 86_400_000, from = Date.parse("2026-09-28T15:00:00Z");
  // The read's buckets: four full weeks from the period's start, then the two days left over.
  const week = (index: number, checkouts: number, days = 7) => ({ from: new Date(from + index * 7 * DAY).toISOString(), to: new Date(from + (index * 7 + days) * DAY).toISOString(), newCards: 0, checkouts });
  const report = {
    windowDays: 30, from: "2026-09-28T15:00:00Z", asOf: "2026-10-28T15:00:00Z", timezone: "Europe/Berlin",
    currentActiveCards: 3, newCards: 1, qualifyingCheckouts: 3, participatingCards: 2, repeatCards: 1, wonBack: 0,
    issued: { stampUnits: 0, pointUnits: 3, awardActions: 3 }, rewards: { redemptions: 0, topTitles: [] as Array<{ title: string; count: number }> }, referrals: { attributed: 0, qualified: 0, reversed: 0 },
    campaignAttempts: { total: 0, complete: 0, suppressed: 0, retry: 0, failed: 0, blocked: 0 },
    locationActivity: [{ locationId: "l1", ...row("Kassel", 1, 1) }, { locationId: "l2", ...row("Mitte", 2, 2) }],
    staffActivity: [{ userId: "u1", ...row("Aylin", 1, 1) }, { userId: "u2", ...row("Ben", 2, 2) }],
    series: [week(0, 9), week(1, 11), week(2, 13), week(3, 15), week(4, 30, 2)], countingRule: "Gezählt werden bestätigte Buchungen.", limits: { availableWindowsDays: [30, 90], bucketDays: 7, topRewardTitles: 5 },
  };
  const retention = { inactiveDays: 30, locationId: null, openCards: 12, recent: 5, drifting: 5, driftingWeekAgo: 4, never: 0, neverAfterWeek: 0, rewardReady: 1, nearReward: 3, nearRewardMaxRemaining: 1, nearRewardId: null, programCount: 1 };
  return { report, retention, week };
});
vi.mock("@/components/owner/owner-context", () => ({ useOwner: () => ({ me: { role: "owner", programType: "points" }, locations: [] }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock("@/components/owner/use-load", () => ({
  useLoad: (url: string | null) => [url?.startsWith("/api/merchant/analytics") ? { state: "ok", data: data.report, at: 0 }
    : url?.startsWith("/api/merchant/retention") ? { state: "ok", data: data.retention, at: 0 } : { state: "loading" }, () => {}],
}));

import MerchantAnalyticsPage from "./page";

const render = () => renderToStaticMarkup(createElement(MerchantAnalyticsPage));
const rowOf = (html: string, title: string) => html.match(new RegExp(`<li><(?:a|div) class="ow-prog-row"[^>]*>(?:(?!</li>).)*<strong>${title}</strong>(?:(?!</li>).)*</li>`))?.[0] ?? "";

describe("Ergebnisse as Wegweiser rows (ENG-122b)", () => {
  it("draws the full weeks and the week still running, labels each with its first day and lights the latest full one", () => {
    const html = render();
    // ENG-203: four full weeks, then the running week as an outline („bis heute“), so the bars hold today's bookings
    // like the number above them. The cut first week still gets no bar.
    expect(html.match(/class="ow-strip-day"/g)).toHaveLength(5);
    expect(html.match(/data-today=""/g)).toHaveLength(1);
    expect(html).toContain("19.10. bis 26.10. 15 Buchungen, 26.10. bis heute 30 Buchungen");
    expect(html).toContain(">bis heute</span>");
    expect(html).toContain("Bestätigte Buchungen je Woche: 28.09. bis 05.10. 9 Buchungen, 05.10. bis 12.10. 11 Buchungen, 12.10. bis 19.10. 13 Buchungen, 19.10. bis 26.10. 15 Buchungen");
    expect(html.match(/data-lit=""/g)).toHaveLength(1);
    expect(html).toMatch(/data-lit=""[^>]*><\/span><span class="ow-strip-d" data-yesterday="">19\.10\.<\/span>/);
    expect(html).toContain("Die meisten Buchungen gab es letzte Woche.");
  });

  it("says the latest week was best only when it had more bookings than every other week", () => {
    const series = data.report.series;
    data.report.series = [data.week(0, 9), data.week(1, 15), data.week(2, 13), data.week(3, 15), data.week(4, 1, 2)];
    try { expect(render()).not.toContain("Die meisten Buchungen"); } finally { data.report.series = series; }
  });

  it("shows each person's and each location's confirmed bookings as the row's number", () => {
    const html = render();
    for (const [name, n] of [["Aylin", 1], ["Ben", 2], ["Kassel", 1], ["Mitte", 2]] as const) {
      expect(rowOf(html, name)).toContain(`<span class="ow-prog-value" data-big="true">${n}</span>`);
      expect(rowOf(html, name)).toContain("<small>Bestätigte Buchungen im Zeitraum</small>");
    }
  });

  it("links a group of today's cards to Kunden only while it has cards", () => {
    const html = render();
    expect(rowOf(html, "Länger nicht da")).toMatch(/^<li><a class="ow-prog-row" href="\/merchant\/customers\?activity=drifting&amp;days=30&amp;scope=all">/);
    expect(rowOf(html, "Länger nicht da")).toContain("<small>Vor einer Woche: 4.</small>");
    expect(rowOf(html, "Noch nie an der Kasse")).toMatch(/^<li><div class="ow-prog-row">/);
  });

  it("leads back to the Aktionen list", () => {
    expect(render()).toContain('<a class="ow-back" href="/merchant/actions">');
  });

  it("keeps the live empty sentences", () => {
    const staff = data.report.staffActivity;
    data.report.staffActivity = [];
    try {
      const html = render();
      expect(html).toContain("Im Zeitraum wurde keine Prämie eingelöst.");
      expect(html).toContain("Keine Buchungen in diesem Zeitraum. Wähle oben einen längeren Zeitraum.");
    } finally { data.report.staffActivity = staff; }
  });
});
