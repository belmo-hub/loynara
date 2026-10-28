import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const report = vi.hoisted(() => {
  const row = (name: string, awardActions: number, pointUnits: number) => ({ name, awardActions, stampUnits: 0, pointUnits });
  return {
    windowDays: 30, from: "2026-10-01T00:00:00Z", asOf: "2026-10-27T00:00:00Z", timezone: "UTC",
    currentActiveCards: 3, newCards: 1, qualifyingCheckouts: 3, participatingCards: 2, repeatCards: 1, wonBack: 0,
    issued: { stampUnits: 0, pointUnits: 3, awardActions: 3 }, rewards: { redemptions: 0, topTitles: [] }, referrals: { attributed: 0, qualified: 0, reversed: 0 },
    campaignAttempts: { total: 0, complete: 0, suppressed: 0, retry: 0, failed: 0, blocked: 0 },
    locationActivity: [{ locationId: "l1", ...row("Kassel", 1, 1) }, { locationId: "l2", ...row("Mitte", 2, 2) }],
    staffActivity: [{ userId: "u1", ...row("Aylin", 1, 1) }, { userId: "u2", ...row("Ben", 2, 2) }],
    series: [], countingRule: "Gezählt werden bestätigte Buchungen.", limits: { availableWindowsDays: [30, 90], bucketDays: 7, topRewardTitles: 5 },
  };
});
vi.mock("@/components/owner/owner-context", () => ({ useOwner: () => ({ me: { role: "owner", programType: "points" }, locations: [] }) }));
vi.mock("@/components/owner/use-load", () => ({
  useLoad: (url: string | null) => [url?.startsWith("/api/merchant/analytics") ? { state: "ok", data: report, at: 0 } : { state: "loading" }, () => {}],
}));

import MerchantAnalyticsPage from "./page";

describe("activity per location and per person (ENG-108)", () => {
  it("counts one booking and one point in the singular", () => {
    const html = renderToStaticMarkup(createElement(MerchantAnalyticsPage));
    expect(html).toContain('<strong>Kassel</strong><span class="ow-muted"> · 1 Buchung</span></span><span class="ow-num">0 Stempel · 1 Punkt</span>');
    expect(html).toContain('<strong>Mitte</strong><span class="ow-muted"> · 2 Buchungen</span></span><span class="ow-num">0 Stempel · 2 Punkte</span>');
    expect(html).toContain('<strong>Aylin</strong><span class="ow-muted"> · 1 Buchung</span></span><span class="ow-num">0 Stempel · 1 Punkt</span>');
    expect(html).toContain('<strong>Ben</strong><span class="ow-muted"> · 2 Buchungen</span></span><span class="ow-num">0 Stempel · 2 Punkte</span>');
  });
});
