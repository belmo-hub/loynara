import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/components/client-api";
import type { LocationAnalytics } from "@/lib/merchant-analytics";

const state = vi.hoisted(() => ({ me: null as MeResponse | null, locations: [] as Array<{ id: string }>, analytics: null as LocationAnalytics | null, urls: [] as string[] }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ me: state.me, locations: state.locations }) }));
vi.mock("./use-load", () => ({
  useLoad: (url: string | null) => {
    if (url) state.urls.push(url);
    return [url?.startsWith("/api/merchant/analytics/location") && state.analytics ? { state: "ok", data: state.analytics, at: 0 } : { state: "loading" }, () => {}];
  },
}));

import { Overview } from "./overview";

const counts = { newCards: 4, qualifyingCheckouts: 12, repeatCards: 3 };
const report = (previous: LocationAnalytics["previous"]): LocationAnalytics => ({ locationId: "loc-2", windowDays: 30, from: "2026-09-24T10:00:00.000Z", asOf: "2026-10-24T10:00:00.000Z", current: counts, previous, winback: null });
const me = (role: "owner" | "manager"): MeResponse => ({
  userId: "u", tenantId: "t", locationId: "loc-2", role, businessName: "Café", locationName: "Kassel Süd", publicBaseUrl: "http://localhost:3000",
  programSlug: "cafe", programType: "stamp", rewardTitle: "Kaffee", rewardCost: 8, stats: { members: 9, awards: 30, redemptions: 2 }, activity: [],
});
const render = () => renderToStaticMarkup(createElement(Overview));

describe("one Übersicht for every owner and manager (L1, O7)", () => {
  beforeEach(() => { state.urls = []; state.locations = [{ id: "loc-1" }, { id: "loc-2" }]; state.analytics = report(null); });

  it("shows this location's last 30 days for a multi-location owner, without the lifetime grid", () => {
    state.me = me("owner");
    const html = render();
    expect(state.urls).toContain("/api/merchant/analytics/location?locationId=loc-2");
    expect(state.urls.some(url => url.startsWith("/api/merchant/analytics?"))).toBe(false);
    expect(html).toContain("In den letzten 30 Tagen.");
    expect(html).toContain("Alle Zahlen und Zeiträume");
    expect(html).toContain("Stammkunden");
    expect(html).not.toContain("seit Programmstart");
    expect(html).not.toContain("kein Umsatz");
    expect(html).not.toContain("vorher");
  });

  it("gives a manager the same layout without the owner-only Ergebnisse link", () => {
    state.me = me("manager");
    state.locations = [{ id: "loc-2" }];
    const html = render();
    expect(html).toContain("In den letzten 30 Tagen.");
    expect(html).toContain("Stammkunden");
    expect(html).not.toContain("Alle Zahlen und Zeiträume");
  });

  it("adds the previous 30 days as a plain number once there is a full previous period", () => {
    state.me = me("owner");
    state.analytics = report({ newCards: 1, qualifyingCheckouts: 9, repeatCards: 3 });
    const html = render();
    expect(html).toContain("erstmals angemeldet · vorher 1");
    expect(html).toContain("bestätigt an deiner Kasse · vorher 9");
    expect(html).toContain("Karten mit 2+ Buchungen · vorher 3");
    expect(html.match(/<dl class="ow-metrics[\s\S]*?<\/dl>/)![0]).not.toContain("%");
  });
});
