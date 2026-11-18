import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardCacheKey } from "@/lib/board-cache";
import type { MeResponse } from "@/components/client-api";
import type { BroughtCustomers, LocationAnalytics, MerchantSpend, SpendFigures } from "@/lib/merchant-analytics";
import type { LaunchReadiness } from "@/lib/readiness";
import { RETENTION_RULES, type RetentionSummary } from "@/lib/retention";
import { BROUGHT_COPY, SPEND_COPY } from "@/lib/spend-copy";

type Load = { state: "ok"; data: unknown; at: number } | { state: "loading" } | { state: "error"; message: string };
const state = vi.hoisted(() => ({ me: null as MeResponse | null, locations: [] as Array<{ id: string }>, hidden: [] as string[], loads: {} as Record<string, Load>, urls: [] as string[] }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ me: state.me, locations: state.locations, hiddenSurfaces: state.hidden }) }));
// The client snapshot, so this device's storage (stubbed per test) reaches a server render; without a window it is empty.
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(), useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock("./use-load", () => ({
  useLoad: (url: string | null) => {
    if (url) state.urls.push(url);
    const key = url ? Object.keys(state.loads).find(prefix => url.startsWith(prefix)) : undefined;
    return [url === null ? { state: "idle" } : key ? state.loads[key] : { state: "loading" }, () => {}];
  },
}));

import { boardOf, firstWeeks, milestoneToShow, Overview, quietOf, tilesOf } from "./overview";

const ok = (data: unknown): Load => ({ state: "ok", data, at: 0 });
const NBSP = "\u00a0";
const me = (patch: Partial<MeResponse> = {}): MeResponse => ({
  userId: "u", tenantId: "t", locationId: "loc-1", role: "owner", businessName: "Café Lindenblatt", locationName: "Kassel Mitte", publicBaseUrl: "http://localhost:3000",
  programSlug: "cafe", programType: "points", rewardTitle: "Kaffee", rewardCost: 100, stats: { members: 9, awards: 30, redemptions: 2 }, activity: [], ...patch,
});
/** 15 local days 20.10.–3.11.2026 ending yesterday; today is 4.11. */
const days = (counts: number[]) => counts.map((bookings, index) => ({ date: new Date(Date.UTC(2026, 9, 20 + index, 12)).toISOString().slice(0, 10), bookings }));
const analytics = (patch: Partial<LocationAnalytics> = {}): LocationAnalytics => ({
  locationId: "loc-1", windowDays: 30, from: "", asOf: "", winback: null,
  current: { newCards: 4, qualifyingCheckouts: 9, repeatCards: 3, redemptions: 0, winbacks: 2 }, previous: { newCards: 0, qualifyingCheckouts: 10, repeatCards: 1, redemptions: 1, winbacks: 1 },
  timezone: "Europe/Berlin", today: "2026-11-04", days: days([1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 3]), lastBookingOn: "2026-11-03", programStartedOn: "2026-08-01", fullTwoWeeks: true,
  winbackSetting: { enabled: true, days: 30 },
  diary: [
    { date: "2026-11-03", bookings: 3, units: 21, more: 0, entries: [{ kind: "award", amount: 7 }, { kind: "award", amount: 7 }, { kind: "award", amount: 7 }] },
    { date: "2026-11-01", bookings: 1, units: 15, more: 3, entries: [{ kind: "award", amount: 15 }, { kind: "correction", amount: -2 }, { kind: "redemption", amount: 0 }, { kind: "correction", amount: 100 }, { kind: "correction", amount: 1 }] },
  ], ...patch,
});
const figures = (patch: Partial<SpendFigures>): SpendFigures => ({ visits: 0, spentMinor: 0, realMinor: 0, estimatedMinor: 0, unpricedVisits: 0, averagePerVisitMinor: null, newCardMinor: 0, returningCardMinor: 0, ...patch });
const spend = (here: SpendFigures, overall: SpendFigures = figures({ visits: 40, spentMinor: 99_900, realMinor: 99_900, averagePerVisitMinor: 2_497 })): MerchantSpend =>
  ({ asOf: "", currency: "EUR", overall: { recent: overall, total: overall }, locations: [{ locationId: "loc-1", name: "Kassel Mitte", recentFrom: "", recent: here, total: here, brought: null }] });
const retention: RetentionSummary = { asOf: "", inactiveDays: 30, locationId: "loc-1", openCards: 20, recent: 17, drifting: 0, never: 2, neverAfterWeek: 0, nearReward: 0, rewardReady: 0, driftingWeekAgo: 0, nearRewardMaxRemaining: 0, nearRewardId: null, programCount: 1, rules: RETENTION_RULES };
const readiness = (steps: Array<Partial<LaunchReadiness["steps"][number]>> = []) => ({ locationId: "loc-1", steps, next: null, requiredDone: 1, requiredTotal: 3 });
// The board's and the tiles' figures sit in the ticker's span (NumberRoll); the pins below read the figures themselves.
const render = () => renderToStaticMarkup(createElement(Overview)).replace(/<span class="[^"]*num[^"]*">([^<]*(?:<small>[^<]*<\/small>)?)<\/span>/g, "$1");
/** The 30-day figure rows' labels, in order. */
const labels = (html: string) => [...html.matchAll(/data-fact=""[^>]*>/g)].map(match => html.slice(match.index).match(/<b>([^<]+)<\/b>/)![1]);
const text = (html: string) => html.replace(/<svg.*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** The chart's bars: the count over each and the bar's attributes. */
const bars = (html: string) => [...html.matchAll(/aria-hidden="true"[^>]*>(?:<b>([^<]*)<\/b>)?<i class="_bar_[^"]*"([^>]*)>/g)].map(match => ({ count: match[1] ?? "", attrs: match[2] }));

afterEach(() => { vi.unstubAllGlobals(); });
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
  it("demo environment (pilot-surfaces revenue): no „Umsatz deiner Loynara-Kunden“, the spend read is never made, the card stock leads", () => {
    state.me = me({ hiddenSurfaces: ["revenue"] });
    const html = render();
    expect(html).not.toContain("Umsatz deiner Loynara-Kunden");
    expect(state.urls.some(url => url.startsWith("/api/merchant/spend"))).toBe(false);
    expect(html).toContain('aria-label="Karten an deinem Standort, letzte 30 Tage"');
    expect(html).toContain("Demo-Daten: erfundene Beispiele, keine Prognose.");
    state.me = me();
    expect(render()).not.toContain("Demo-Daten");
  });

  it("normal owner: this location's till amounts, the strip, the best-day headline and the four tiles; the old cards are gone", () => {
    const html = render();
    expect(html).toMatch(/<h1 class="ow-hello[^"]*"><span class="ow-sr">Übersicht: <\/span>Guten (Morgen|Tag|Abend), Lena<\/h1>/); // the visible heading, outside the card
    expect(html).not.toContain("Café Lindenblatt.");
    expect(html).toContain('aria-label="Umsatz deiner Loynara-Kunden, letzte 30 Tage"'); // no kicker: the sub-line says the days
    expect(html).not.toContain("ow-board-kicker");
    expect(html).toContain("128<small>,10"); // this location, not the 999,00 € of the whole business
    expect(html).toContain("Umsatz deiner Loynara-Kunden, 30 Tage");
    expect(html).toContain(`Gestern war der beste Tag seit zwei Wochen: 3${NBSP}Buchungen am${NBSP}Tresen.`);
    expect(html).toMatch(/role="img" aria-label="Buchungen an diesem Standort · letzte 7 Tage: [^"]*gestern 3/);
    expect(html).toContain("Letzte 30 Tage an diesem Standort");
    expect(labels(html)).toEqual(["Buchungen", "Neue Karten", "Wieder\u00adgekommen", "Prämien eingelöst"]); // breaks only at the soft hyphen
    expect(html).toContain('<button type="button" class="ow-board-q" aria-expanded="false"'); // the board's „?“ ends the sub-line
    expect(html).toMatch(/Umsatz deiner Loynara-Kunden, 30 Tage\u00a0<button/);
    expect(html).not.toContain("ow-board-est"); // exact till amounts: no estimate chip
    expect(html).toContain("vorher 10");
    // Figure rows: label, note as sub-line, the value on the inset; the whole linked row is the link, with the chevron.
    const link = html.match(/<a class="[^"]*" data-fact="" href="([^"]+)">(.*?)<\/a>/);
    expect(link?.[1]).toBe("/merchant/customers?activity=recent&amp;days=30&amp;locationId=loc-1");
    expect(link?.[2]).toContain("lucide-chevron-right");
    // The link's name reads the value before the comparison: „9 Buchungen vorher 10“, never „Buchungen vorher 10 9“.
    expect(text(link![2])).toBe("9 Buchungen vorher 10");
    expect(html.match(/data-fact=""/g)).toHaveLength(4); // the board leads with euros, so the Buchungen row stays
    expect(html.match(/lucide-chevron-right/g)).toHaveLength(1); // only the linked row; the other Kunden filters come with ENG-086
    // One „?“ for all rows, on the section head; the shared sheet lists the four help texts under their labels, word for word.
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(1);
    expect(html).toMatch(/<h2 id="ow-days-title" class="[^"]*">Letzte 30 Tage an diesem Standort<\/h2><button type="button" class="[^"]*" aria-haspopup="dialog">/);
    const sheet = html.slice(html.lastIndexOf("<dialog"), html.lastIndexOf("</dialog>"));
    expect(sheet).toMatch(/<h2 id="[^"]+" class="[^"]*">So zählen wir<\/h2>/);
    expect([...sheet.matchAll(/<h3>([^<]+)<\/h3><p>([^<]+)<\/p>/g)].map(match => `${match[1]}: ${match[2]}`)).toEqual([
      "Buchungen: Jede bestätigte Buchung an der Kasse, Korrekturen abgezogen.", "Neue Karten: Karten, die sich in diesem Zeitraum zum ersten Mal angemeldet haben.",
      "Wieder\u00adgekommen: Karten, die nach über 30 Tagen wiederkamen und den Willkommen-zurück-Bonus bekamen.", "Prämien eingelöst: Prämien, die dein Team an der Kasse eingelöst hat."]);
    expect(sheet).toContain("Schließen");
    expect(html.indexOf("ow-hello")).toBeLessThan(html.indexOf('data-ow="board"'));
    for (const gone of ["Was jetzt zählt", "Letzte Vorgänge", "Programm bearbeiten", "Gerade nichts Dringendes", "Für Excel", "↑", "↓"]) expect(html).not.toContain(gone);
  });

  it("the strip ends on today, drawn as not final from the same read's diary; the headline stays on the complete days", () => {
    expect(render()).toMatch(new RegExp(`letzte 7 Tage: [^"]*gestern 3${NBSP}Buchungen, heute 0${NBSP}Buchungen"`)); // no entry today: a true 0
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ diary: [{ date: "2026-11-04", bookings: 29, units: 29, more: 0, entries: [] }, ...analytics().diary] }));
    const html = render();
    expect(html).toMatch(new RegExp(`letzte 7 Tage: [^"]*gestern 3${NBSP}Buchungen, heute 29${NBSP}Buchungen"`));
    expect(bars(html)).toHaveLength(7); // six complete days and today
    expect(html).toMatch(/<b>29<\/b><i class="_bar_[^"]*" data-today="" style="height:144px">/);
    expect(bars(html).filter(bar => bar.attrs.includes("data-lit"))).toHaveLength(1); // yesterday, as before
    // Beside „heute“ yesterday shows its weekday and nothing is bold (Design, 10 Nov; kept by the ENG-260 legend ruling).
    expect(html).toContain("<span>Di</span><span>heute</span>");
    expect(html).not.toContain('data-yesterday=""');
    expect(html).toContain(`Gestern war der beste Tag seit zwei Wochen: 3${NBSP}Buchungen am${NBSP}Tresen.`);
  });

  it("with the weekly line the strip marks the same days: Monday to today, a hairline before Monday, the sentence first in the spoken label (ENG-210)", () => {
    const today = analytics().today; // the fixture's day
    const monday = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ week: { from: monday, bookings: 12, returning: 8, newCards: 3 } }));
    const html = render();
    const line = `Diese Woche: 12${NBSP}Buchungen, 8${NBSP}davon von Karten mit früherer Buchung, und 3${NBSP}neue Karten.`;
    expect(html).toContain(`<p class="ow-week-line">${line}</p>`);
    expect(html).toContain(`data-week="" role="img" aria-label="${line} `);
    const days = [...html.matchAll(/<div class="_day_[^"]*" aria-hidden="true"([^>]*)>/g)].map(match => match[1]);
    expect(days).toHaveLength(7);
    // Monday to today are in the week; the days before are not; exactly one column starts the week unless Monday is the first.
    const inWeek = days.map(attrs => attrs.includes("data-in-week"));
    expect(inWeek.at(-1)).toBe(true);
    expect(inWeek.indexOf(true)).toBe(inWeek.lastIndexOf(false) + 1);
    expect(days.filter(attrs => attrs.includes("data-week-start"))).toHaveLength(inWeek[0] ? 0 : 1);
    // A day of this week is lit only if it had bookings and is over: a 0-booking Monday is not the darkest mark, and today keeps its outline alone.
    const shown = bars(html);
    expect(shown).toHaveLength(7);
    shown.forEach((bar, index) => expect(bar.attrs.includes("data-lit"), `bar ${index}`).toBe(inWeek[index] && bar.count !== "" && !bar.attrs.includes("data-today")));
    expect(shown.at(-1)!.attrs).toContain("data-today");
    expect(shown.at(-1)!.attrs).not.toContain("data-lit");
    expect(html).not.toContain("<i data-lit=\"\" aria-hidden=\"true\"></i>gestern"); // the dark bars are the week's: no „gestern“ key
    // Without the field (flag off) the strip is #253's: no week marks, the caption leads the label.
    state.loads["/api/merchant/analytics/location"] = ok(analytics());
    const plain = render();
    expect(plain).not.toContain("data-week");
    expect(plain).not.toContain("data-in-week");
    expect(plain).not.toContain("ow-week-line");
  });

  it("a cold load keeps the band's place, paints the board with its own reads, brings the diary with its data, and writes the greeting once", () => {
    state.me = me({ userId: "first-visit" }); // no greeting kept from an earlier screen
    const analyticsRead = state.loads["/api/merchant/analytics/location"];
    delete state.loads["/api/merchant/analytics/location"];
    delete state.loads["/api/merchant/readiness"];
    delete state.loads["/api/auth/get-session"];
    const waiting = render();
    expect(waiting).toContain('aria-busy="true"'); // the board's still placeholders, in its loaded shapes
    expect(waiting).not.toContain("data-fact");
    expect(waiting).not.toContain('data-ow="diary"'); // no heading over „Lädt …“ a screen above where the diary lands
    // The panel's place is held by a flat block of its size, so the board stands where it will stay.
    expect(waiting).toMatch(/<div class="ow-next ow-next-ph" aria-hidden="true"><span><span class="ow-ph _nextPh_[^"]*"><\/span><\/span><\/div>/);
    expect(waiting.indexOf("ow-next-ph")).toBeLessThan(waiting.indexOf('data-ow="board"'));
    expect(waiting).not.toContain('aria-label="Als Nächstes"');
    expect(waiting).not.toContain("<h1");
    expect(waiting).toMatch(/<div class="ow-hello[^"]*" aria-hidden="true">/); // the greeting's line is kept free
    // The board's own reads are in, the band's are not: the numbers and rows show, the slot still holds the band's place.
    state.loads["/api/merchant/analytics/location"] = analyticsRead;
    const numbers = render();
    expect(numbers).not.toContain('aria-busy="true"');
    expect(numbers).toContain("data-fact");
    expect(numbers).toContain("ow-next-ph");
    expect(numbers).not.toContain('aria-label="Als Nächstes"');
    state.loads["/api/merchant/readiness"] = ok(readiness());
    state.loads["/api/auth/get-session"] = ok({ user: { name: "Lena Berger" } });
    const there = render();
    expect(there).not.toContain('aria-busy="true"');
    expect(there).not.toContain("ow-next-ph"); // a screen whose reads have answered never shows the slot
    expect(there).toMatch(/<h1 class="ow-hello[^"]*">.*, Lena<\/h1>/);
  });

  it("a shop without till amounts leads with bookings (Q-81 switch off), whatever the average says", () => {
    state.loads["/api/merchant/spend"] = ok(spend(figures({ visits: 6, spentMinor: 9_000, estimatedMinor: 9_000, averagePerVisitMinor: 1_500 })));
    const html = render();
    expect(html).toContain('aria-label="Buchungen, letzte 30 Tage"');
    // C: the kicker names the figure, which stands alone; the Buchungen row would repeat it, so it is left out.
    expect(text(html)).toContain("Buchungen 9 letzte 30 Tage, Korrekturen abgezogen");
    expect(labels(html)).toEqual(["Neue Karten", "Wieder\u00adgekommen", "Prämien eingelöst"]);
    expect(html).toContain("<h3>Buchungen</h3><p>Jede bestätigte Buchung"); // its help stays in the sheet
    expect(html).not.toContain("€");
    expect(html).not.toContain("Durchschnittsbon");
  });

  it("mixed till amounts and estimates read „teils geschätzt“", () => {
    state.loads["/api/merchant/spend"] = ok(spend(figures({ visits: 17, spentMinor: 12_810, realMinor: 10_000, estimatedMinor: 2_810, averagePerVisitMinor: 1_423 })));
    const html = render();
    expect(html).toContain('<p class="ow-board-est"><span class="ow-chip ow-chip--info">teils geschätzt</span></p>');
    expect(html).toContain("Umsatz deiner Loynara-Kunden, 30 Tage");
  });

  it("quiet week: rule 4, the Tresenschild next step in one line, a grey gap in the diary", () => {
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ days: days([1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), lastBookingOn: "2026-10-24", diary: [{ date: "2026-10-24", bookings: 1, units: 1, more: 0, entries: [{ kind: "award", amount: 1 }] }] }));
    const html = render();
    expect(html).toContain("Eine ruhige Woche. Die letzte Buchung war am Samstag, 24.10.");
    expect(html).toContain("<b>Seit 11 Tagen keine Buchung. Steht das Tresenschild noch gut sichtbar?</b>");
    // The band is the action: a button for the download, its label the last line with the arrow; nothing closes it any more.
    expect(html).toMatch(/data-ow="next"[^]*<b>Seit 11 Tagen[^]*<button type="button" class="[^"]*">Tresenschild laden<svg/);
    expect(html).not.toMatch(/Hinweis schließen|ow-nextbar|data-next/);
    expect(html).toContain("25.10.–03.11.");
    expect(html).toContain(`1${NBSP}Punkt vergeben`);
    expect(html).not.toContain("Dringendes");
    state.loads["/api/merchant/retention"] = ok({ ...retention, drifting: 2 }); // status by exception: the quiet week comes first
    expect(render()).toContain("<b>Seit 11 Tagen keine Buchung.");
  });

  it("no booking in the read's 90 days: „Seit über 90 Tagen keine Buchung.“ and the quiet next step, no gap; a younger programme is not quiet", () => {
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ days: days(Array(15).fill(0)), lastBookingOn: null, programStartedOn: "2026-06-01", diary: [] }));
    const html = render();
    expect(html).toMatch(/<p class="_foot_[^"]*">Seit über 90 Tagen keine Buchung\.<\/p>/);
    expect(html).toContain("<b>Seit über 90 Tagen keine Buchung. Steht das Tresenschild noch gut sichtbar?</b>");
    expect(html).not.toContain("keine Buchung</small>"); // no diary gap without a known last booking
    expect(html).not.toContain("Die letzten Tage am Tresen"); // and no diary heading over nothing
    expect(quietOf({ lastBookingOn: null, programStartedOn: "2026-08-05", today: "2026-11-04" })).toBe("over90"); // 91 days
    expect(quietOf({ lastBookingOn: null, programStartedOn: "2026-08-06", today: "2026-11-04" })).toBeNull(); // 90 days: every booking would be in the read
    expect(quietOf({ lastBookingOn: null, programStartedOn: null, today: "2026-11-04" })).toBeNull();
    expect(quietOf({ lastBookingOn: "2026-10-28", programStartedOn: "2026-06-01", today: "2026-11-04" })).toBe(7);
    expect(quietOf({ lastBookingOn: "2026-10-29", programStartedOn: "2026-06-01", today: "2026-11-04" })).toBeNull();
  });

  it("next step: cards away and rewards ready in one line with „Ansehen“", () => {
    state.loads["/api/merchant/retention"] = ok({ ...retention, drifting: 2 });
    expect(render()).toContain(`<b>2${NBSP}Karten fehlen seit über 30 Tagen</b>`);
    // With the bonus off, the bar's button switches it on, on Programm (not „Ansehen“ to the setting).
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ winback: { enabled: false, inWindow: 0 } }));
    expect(render()).toMatch(/data-ow="next"[^]*<a class="[^"]*" href="\/merchant\/program\/winback">Willkommen-zurück-Bonus einschalten<svg/);
    state.loads["/api/merchant/analytics/location"] = ok(analytics());
    state.loads["/api/merchant/retention"] = ok({ ...retention, rewardReady: 1 });
    const html = render();
    expect(html).toContain(`<b>1${NBSP}Karte kann jetzt eine Prämie einlösen</b>`);
    expect(html).toMatch(/data-ow="next"[^]*<a class="[^"]*" href="[^"]+">Ansehen<svg/);
    expect(html.indexOf('data-ow="next"')).toBeLessThan(html.indexOf('data-ow="board"')); // in the flow, under the greeting
    // Points stay off the mix card until Design draws a points card (Design, 18 Nov): no thumbnail in „Als Nächstes“.
    const points = html.slice(html.indexOf('data-ow="next"'), html.indexOf('data-ow="board"'));
    expect(points).not.toMatch(/data-lead="card"|role="img"/);
    // A stamp shop's ready reward leads with the card's thumbnail, full (F, ENG-260).
    state.me = me({ programType: "stamp", rewardCost: 8 });
    expect(render()).toMatch(/data-ow="next"[^]*role="img" aria-label="8 von 8 Stempeln"[^]*kann jetzt eine Prämie einlösen/);
  });

  it("Leitung: their card stock, the strip and the four tiles, never a euro or the spend read; the bonus note is plain text", () => {
    state.me = me({ role: "manager" });
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ winbackSetting: { enabled: false, days: 30 } }));
    const html = render();
    expect(state.urls.some(url => url.startsWith("/api/merchant/spend"))).toBe(false);
    expect(html).toContain('aria-label="Karten an deinem Standort, letzte 30 Tage"');
    expect(html).toContain("17 <small>von 20</small>");
    expect(html).toContain("Karten mit Buchung, letzte 30 Tage");
    expect(html).toContain("Karten an deinem Standort: 17 da · 0 länger nicht da · 2 noch nie an der Kasse");
    expect(html).toContain("Buchungen an diesem Standort · letzte 7 Tage");
    expect(html).toContain('<div class="_row_'); // unlinked rows carry no chevron
    expect(html).toMatch(/data-none="true">–<\/span><span class="[^"]*"><b>Wieder\u00adgekommen<\/b><small>Willkommen-zurück-Bonus ist aus<\/small><\/span>/);
    expect(html).not.toContain("€");
    expect(html).not.toContain("Umsatz");
  });

  it("loading keeps greeting and card busy; error is one alert without a promise about the cashier", () => {
    state.loads = {};
    const loading = render();
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('aria-label="Umsatz deiner Loynara-Kunden, letzte 30 Tage"');
    state.loads = { "/api/merchant/analytics/location": { state: "error", message: "x" } };
    const failed = render();
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Die Zahlen sind gerade nicht da.");
    expect(failed).toContain("Die Verbindung zu Loynara hat nicht geklappt.");
    expect(failed).not.toContain("trotzdem");
    expect(failed).toContain("Lädt, sobald die Verbindung wieder da ist.");
  });

  it("a failed read shows this device's last board with „Stand …“, the tiles and diary wait, and no error card", () => {
    const board = boardOf(analytics(), spend(figures({ visits: 9, spentMinor: 12_810, realMinor: 12_810 })), null, "loc-1");
    const stored = new Map([[boardCacheKey("u", "loc-1"), JSON.stringify({ at: new Date(Date.now() - 60_000).toISOString(), board })]]);
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => stored.get(key) ?? null }, addEventListener() {}, removeEventListener() {} });
    state.loads["/api/merchant/analytics/location"] = { state: "error", message: "x" };
    state.loads["/api/merchant/retention"] = ok({ ...retention, drifting: 2 });
    const html = render();
    expect(html).toContain("128<small>,10");
    expect(html).toContain(`Gestern war der beste Tag seit zwei Wochen: 3${NBSP}Buchungen am${NBSP}Tresen.`);
    expect(html).toMatch(/role="status">Stand (heute, \d{1,2}:\d{2}|gestern)</);
    expect(html).not.toContain("Die Zahlen sind gerade nicht da.");
    expect(html).not.toContain("data-fact");
    expect(html.match(/Lädt, sobald die Verbindung wieder da ist\./g)).toHaveLength(1); // once, beside the board
    expect(html).not.toContain("Die letzten Tage am Tresen");
    expect(html).not.toContain("data-hang"); // no next step beside stale numbers, though cards are away (the milestone may stand)
    state.me = me({ userId: "someone-else" }); // another person on this device
    expect(render()).toContain("Die Zahlen sind gerade nicht da.");
    state.me = me();
    stored.set(boardCacheKey("u", "loc-1"), JSON.stringify({ at: new Date(Date.now() - 8 * 86_400_000).toISOString(), board })); // older than 7 days
    expect(render()).toContain("Die Zahlen sind gerade nicht da.");
  });

  it("diary: one row per day, the sum as its sub line, redemptions and corrections after it in their words, no times", () => {
    const html = render();
    expect(html).toContain(`<b>Gestern</b><small>3${NBSP}Buchungen · 21${NBSP}Punkte vergeben</small>`);
    expect(html).toContain("<b>Sonntag, 01.11.</b>");
    // The sum counts bookings only, so the rarer moments follow it, in the read's order.
    expect(html).toContain("vergeben · Korrektur −2 · Prämie eingelöst · Einlösung rückgängig · Einlösung rückgängig</small>");
    expect(html).not.toContain("Korrektur +");
    expect(html).not.toContain("weitere");
    expect(html).not.toMatch(/\d{1,2}:\d{2}/);
    // A busy day is its sum: no wall of thirty bookings.
    const busy = { date: "2026-11-03", bookings: 30, units: 30, more: 2, entries: Array.from({ length: 30 }, () => ({ kind: "award" as const, amount: 1 })) };
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ diary: [busy] }));
    expect(render()).toContain(`<b>Gestern</b><small>30${NBSP}Buchungen · 30${NBSP}Punkte vergeben</small>`);
    // A day with more than eight entries keeps its redemptions and corrections in view.
    const award = { kind: "award" as const, amount: 1 }, redemption = { kind: "redemption" as const, amount: 8 }, correction = { kind: "correction" as const, amount: 8 };
    const mixed = { date: "2026-11-03", bookings: 35, units: 35, more: 0, entries: [...Array.from({ length: 12 }, () => award), redemption, ...Array.from({ length: 11 }, () => award), correction, redemption, correction, ...Array.from({ length: 12 }, () => award), redemption, correction] };
    expect(mixed.entries).toHaveLength(41);
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ diary: [mixed] }));
    const kept = render();
    expect(kept.match(/Prämie eingelöst/g)).toHaveLength(3);
    expect(kept.match(/Einlösung rückgängig/g)).toHaveLength(3);
  });

  it("the dark bar is yesterday's when it had bookings, and the key after the caption says „gestern“; without one there is neither (ENG-260)", () => {
    const key = (html: string) => html.includes('<i data-lit="" aria-hidden="true"></i>gestern');
    const lit = (html: string) => bars(html).filter(bar => bar.attrs.includes("data-lit"));
    const html = render();
    expect(html).toMatch(/Buchungen an diesem Standort · letzte 7 Tage<\/span><span><i data-lit="" aria-hidden="true"><\/i>gestern<\/span><\/p>/);
    expect(key(html)).toBe(true);
    expect(lit(html)).toHaveLength(1);
    expect(lit(html)[0].count).toBe("3");
    // No booking yesterday: no dark bar and no key; the column still reads „gestern“.
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ days: days([1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 2, 0]), lastBookingOn: "2026-11-02" }));
    const quiet = render();
    expect(key(quiet)).toBe(false);
    expect(lit(quiet)).toHaveLength(0);
    expect(quiet).toContain("<span>Di</span><span>heute</span>"); // the columns as live
  });

  it("under forced colours yesterday's bar stays solid while the other bars and keys become outlines (ENG-260)", () => {
    const css = readFileSync(join(__dirname, "overview.module.css"), "utf8").replace(/\/\*[^]*?\*\//g, "");
    const forced = css.match(/@media \(forced-colors: active\) \{([^]*?)\n\}/)?.[1] ?? "";
    expect(forced).toMatch(/\.bar, \.legend i \{[^}]*forced-color-adjust: none;[^}]*background: Canvas;[^}]*border: 1px solid CanvasText;/);
    expect(forced).toMatch(/\.bar\[data-lit\], \.legend i\[data-lit\] \{ background: CanvasText; \}/);
  });

  it("leaves the invite link and Tresenschild to Kunden (ENG-122a)", () => {
    expect(render()).not.toContain("Kunden einladen");
  });
});

describe("wieder da oder neu auf Empfehlung (ENG-095)", () => {
  const row = (locationId: string, brought: BroughtCustomers | null, here: Partial<SpendFigures> = {}) => ({ locationId, name: locationId, recentFrom: "", recent: figures(here), total: figures(here), brought });
  const stamps: BroughtCustomers = { customers: 3, winback: 2, referral: 1, bookings: 3, revenue: null };
  const showing = (rows: ReturnType<typeof row>[]) => { state.loads["/api/merchant/spend"] = ok({ ...spend(figures({})), locations: rows }); return render(); };
  const block = (html: string) => { const at = html.indexOf('<section class="ow-brought"'); return at < 0 ? "" : html.slice(at, html.indexOf("</section>", at)); };

  it("stamp shop: the two events with their counts under the board, the all-card bookings as on the board, no euro, ratio or cause", () => {
    const html = showing([row("loc-1", stamps, { visits: 7 })]);
    const shown = block(html);
    expect(shown).toContain(`Wieder da oder neu auf Empfehlung${NBSP}· letzte${NBSP}30${NBSP}Tage`);
    expect(shown).toContain(`<p class="ow-brought-n">3${NBSP}Kunden</p>`);
    expect(shown).toContain("<dt>Nach längerer Pause wieder da, mit Bonus</dt><dd>2</dd>");
    expect(shown).toContain("<dt>Neu auf Empfehlung</dt><dd>1</dd>");
    expect(shown).toContain("Alle Kunden mit Karte: <span>9 Buchungen</span>. Manche wären auch ohne Karte gekommen."); // the board's 9, not the spend read's 7
    expect(shown).toContain('aria-haspopup="dialog"');
    expect(shown).toContain("Gezählt werden nur die Buchungen, bei denen der Willkommen-zurück-Bonus dazukam, und die erste Buchung nach einer Empfehlung.");
    expect(shown).not.toMatch(/€|%|Umsatz|(über|durch|dank) Loynara/);
    // In C's „Vorschlag“ place: beside the board, under the figure rows.
    expect(html.indexOf("ow-brought")).toBeGreaterThan(html.indexOf("data-fact"));
    expect(html.indexOf("ow-brought")).toBeLessThan(html.indexOf('data-ow="diary"'));
    expect(SPEND_COPY.howWeCount.endsWith(BROUGHT_COPY.allNote)).toBe(true); // the caveat stays word for word
  });

  it("points shop: the till amounts of these bookings with how many had one, never an estimate; singular forms", () => {
    const points = (revenue: BroughtCustomers["revenue"], patch: Partial<BroughtCustomers> = {}) => block(showing([row("loc-1", { ...stamps, revenue, ...patch }, { visits: 9, realMinor: 31_200, spentMinor: 35_000, estimatedMinor: 3_800 })]));
    const some = points({ amountMinor: 4_150, pricedBookings: 2 });
    expect(some).toContain(`<dt>Umsatz dieser Buchungen</dt><dd>41,50${NBSP}€</dd><dd>2 von 3 Buchungen mit Kassenbetrag</dd>`);
    // The board shows 350 € partly estimated; a second euro total (312 € till amounts) would contradict it (fault 17).
    expect(some).toContain("Alle Kunden mit Karte: <span>9 Buchungen</span>.");
    const exact = block(showing([row("loc-1", { ...stamps, revenue: { amountMinor: 4_150, pricedBookings: 2 } }, { visits: 9, realMinor: 31_200, spentMinor: 31_200 })]));
    expect(exact).toContain(`Alle Kunden mit Karte: <span>312,00${NBSP}€</span>.`); // exact till amounts: the board's own figure
    expect(points({ amountMinor: 4_150, pricedBookings: 3 })).toContain("<dd>aus 3 Buchungen mit Kassenbetrag</dd>");
    expect(points({ amountMinor: 0, pricedBookings: 0 })).toContain("<dd>–</dd><dd>0 von 3 Buchungen mit Kassenbetrag</dd>");
    const one = points({ amountMinor: 900, pricedBookings: 1 }, { customers: 1, winback: 0, referral: 1, bookings: 1 });
    expect(one).toContain(`1${NBSP}Kunde</p>`);
    expect(one).toContain("aus 1 Buchung mit Kassenbetrag");
  });

  it("shows a true 0 once the gate is open, without a revenue line when there is no booking to sum", () => {
    const shown = block(showing([row("loc-1", { customers: 0, winback: 0, referral: 0, bookings: 0, revenue: { amountMinor: 0, pricedBookings: 0 } }, { realMinor: 1_000 })]));
    expect(shown).toContain(`0${NBSP}Kunden`);
    expect(shown).toContain("<dd>0</dd>");
    expect(shown).not.toContain("Umsatz dieser Buchungen");
  });

  it("before the first brought customer: the bonus band while the bonus is off, else nothing; never for the Leitung or beside a failed read", () => {
    const off = () => { state.loads["/api/merchant/analytics/location"] = ok(analytics({ winbackSetting: { enabled: false, days: 30 } })); };
    off();
    const band = showing([row("loc-1", null)]);
    // C's „Vorschlag“, the suggestion once on the page (ENG-260): the whole panel is the link.
    expect(band).toMatch(/<a class="[^"]*" href="\/merchant\/program\/winback"><span class="[^"]*"><svg[^]*<\/svg>Vorschlag<svg[^]*<\/svg><\/span><span><b>Willkommen-zurück-Bonus einschalten<\/b><small>Ein kleiner Bonus für Kunden, die länger nicht da waren.<\/small><\/span><\/a>/);
    expect(band.match(/Willkommen-zurück-Bonus einschalten/g)).toHaveLength(1);
    expect(band).not.toContain('<section class="ow-brought"');
    const either = (html: string) => html.includes("ow-brought") || html.includes("Vorschlag");
    // „Als Nächstes“ already offers the bonus (cards away, bonus off): „Vorschlag“ is left out, the offer stands once.
    state.loads["/api/merchant/retention"] = ok({ ...retention, drifting: 2 });
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ winback: { enabled: false, inWindow: 0 }, winbackSetting: { enabled: false, days: 30 } }));
    const once = showing([row("loc-1", null)]);
    expect(once.match(/Willkommen-zurück-Bonus einschalten/g)).toHaveLength(1);
    expect(once).toMatch(/data-ow="next"[^]*>Willkommen-zurück-Bonus einschalten<svg/);
    expect(once).not.toContain("Vorschlag");
    state.loads["/api/merchant/retention"] = ok(retention);
    state.loads["/api/merchant/analytics/location"] = ok(analytics());
    expect(either(showing([row("loc-1", null)]))).toBe(false);
    off();
    state.me = me({ role: "manager" });
    expect(either(showing([row("loc-1", stamps)]))).toBe(false);
    state.me = me();
    state.loads["/api/merchant/retention"] = { state: "error", message: "x" };
    expect(either(showing([row("loc-1", stamps)]))).toBe(false);
  });

  it("replaces the „Wiedergekommen“ tile while it shows; with the gate closed the four tiles stay as they were", () => {
    const shown = showing([row("loc-1", stamps)]);
    expect(labels(shown)).toEqual(["Neue Karten", "Prämien eingelöst"]); // the board leads with these bookings
    expect(shown.slice(shown.indexOf("<dialog"), shown.indexOf("</dialog>"))).not.toContain("gekommen"); // the sheet explains only the rows on screen
    expect(labels(showing([row("loc-1", null)]))).toEqual(["Neue Karten", "Wieder­gekommen", "Prämien eingelöst"]);
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ winbackSetting: { enabled: false, days: 30 } }));
    const off = showing([row("loc-1", null)]);
    expect(labels(off)).toContain("Wieder­gekommen");
    expect(off).toContain('href="/merchant/program/winback">Willkommen-zurück-Bonus ist aus</a>');
    state.hidden = ["walletMessages"]; // the pilot: the setting is on Programm, so the tile links there too
    expect(showing([row("loc-1", null)])).toContain('href="/merchant/program/winback">Willkommen-zurück-Bonus ist aus</a>');
  });

  it("follows the active location", () => {
    state.me = me({ locationId: "loc-2" });
    const shown = block(showing([row("loc-1", stamps), row("loc-2", { ...stamps, customers: 5, winback: 5, referral: 0 })]));
    expect(shown).toContain(`5${NBSP}Kunden`);
    expect(shown).toContain("<dd>5</dd>");
  });
});

describe("the four tiles (spec §1.3, copy T1–T5)", () => {
  it("say „vorher N“ with a full previous period, else what was counted; the first two weeks are named once, in the head", () => {
    const notes = (patch: Partial<LocationAnalytics>) => tilesOf(analytics(patch), { owner: true, bookingsHref: null, bonusHref: "/merchant/wallet-messages#winback-title" }).map(tile => typeof tile.note === "string" ? tile.note : "link");
    const counted = ["an der Kasse bestätigt", "erstmals angemeldet", "mit Willkommen-zurück-Bonus", "an der Kasse"];
    expect(notes({ programStartedOn: "2026-10-29", previous: null })).toEqual(counted);
    expect(notes({ programStartedOn: "2026-10-22" })).toEqual(counted); // never „vorher“ against days before the programme
    expect(firstWeeks({ programStartedOn: "2026-10-29", today: "2026-11-04" })).toBe("erste Woche");
    expect(firstWeeks({ programStartedOn: "2026-10-22", today: "2026-11-04" })).toBe("zweite Woche");
    expect(firstWeeks({ programStartedOn: "2026-10-21", today: "2026-11-04" })).toBeUndefined();
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ programStartedOn: "2026-10-22", previous: null }));
    const html = render();
    // Over the figure rows below 1024, in the title from 1024 (Design, 18 Nov): one of the two is shown at each width.
    expect(html).toMatch(/>Letzte 30 Tage an diesem Standort<span class="_titleNote_[^"]*"> · zweite Woche<\/span><\/h2>/);
    expect(html).toMatch(/<div class="[^"]*_factsNote_[^"]*"><p class="[^"]*">zweite Woche<\/p><\/div><(a|div) class="[^"]*"[^>]*data-fact/);
    expect(html.match(/zweite Woche/g)).toHaveLength(2);
    expect(notes({})).toEqual(["vorher 10", "vorher 0", "vorher 1", "vorher 1"]);
    expect(notes({ previous: null })).toEqual(["an der Kasse bestätigt", "erstmals angemeldet", "mit Willkommen-zurück-Bonus", "an der Kasse"]);
  });
  it("show „–“ for a shop with the bonus off, linked to the setting for the owner where it is offered, and name the owner's days in „?“", () => {
    const off = analytics({ winbackSetting: { enabled: false, days: 45 } });
    const owner = tilesOf(off, { owner: true, bookingsHref: null, bonusHref: "/merchant/wallet-messages#winback-title" })[2];
    expect(owner.value).toBe("–");
    expect(renderToStaticMarkup(createElement("p", null, owner.note))).toContain('href="/merchant/wallet-messages#winback-title"');
    expect(tilesOf(off, { owner: true, bookingsHref: null, bonusHref: null })[2].note).toBe("Willkommen-zurück-Bonus ist aus"); // withheld page: no dead link
    expect(tilesOf(off, { owner: false, bookingsHref: null, bonusHref: "/x" })[2].note).toBe("Willkommen-zurück-Bonus ist aus");
    expect(owner.help).toBe("Karten, die nach über 45 Tagen wiederkamen und den Willkommen-zurück-Bonus bekamen.");
  });
  it("show „–“ and when it appears for a thing that never happened here, and a real 0 after earlier activity as 0 (T6)", () => {
    const a = analytics({ current: { newCards: 0, qualifyingCheckouts: 9, repeatCards: 0, redemptions: 0, winbacks: 0 }, previous: null });
    const shown = (stats: MeResponse["stats"]) => tilesOf(a, { owner: true, stats, bookingsHref: null, bonusHref: null }).map(tile => [tile.value, tile.note]);
    expect(shown({ members: 0, awards: 3, redemptions: 0 })).toEqual([["9", "an der Kasse bestätigt"], ["–", "erscheint mit der ersten Anmeldung"], ["0", "mit Willkommen-zurück-Bonus"], ["–", "erscheint nach der ersten Einlösung"]]);
    expect(shown({ members: 5, awards: 3, redemptions: 1 })).toEqual([["9", "an der Kasse bestätigt"], ["0", "erstmals angemeldet"], ["0", "mit Willkommen-zurück-Bonus"], ["0", "an der Kasse"]]);
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
    expect(html).toMatch(/>1<small>von 3<\/small><\/p><p class="[^"]*">Pflichtschritte erledigt<\/p>/);
    expect(html).toMatch(/<h1 class="ow-hello[^"]*"><span class="ow-sr">Dein Treueprogramm einrichten: <\/span>Willkommen bei Loynara, Café Lindenblatt\.<\/h1>/);
    // The current step leads „Als Nächstes“; its external link opens in a new tab, under the sentence.
    expect(html).toMatch(/<b>Melde die erste Karte selbst an\.<\/b><small>Mit deinem eigenen Handy\.[^<]*<\/small><\/span><a class="[^"]*" target="_blank" rel="noopener noreferrer" href="http:\/\/localhost:3000\/join\/cafe">Anmeldelink öffnen<svg/);
    expect(html.indexOf('data-ow="next"')).toBeLessThan(html.indexOf("Pflichtschritte erledigt")); // the board holds the count and the chart
    expect(html).toContain("Hier siehst du bald jeden Tag am Tresen.");
    for (const text of ["Programm und Prämie", "Stempelkarte · 8 Stempel → Kugel", "Erste Karte anmelden", "Mit Anmeldelink oder Tresenschild", "Erste Buchung an der Kasse", "Ein Stempel auf deine eigene Karte.", "Einlösung einmal durchspielen", "Zeigt deinem Team die Bestätigung."]) expect(html).toContain(text);
    expect(html).not.toContain("NFC am Tresen");
    expect(html).not.toContain("Kundenkarte gestaltet");
    expect(html).not.toContain("Wenn du magst");
    // Done is the green check; an open step an empty ring, never a grey fill that reads as loading (Design, 18 Nov).
    expect([...html.matchAll(/data-state="(\w+)">(<span class="_tile_[^"]*" aria-hidden="true"><svg[^>]*lucide-check|<span class="_ring_[^"]*" aria-hidden="true"><\/span>)/g)].map(match => `${match[1]}:${match[2].includes("check") ? "check" : "ring"}`))
      .toEqual(["done:check", "current:ring", "open:ring", "open:ring"]);
    expect(html).not.toContain("Kunden einladen"); // under Kunden since ENG-122a
  });

  it("a step without an action is a band without an arrow that nothing can tap; a failed read keeps the white card", () => {
    state.loads["/api/merchant/readiness"] = ok(readiness([{ id: "programme", group: "setup", required: true, status: "todo", title: "Programm und Prämie", evidence: "Noch kein Programm." }]));
    const html = render();
    const next = html.slice(html.indexOf('data-ow="next"'), html.indexOf('data-ow="board"'));
    expect(next).toMatch(/<b>Noch kein Programm\.<\/b><\/span><\/span><\/div><\/div><\/section>/);
    expect(next).not.toMatch(/<a |<button/);
    state.loads["/api/merchant/readiness"] = { state: "error", message: "x" };
    const failed = render();
    expect(failed).toMatch(/data-ow="board"[^]*Die Zahlen sind gerade nicht da\.[^]*>Erneut laden<\/button>/);
    expect(failed).not.toContain('data-ow="next"');
  });

  it("gives a manager no owner-only links", () => {
    state.me = me({ role: "manager", programType: "stamp", stats: { members: 0, awards: 0, redemptions: 0 } });
    const html = render();
    expect(html).not.toContain("/merchant/staff");
    expect(html).not.toContain("/merchant/program/card");
    expect(html).not.toContain("Tresenschild laden"); // the Leitung finds it under Kunden (ENG-122a), which it can open
  });
});
