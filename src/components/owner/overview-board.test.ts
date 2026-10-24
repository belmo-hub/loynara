import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/components/client-api";
import type { LocationAnalytics, MerchantSpend, SpendFigures } from "@/lib/merchant-analytics";
import type { LocationDays } from "@/lib/overview-day";
import type { LaunchReadiness } from "@/lib/readiness";
import { RETENTION_RULES, type RetentionSummary } from "@/lib/retention";

type Load = { state: "ok"; data: unknown; at: number } | { state: "loading" } | { state: "error"; message: string };
const state = vi.hoisted(() => ({ me: null as MeResponse | null, locations: [] as Array<{ id: string }>, loads: {} as Record<string, Load>, urls: [] as string[] }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ me: state.me, locations: state.locations }) }));
vi.mock("./use-load", () => ({
  useLoad: (url: string | null) => {
    if (url) state.urls.push(url);
    const key = url ? Object.keys(state.loads).find(prefix => url.startsWith(prefix)) : undefined;
    return [url === null ? { state: "idle" } : key ? state.loads[key] : { state: "loading" }, () => {}];
  },
}));

import { milestoneToShow, Overview } from "./overview";

const ok = (data: unknown): Load => ({ state: "ok", data, at: 0 });
const NBSP = " ";
const me = (patch: Partial<MeResponse> = {}): MeResponse => ({
  userId: "u", tenantId: "t", locationId: "loc-1", role: "owner", businessName: "Café Lindenblatt", locationName: "Kassel Mitte", publicBaseUrl: "http://localhost:3000",
  programSlug: "cafe", programType: "points", rewardTitle: "Kaffee", rewardCost: 100, stats: { members: 9, awards: 30, redemptions: 2 }, activity: [], ...patch,
});
/** 15 local days 20.10.–3.11.2026 ending yesterday; today is 4.11. */
const days = (counts: number[]) => counts.map((bookings, index) => ({ date: new Date(Date.UTC(2026, 9, 20 + index, 12)).toISOString().slice(0, 10), bookings }));
const dayData = (patch: Partial<LocationDays> = {}): LocationDays => ({
  timezone: "Europe/Berlin", today: "2026-11-04", days: days([1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 3]), lastBookingOn: "2026-11-03", fullTwoWeeks: true,
  diary: [
    { date: "2026-11-03", bookings: 3, units: 21, entries: [{ kind: "award", amount: 7 }, { kind: "award", amount: 7 }, { kind: "award", amount: 7 }] },
    { date: "2026-11-01", bookings: 1, units: 15, entries: [{ kind: "award", amount: 15 }, { kind: "correction", amount: 2 }, { kind: "redemption", amount: 100 }] },
  ], ...patch,
});
const analytics = (patch: Partial<LocationAnalytics & LocationDays> = {}) => ({ locationId: "loc-1", windowDays: 30, from: "", asOf: "", current: { newCards: 4, qualifyingCheckouts: 9, repeatCards: 3 }, previous: { newCards: 0, qualifyingCheckouts: 2, repeatCards: 1 }, winback: null, ...dayData(), ...patch });
const figures = (patch: Partial<SpendFigures>): SpendFigures => ({ visits: 0, spentMinor: 0, realMinor: 0, estimatedMinor: 0, unpricedVisits: 0, averagePerVisitMinor: null, newCardMinor: 0, returningCardMinor: 0, ...patch });
const spend = (recent: SpendFigures): MerchantSpend => ({ asOf: "", currency: "EUR", overall: { recent, total: recent }, locations: [] });
const retention: RetentionSummary = { asOf: "", inactiveDays: 30, locationId: "loc-1", openCards: 20, recent: 17, drifting: 1, never: 2, neverAfterWeek: 0, nearReward: 0, rewardReady: 0, driftingWeekAgo: 0, nearRewardMaxRemaining: 0, nearRewardId: null, programCount: 1, rules: RETENTION_RULES };
const readiness = (steps: Array<Partial<LaunchReadiness["steps"][number]>> = []) => ({ locationId: "loc-1", steps, next: null, requiredDone: 1, requiredTotal: 3 });
const render = () => renderToStaticMarkup(createElement(Overview));
const owned = () => {
  state.loads = {
    "/api/merchant/analytics/location": ok(analytics()),
    "/api/merchant/spend": ok(spend(figures({ visits: 17, spentMinor: 12_810, realMinor: 10_000, estimatedMinor: 2_810, unpricedVisits: 8, averagePerVisitMinor: 1_423 }))),
    "/api/merchant/retention": ok(retention), "/api/merchant/referrals": ok({ referrals: [] }), "/api/merchant/readiness": ok(readiness()),
  };
};

beforeEach(() => { state.me = me(); state.locations = [{ id: "loc-1" }, { id: "loc-2" }]; state.urls = []; owned(); });

describe("Übersicht direction D (ENG-085)", () => {
  it("normal: euros, the count they were computed from, the strip and the best-day headline; the old cards are gone", () => {
    const html = render();
    expect(html).toContain("Café Lindenblatt.");
    expect(html).toContain("Umsatz deiner Loynara-Kunden · 30 Tage");
    expect(html).toContain("128<small>,10");
    expect(html).toContain(`teilweise geschätzt aus 9${NBSP}Buchungen mit Betrag · beide Standorte`); // ENG-084: 9 priced, not 17
    expect(html).toContain(`Gestern war der beste Tag seit zwei Wochen: 3${NBSP}Buchungen am${NBSP}Tresen.`);
    expect(html).toMatch(/role="img" aria-label="Buchungen an diesem Standort · letzte 7 Tage: [^"]*gestern 3/);
    expect(html).toContain("neue Karten");
    expect(html).toContain("in 30 Tagen · vorher 0");
    expect(html).toContain(`17${NBSP}von${NBSP}20`);
    for (const gone of ["Was jetzt zählt", "Kunden einladen", "Letzte Vorgänge", "Programm bearbeiten", "Gerade nichts Dringendes", "Für Excel"]) expect(html).not.toContain(gone);
  });

  it("no average: bookings instead of euros, with the ask and „Nicht jetzt“", () => {
    state.loads["/api/merchant/spend"] = ok(spend(figures({ visits: 6, unpricedVisits: 6 })));
    const html = render();
    expect(html).toContain("Buchungen deiner Loynara-Kunden · 30 Tage");
    expect(html).toContain(`6${NBSP}<small>Buchungen</small>`);
    expect(html).toContain("Für den Umsatz in Euro fehlt nur dein Durchschnittsbon.");
    expect(html).toMatch(/class="ow-btn ow-btn--board ow-btn--sm" href="\/merchant\/program">Durchschnittsbon eintragen/);
    expect(html).toContain("Nicht jetzt");
    expect(html).not.toContain("€");
  });

  it("quiet week: rule 4, the Tresenschild next step, a grey gap in the diary; never „nichts Dringendes“", () => {
    state.loads["/api/merchant/retention"] = ok({ ...retention, drifting: 0 }); // an urgent insight would lead instead
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ ...dayData({ days: days([1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), lastBookingOn: "2026-10-24", diary: [{ date: "2026-10-24", bookings: 1, units: 1, entries: [{ kind: "award", amount: 1 }] }] }), current: { newCards: 0, qualifyingCheckouts: 0, repeatCards: 3 } }));
    const html = render();
    expect(html).toContain("Eine ruhige Woche. Die letzte Buchung war am Samstag, 24.10.");
    expect(html).toContain("Seit 11 Tagen keine Buchung.");
    expect(html).toContain("Steht das Tresenschild noch gut sichtbar an der Kasse?");
    expect(html).toContain(">Tresenschild</button>");
    expect(html).toContain("25.10.–03.11."); // the gap from the day after the last booking to yesterday, across a month
    expect(html).toContain(`1${NBSP}Punkt vergeben`);
    expect(html).toContain("keine Buchung");
    expect(html).toContain("Stammkunden"); // no new cards: the tiles show who was there and the regulars
    expect(html).not.toContain("Dringendes");
  });

  it("Leitung: their card stock and the strip, never a euro or the spend read", () => {
    state.me = me({ role: "manager" });
    const html = render();
    expect(state.urls.some(url => url.startsWith("/api/merchant/spend"))).toBe(false);
    expect(html).toContain("Kassel Mitte.");
    expect(html).toContain("Karten an deinem Standort · 30 Tage");
    expect(html).toContain("17 <small>von 20</small>");
    expect(html).toContain("Karten an deinem Standort: 17 da · 1 länger nicht da · 2 noch nie an der Kasse");
    expect(html).toContain("seit Programmstart");
    expect(html).toContain("Buchungen an diesem Standort · letzte 7 Tage");
    expect(html).not.toContain("€");
    expect(html).not.toContain("Umsatz");
  });

  it("loading: the board keeps greeting and kicker and is busy; error: one alert that keeps the counter usable", () => {
    state.loads = {};
    const loading = render();
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Umsatz deiner Loynara-Kunden · 30 Tage");
    state.loads = { "/api/merchant/analytics/location": { state: "error", message: "x" } };
    const failed = render();
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Die Zahlen sind gerade nicht da.");
    expect(failed).toContain("Buchen an der Kasse geht trotzdem.");
    expect(failed).toContain("Lädt, sobald die Verbindung wieder da ist.");
  });

  it("diary: one entry per day, corrections as their own pill, the redeemed reward marked, no timestamps", () => {
    const html = render();
    expect(html).toContain("<h3>Gestern</h3>");
    expect(html).toContain(`3${NBSP}Buchungen · 21${NBSP}Punkte vergeben`);
    expect(html).toContain("Sonntag, 01.11.");
    expect(html).toContain('data-kind="correction" aria-label="Korrektur, 2 Punkte zurückgenommen"');
    expect(html.match(/data-kind="redemption"/g)).toHaveLength(1);
    expect(html).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("milestones (spec §4.3)", () => {
  it("shows the highest card milestone reached, once per location, and never without storage", () => {
    expect(milestoneToShow(0, "", "a")).toBeNull();
    expect(milestoneToShow(1, "", "a")).toBe(1);
    expect(milestoneToShow(9, "a:1", "a")).toBeNull();
    expect(milestoneToShow(10, "a:1", "a")).toBe(10);
    expect(milestoneToShow(37, "a:1,a:10", "a")).toBe(25);
    expect(milestoneToShow(37, "a:25", "b")).toBe(25); // per location
    expect(milestoneToShow(37, "-", "a")).toBeNull();
  });
  it("is not drawn in the server render (no storage there)", () => {
    expect(render()).not.toContain("Meilenstein");
  });
});

describe("empty shop (spec §2.4)", () => {
  const steps = [
    { id: "programme", group: "setup", required: true, status: "done", title: "Programm und Prämie", evidence: "Stempelkarte · 8 Stempel → Kugel", action: { label: "Ansehen", href: "/merchant/program" } },
    { id: "enrolment", group: "verify", required: true, status: "todo", title: "Erste Karte angemeldet", evidence: "Melde dich mit dem Anmeldelink selbst an.", note: "Testkarten zählen nicht.", action: { label: "Anmeldelink öffnen", href: "/merchant/settings" } },
    { id: "nfc", group: "external", required: false, status: "external", title: "NFC am Tresen", evidence: "Wird außerhalb von Loynara eingerichtet." },
  ] as Array<Partial<LaunchReadiness["steps"][number]>>;
  beforeEach(() => { state.me = me({ stats: { members: 0, awards: 0, redemptions: 0 } }); state.loads = { "/api/merchant/readiness": ok(readiness(steps)) }; });

  it("leads with the current required step and lists the steps, never ticking what Loynara cannot check", () => {
    const html = render();
    expect(html).toContain("Willkommen bei Loynara, Café Lindenblatt.");
    expect(html).toContain("Startklar · 1 von 3 Pflichtschritten");
    expect(html).toContain("Melde die erste Karte selbst an.");
    expect(html).toContain('href="http://localhost:3000/join/cafe"');
    expect(html).toContain("Hier siehst du bald jeden Tag am Tresen.");
    expect(html).toContain("NFC am Tresen<span class=\"ow-sr\"> (außerhalb von Loynara)</span>");
    expect(html).toContain("Testkarten zählen nicht.");
    expect(html).toContain("/merchant/staff");
  });

  it("gives a manager no owner-only links", () => {
    state.me = me({ role: "manager", stats: { members: 0, awards: 0, redemptions: 0 } });
    const html = render();
    expect(html).not.toContain("/merchant/staff");
    expect(html).not.toContain("/merchant/program/card");
    expect(html).toContain("Tresenschild laden");
  });
});
