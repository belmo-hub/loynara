import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/components/client-api";
import type { LocationAnalytics, MerchantSpend, SpendFigures } from "@/lib/merchant-analytics";
import type { LaunchReadiness } from "@/lib/readiness";
import { RETENTION_RULES, type RetentionSummary } from "@/lib/retention";

type Load = { state: "ok"; data: unknown; at: number } | { state: "loading" } | { state: "error"; message: string };
const state = vi.hoisted(() => ({ me: null as MeResponse | null, locations: [] as Array<{ id: string }>, hidden: [] as string[], loads: {} as Record<string, Load>, urls: [] as string[] }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ me: state.me, locations: state.locations, hiddenSurfaces: state.hidden }) }));
vi.mock("./use-load", () => ({
  useLoad: (url: string | null) => {
    if (url) state.urls.push(url);
    const key = url ? Object.keys(state.loads).find(prefix => url.startsWith(prefix)) : undefined;
    return [url === null ? { state: "idle" } : key ? state.loads[key] : { state: "loading" }, () => {}];
  },
}));

import { milestoneToShow, Overview, tilesOf } from "./overview";

const ok = (data: unknown): Load => ({ state: "ok", data, at: 0 });
const NBSP = " ";
const me = (patch: Partial<MeResponse> = {}): MeResponse => ({
  userId: "u", tenantId: "t", locationId: "loc-1", role: "owner", businessName: "Café Lindenblatt", locationName: "Kassel Mitte", publicBaseUrl: "http://localhost:3000",
  programSlug: "cafe", programType: "points", rewardTitle: "Kaffee", rewardCost: 100, stats: { members: 9, awards: 30, redemptions: 2 }, activity: [], ...patch,
});
/** 15 local days 20.10.–3.11.2026 ending yesterday; today is 4.11. */
const days = (counts: number[]) => counts.map((bookings, index) => ({ date: new Date(Date.UTC(2026, 9, 20 + index, 12)).toISOString().slice(0, 10), bookings }));
const analytics = (patch: Partial<LocationAnalytics> = {}): LocationAnalytics => ({
  locationId: "loc-1", windowDays: 30, from: "", asOf: "", winback: null,
  current: { newCards: 4, qualifyingCheckouts: 9, repeatCards: 3, redemptions: 0, winbacks: 2 }, previous: { newCards: 0, qualifyingCheckouts: 10, repeatCards: 1, redemptions: 1, winbacks: 1 },
  timezone: "Europe/Berlin", today: "2026-11-04", days: days([1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 3]), lastBookingOn: "2026-11-03", firstBookingOn: "2026-08-01", fullTwoWeeks: true,
  winbackSetting: { enabled: true, days: 30 },
  diary: [
    { date: "2026-11-03", bookings: 3, units: 21, more: 0, entries: [{ kind: "award", amount: 7 }, { kind: "award", amount: 7 }, { kind: "award", amount: 7 }] },
    { date: "2026-11-01", bookings: 1, units: 15, more: 3, entries: [{ kind: "award", amount: 15 }, { kind: "correction", amount: 2 }, { kind: "redemption", amount: 0 }] },
  ], ...patch,
});
const figures = (patch: Partial<SpendFigures>): SpendFigures => ({ visits: 0, spentMinor: 0, realMinor: 0, estimatedMinor: 0, unpricedVisits: 0, averagePerVisitMinor: null, newCardMinor: 0, returningCardMinor: 0, ...patch });
const spend = (here: SpendFigures, overall: SpendFigures = figures({ visits: 40, spentMinor: 99_900, realMinor: 99_900, averagePerVisitMinor: 2_497 })): MerchantSpend =>
  ({ asOf: "", currency: "EUR", overall: { recent: overall, total: overall }, locations: [{ locationId: "loc-1", name: "Kassel Mitte", recentFrom: "", recent: here, total: here }] });
const retention: RetentionSummary = { asOf: "", inactiveDays: 30, locationId: "loc-1", openCards: 20, recent: 17, drifting: 0, never: 2, neverAfterWeek: 0, nearReward: 0, rewardReady: 0, driftingWeekAgo: 0, nearRewardMaxRemaining: 0, nearRewardId: null, programCount: 1, rules: RETENTION_RULES };
const readiness = (steps: Array<Partial<LaunchReadiness["steps"][number]>> = []) => ({ locationId: "loc-1", steps, next: null, requiredDone: 1, requiredTotal: 3 });
const render = () => renderToStaticMarkup(createElement(Overview));

beforeEach(() => {
  state.me = me(); state.locations = [{ id: "loc-1" }, { id: "loc-2" }]; state.hidden = []; state.urls = [];
  state.loads = {
    "/api/merchant/analytics/location": ok(analytics()),
    "/api/merchant/spend": ok(spend(figures({ visits: 9, spentMinor: 12_810, realMinor: 12_810, averagePerVisitMinor: 1_423 }))),
    "/api/merchant/retention": ok(retention), "/api/merchant/referrals": ok({ referrals: [] }), "/api/merchant/readiness": ok(readiness()),
    "/api/auth/get-session": ok({ user: { name: "Lena Berger" } }),
  };
});

describe("Übersicht direction D (ENG-085)", () => {
  it("normal owner: this location's till amounts, the strip, the best-day headline and the four tiles; the old cards are gone", () => {
    const html = render();
    expect(html).toMatch(/Guten (Morgen|Tag|Abend), Lena\./);
    expect(html).not.toContain("Café Lindenblatt.");
    expect(html).toContain("Umsatz deiner Loynara-Kunden · 30 Tage");
    expect(html).toContain("128<small>,10"); // this location, not the 999,00 € of the whole business
    expect(html).toContain("aus Kassenbeträgen an diesem Standort");
    expect(html).toContain(`Gestern war der beste Tag seit zwei Wochen: 3${NBSP}Buchungen am${NBSP}Tresen.`);
    expect(html).toMatch(/role="img" aria-label="Buchungen an diesem Standort · letzte 7 Tage: [^"]*gestern 3/);
    expect(html).toContain("Letzte 30 Tage an diesem Standort");
    expect([...html.matchAll(/<h3 class="ow-tile-label">([^<]+)<\/h3>/g)].map(match => match[1])).toEqual(["Buchungen", "Neue Karten", "Wiedergekommen", "Prämien eingelöst"]);
    expect(html).toContain("vorher 10");
    for (const gone of ["Was jetzt zählt", "Letzte Vorgänge", "Programm bearbeiten", "Gerade nichts Dringendes", "Für Excel", "↑", "↓"]) expect(html).not.toContain(gone);
  });

  it("a shop without till amounts leads with bookings (Q-81 switch off), whatever the average says", () => {
    state.loads["/api/merchant/spend"] = ok(spend(figures({ visits: 6, spentMinor: 9_000, estimatedMinor: 9_000, averagePerVisitMinor: 1_500 })));
    const html = render();
    expect(html).toContain("Buchungen · letzte 30 Tage");
    expect(html).toContain(`9${NBSP}<small>Buchungen</small>`);
    expect(html).toContain("bestätigt an der Kasse");
    expect(html).not.toContain("€");
    expect(html).not.toContain("Durchschnittsbon");
  });

  it("mixed till amounts and estimates read „teilweise geschätzt“", () => {
    state.loads["/api/merchant/spend"] = ok(spend(figures({ visits: 17, spentMinor: 12_810, realMinor: 10_000, estimatedMinor: 2_810, averagePerVisitMinor: 1_423 })));
    expect(render()).toContain("teilweise geschätzt");
  });

  it("quiet week: rule 4, the Tresenschild next step in one line, a grey gap in the diary", () => {
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ days: days([1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), lastBookingOn: "2026-10-24", diary: [{ date: "2026-10-24", bookings: 1, units: 1, more: 0, entries: [{ kind: "award", amount: 1 }] }] }));
    const html = render();
    expect(html).toContain("Eine ruhige Woche. Die letzte Buchung war am Samstag, 24.10.");
    expect(html).toContain("<b>Seit 11 Tagen keine Buchung. Steht das Tresenschild gut sichtbar?</b>");
    expect(html).toContain(">Tresenschild laden</button>");
    expect(html).toContain("25.10.–03.11.");
    expect(html).toContain(`1${NBSP}Punkt vergeben`);
    expect(html).not.toContain("Dringendes");
  });

  it("next step: cards away and rewards ready in one line with „Ansehen“", () => {
    state.loads["/api/merchant/retention"] = ok({ ...retention, drifting: 2 });
    expect(render()).toContain(`<b>2${NBSP}Karten fehlen seit über 30 Tagen.</b>`);
    state.loads["/api/merchant/retention"] = ok({ ...retention, rewardReady: 1 });
    const html = render();
    expect(html).toContain(`<b>1${NBSP}Karte kann jetzt eine Prämie einlösen.</b>`);
    expect(html).toMatch(/class="ow-btn ow-btn--primary ow-btn--sm" href="[^"]+">Ansehen</);
  });

  it("Leitung: their card stock, the strip and the four tiles, never a euro or the spend read; the bonus note is plain text", () => {
    state.me = me({ role: "manager" });
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ winbackSetting: { enabled: false, days: 30 } }));
    const html = render();
    expect(state.urls.some(url => url.startsWith("/api/merchant/spend"))).toBe(false);
    expect(html).toContain("Karten an deinem Standort · 30 Tage");
    expect(html).toContain("17 <small>von 20</small>");
    expect(html).toContain("Karten mit Buchung in den letzten 30 Tagen");
    expect(html).toContain("Karten an deinem Standort: 17 da · 0 länger nicht da · 2 noch nie an der Kasse");
    expect(html).toContain("Buchungen an diesem Standort · letzte 7 Tage");
    expect(html).toContain('<span class="ow-tile-n">–</span><span class="ow-tile-note">Willkommen-zurück-Bonus ist aus</span>');
    expect(html).not.toContain("€");
    expect(html).not.toContain("Umsatz");
  });

  it("loading keeps greeting and kicker busy; error is one alert without a promise about the cashier", () => {
    state.loads = {};
    const loading = render();
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Umsatz deiner Loynara-Kunden · 30 Tage");
    state.loads = { "/api/merchant/analytics/location": { state: "error", message: "x" } };
    const failed = render();
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Die Zahlen sind gerade nicht da.");
    expect(failed).toContain("Die Verbindung zu Loynara hat nicht geklappt.");
    expect(failed).not.toContain("trotzdem");
    expect(failed).toContain("Lädt, sobald die Verbindung wieder da ist.");
  });

  it("diary: one entry per day, „Korrektur −2“ as its own pill, the redeemed reward marked once, the rest counted, no times", () => {
    const html = render();
    expect(html).toContain("<h3>Gestern</h3>");
    expect(html).toContain(`3${NBSP}Buchungen · 21${NBSP}Punkte vergeben`);
    expect(html).toContain("Sonntag, 01.11.");
    expect(html).toContain("<span aria-hidden=\"true\">Korrektur −2</span>");
    expect(html.match(/data-kind="redemption"/g)).toHaveLength(1);
    expect(html).toContain(`3${NBSP}weitere`);
    expect(html).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("keeps the invite link and Tresenschild reachable on the page until ENG-086 moves them", () => {
    expect(render()).toContain("Kunden einladen");
  });
});

describe("the four tiles (spec §1.3, copy T1–T5)", () => {
  it("say „erste Woche“ and „zweite Woche“ after the first booking, „vorher N“ with a full previous period, else what was counted", () => {
    const notes = (patch: Partial<LocationAnalytics>) => tilesOf(analytics(patch), { owner: true, bonusHref: "/merchant/wallet-messages#winback-title" }).map(tile => typeof tile.note === "string" ? tile.note : "link");
    expect(notes({ firstBookingOn: "2026-10-30", previous: null })).toEqual(["erste Woche", "erste Woche", "erste Woche", "erste Woche"]);
    expect(notes({ firstBookingOn: "2026-10-24", previous: null })).toEqual(["zweite Woche", "zweite Woche", "zweite Woche", "zweite Woche"]);
    expect(notes({})).toEqual(["vorher 10", "vorher 0", "vorher 1", "vorher 1"]);
    expect(notes({ previous: null })).toEqual(["an der Kasse bestätigt", "erstmals angemeldet", "mit Willkommen-zurück-Bonus", "an der Kasse"]);
  });
  it("show „–“ for a shop with the bonus off, linked to the setting for the owner where it is offered, and name the owner's days in „?“", () => {
    const off = analytics({ winbackSetting: { enabled: false, days: 45 } });
    const owner = tilesOf(off, { owner: true, bonusHref: "/merchant/wallet-messages#winback-title" })[2];
    expect(owner.value).toBe("–");
    expect(renderToStaticMarkup(createElement("p", null, owner.note))).toContain('href="/merchant/wallet-messages#winback-title"');
    expect(tilesOf(off, { owner: true, bonusHref: null })[2].note).toBe("Willkommen-zurück-Bonus ist aus"); // withheld page: no dead link
    expect(tilesOf(off, { owner: false, bonusHref: "/x" })[2].note).toBe("Willkommen-zurück-Bonus ist aus");
    expect(owner.help).toBe("Karten, die nach über 45 Tagen wiederkamen und den Willkommen-zurück-Bonus bekamen.");
  });
});

describe("milestones (spec §6.3)", () => {
  it("shows the highest card milestone reached, once per location, and never without storage", () => {
    expect(milestoneToShow(0, "", "a")).toBeNull();
    expect(milestoneToShow(1, "", "a")).toBe(1);
    expect(milestoneToShow(9, "a:1", "a")).toBeNull();
    expect(milestoneToShow(10, "a:1", "a")).toBe(10);
    expect(milestoneToShow(37, "a:1,a:10", "a")).toBe(25);
    expect(milestoneToShow(37, "a:25", "b")).toBe(25);
    expect(milestoneToShow(37, "-", "a")).toBeNull();
    expect(render()).not.toContain("Meilenstein");
  });
});

describe("empty shop (spec §2.4, copy E1–E8)", () => {
  const steps = [
    { id: "programme", group: "setup", required: true, status: "done", title: "Programm und Prämie", evidence: "Stempelkarte · 8 Stempel → Kugel" },
    { id: "card", group: "setup", required: false, status: "todo", title: "Kundenkarte gestaltet", evidence: "Die Karte nutzt noch die Standardfarbe." },
    { id: "enrolment", group: "verify", required: true, status: "todo", title: "Erste Karte angemeldet", evidence: "Melde dich selbst an.", action: { label: "Anmeldelink öffnen", href: "/merchant/settings" } },
    { id: "first_award", group: "verify", required: true, status: "todo", title: "Erste Buchung an der Kasse bestätigt", evidence: "Noch keine." },
    { id: "first_redemption", group: "verify", required: false, status: "todo", title: "Einlösung", evidence: "Noch keine." },
    { id: "nfc", group: "external", required: false, status: "external", title: "NFC am Tresen", evidence: "Wird außerhalb von Loynara eingerichtet." },
  ] as Array<Partial<LaunchReadiness["steps"][number]>>;
  beforeEach(() => { state.me = me({ programType: "stamp", stats: { members: 0, awards: 0, redemptions: 0 } }); state.loads = { "/api/merchant/readiness": ok(readiness(steps)) }; });

  it("leads with the current required step and lists the four first steps in the approved words", () => {
    const html = render();
    expect(html).toContain("Willkommen bei Loynara, Café Lindenblatt.");
    expect(html).toContain("Startklar · 1 von 3 Pflichtschritten");
    expect(html).toContain("Melde die erste Karte selbst an.");
    expect(html).toContain('href="http://localhost:3000/join/cafe"');
    expect(html).toContain("Hier siehst du bald jeden Tag am Tresen.");
    for (const text of ["Programm und Prämie", "Stempelkarte · 8 Stempel → Kugel", "Erste Karte anmelden", "Mit dem Anmeldelink oder dem Tresenschild.", "Erste Buchung an der Kasse", "Ein Stempel auf deine eigene Karte.", "Einlösung einmal durchspielen", "Zeigt deinem Team die Bestätigung."]) expect(html).toContain(text);
    expect(html).not.toContain("NFC am Tresen");
    expect(html).not.toContain("Kundenkarte gestaltet");
    expect(html).toContain("/merchant/staff");
  });

  it("gives a manager no owner-only links", () => {
    state.me = me({ role: "manager", programType: "stamp", stats: { members: 0, awards: 0, redemptions: 0 } });
    const html = render();
    expect(html).not.toContain("/merchant/staff");
    expect(html).not.toContain("/merchant/program/card");
    expect(html).toContain("Tresenschild laden");
  });
});
