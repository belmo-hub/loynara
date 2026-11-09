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

import { boardOf, milestoneToShow, Overview, quietOf, tilesOf } from "./overview";
import { countUpFrom } from "./overview-board";

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
const render = () => renderToStaticMarkup(createElement(Overview));
/** The 30-day rows' labels, in order. */
const labels = (html: string) => [...html.matchAll(/<div class="ow-prog-row">|<a class="ow-prog-row"[^>]*>/g)].map(match => html.slice(match.index).match(/<strong>([^<]+)<\/strong>/)![1]);

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
    expect(html).toMatch(/<h1 class="ow-hello"><span class="ow-sr">Übersicht: <\/span>Guten (Morgen|Tag|Abend), Lena\.<\/h1>/); // the visible heading, outside the card
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
    // Wegweiser rows: label, note as sub-line, the value at the right edge; the whole linked row is the link, with the arrow.
    const link = html.match(/<a class="ow-prog-row" href="([^"]+)">(.*?)<\/a>/);
    expect(link?.[1]).toBe("/merchant/customers?activity=recent&amp;days=30&amp;locationId=loc-1");
    expect(link?.[2]).toMatch(/<span class="ow-prog-value" data-big="">9<\/span><span class="ow-prog-text"><strong>Buchungen<\/strong><small>vorher 10<\/small><\/span><\/span><svg[^>]*ow-prog-arrow/);
    // The link's name reads the value before the comparison: „9 Buchungen vorher 10“, never „Buchungen vorher 10 9“.
    expect(link?.[2].replace(/<svg.*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).toBe("9 Buchungen vorher 10");
    expect(html.match(/class="ow-prog-row"/g)).toHaveLength(4);
    expect(html.match(/ow-prog-arrow/g)).toHaveLength(1); // only the linked row; the other Kunden filters come with ENG-086
    // One „?“ for all rows, on the section head; the shared sheet lists the four help texts under their labels, word for word.
    expect(html.match(/class="ow-tile-q"/g)).toHaveLength(1);
    expect(html).toMatch(/<h2 id="[^"]+" class="ow-tiles-title">Letzte 30 Tage an diesem Standort<\/h2><button type="button" class="ow-tile-q" aria-haspopup="dialog">/);
    const sheet = html.slice(html.lastIndexOf("<dialog"), html.lastIndexOf("</dialog>"));
    expect(sheet).toMatch(/<h2 id="[^"]+" class="[^"]*">So zählen wir<\/h2>/);
    expect([...sheet.matchAll(/<h3>([^<]+)<\/h3><p>([^<]+)<\/p>/g)].map(match => `${match[1]}: ${match[2]}`)).toEqual([
      "Buchungen: Jede bestätigte Buchung an der Kasse, Korrekturen abgezogen.", "Neue Karten: Karten, die sich in diesem Zeitraum zum ersten Mal angemeldet haben.",
      "Wieder\u00adgekommen: Karten, die nach über 30 Tagen wiederkamen und den Willkommen-zurück-Bonus bekamen.", "Prämien eingelöst: Prämien, die dein Team an der Kasse eingelöst hat."]);
    expect(sheet).toContain("Schließen");
    expect(html.indexOf('class="ow-hello"')).toBeLessThan(html.indexOf('class="ow-board"'));
    for (const gone of ["Was jetzt zählt", "Letzte Vorgänge", "Programm bearbeiten", "Gerade nichts Dringendes", "Für Excel", "↑", "↓"]) expect(html).not.toContain(gone);
  });

  it("a shop without till amounts leads with bookings (Q-81 switch off), whatever the average says", () => {
    state.loads["/api/merchant/spend"] = ok(spend(figures({ visits: 6, spentMinor: 9_000, estimatedMinor: 9_000, averagePerVisitMinor: 1_500 })));
    const html = render();
    expect(html).toContain('aria-label="Buchungen, letzte 30 Tage"');
    expect(html).toContain(`9${NBSP}<small>Buchungen</small>`);
    expect(html).toContain("letzte 30 Tage, Korrekturen abgezogen");
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
    expect(html).toMatch(/<section class="ow-next" aria-label="Als Nächstes"><button type="button" class="ow-band">[^]*<span class="ow-band-go">Tresenschild laden<svg/);
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
    expect(html).toContain('<p class="ow-board-news">Seit über 90 Tagen keine Buchung.</p>');
    expect(html).toContain("<b>Seit über 90 Tagen keine Buchung. Steht das Tresenschild noch gut sichtbar?</b>");
    expect(html).not.toContain("keine Buchung</p>"); // no diary gap without a known last booking
    expect(html).not.toContain("Die letzten Tage am Tresen"); // and no diary heading over nothing
    expect(quietOf({ lastBookingOn: null, programStartedOn: "2026-08-05", today: "2026-11-04" })).toBe("over90"); // 91 days
    expect(quietOf({ lastBookingOn: null, programStartedOn: "2026-08-06", today: "2026-11-04" })).toBeNull(); // 90 days: every booking would be in the read
    expect(quietOf({ lastBookingOn: null, programStartedOn: null, today: "2026-11-04" })).toBeNull();
    expect(quietOf({ lastBookingOn: "2026-10-28", programStartedOn: "2026-06-01", today: "2026-11-04" })).toBe(7);
    expect(quietOf({ lastBookingOn: "2026-10-29", programStartedOn: "2026-06-01", today: "2026-11-04" })).toBeNull();
  });

  it("next step: cards away and rewards ready in one line with „Ansehen“", () => {
    state.loads["/api/merchant/retention"] = ok({ ...retention, drifting: 2 });
    expect(render()).toContain(`<b>2${NBSP}Karten fehlen seit über 30 Tagen.</b>`);
    // With the bonus off, the bar's button switches it on, on Programm (not „Ansehen“ to the setting).
    state.loads["/api/merchant/analytics/location"] = ok(analytics({ winback: { enabled: false, inWindow: 0 } }));
    expect(render()).toMatch(/<a class="ow-band" href="\/merchant\/program\/winback">[^]*<span class="ow-band-go">Willkommen-zurück-Bonus einschalten<svg/);
    state.loads["/api/merchant/analytics/location"] = ok(analytics());
    state.loads["/api/merchant/retention"] = ok({ ...retention, rewardReady: 1 });
    const html = render();
    expect(html).toContain(`<b>1${NBSP}Karte kann jetzt eine Prämie einlösen.</b>`);
    expect(html).toMatch(/<a class="ow-band" href="[^"]+">[^]*<span class="ow-band-go">Ansehen<svg/);
    expect(html.indexOf('class="ow-next"')).toBeLessThan(html.indexOf('class="ow-board"')); // in the flow, under the greeting
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
    expect(html).toContain('<div class="ow-prog-row">'); // unlinked rows carry no arrow
    expect(html).toContain('<span class="ow-prog-value" data-big="">–</span><span class="ow-prog-text"><strong>Wieder\u00adgekommen</strong><small>Willkommen-zurück-Bonus ist aus</small></span>');
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
    expect(html).not.toContain("ow-prog-row");
    expect(html.match(/Lädt, sobald die Verbindung wieder da ist\./g)).toHaveLength(1); // once, beside the board
    expect(html).not.toContain("Die letzten Tage am Tresen");
    expect(html).not.toContain("ow-band"); // no next step beside stale numbers, though cards are away
    state.me = me({ userId: "someone-else" }); // another person on this device
    expect(render()).toContain("Die Zahlen sind gerade nicht da.");
    state.me = me();
    stored.set(boardCacheKey("u", "loc-1"), JSON.stringify({ at: new Date(Date.now() - 8 * 86_400_000).toISOString(), board })); // older than 7 days
    expect(render()).toContain("Die Zahlen sind gerade nicht da.");
  });

  it("diary: one entry per day, „Korrektur −2“ as its own pill, the redeemed reward marked once, the rest counted, no times", () => {
    const html = render();
    expect(html).toContain("<h3>Gestern</h3>");
    expect(html).toContain(`3${NBSP}Buchungen · 21${NBSP}Punkte vergeben`);
    expect(html).toContain("Sonntag, 01.11.");
    expect(html).toContain('aria-label="Korrektur, 2 Punkte zurückgenommen"><span aria-hidden="true">Korrektur −2</span>');
    // An undone redemption gives the units back: muted, no number on the pill, the count only in the spoken label.
    expect(html).toContain('data-kind="correction" aria-label="Einlösung rückgängig gemacht, 100 Punkte wieder auf der Karte"><span aria-hidden="true">Einlösung rückgängig</span>');
    expect(html).toContain('aria-label="Einlösung rückgängig gemacht, 1 Punkt wieder auf der Karte"');
    expect(html).not.toContain("Korrektur +");
    expect(html.match(/data-kind="redemption"/g)).toHaveLength(1);
    expect(html).toContain(`3${NBSP}weitere`);
    expect(html).not.toMatch(/\d{1,2}:\d{2}/);
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
    expect(html.indexOf("ow-brought")).toBeGreaterThan(html.indexOf('class="ow-board"'));
    expect(html.indexOf("ow-brought")).toBeLessThan(html.indexOf("ow-tiles-title"));
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
    expect(band).toMatch(/<a class="ow-brought-off" href="\/merchant\/program\/winback"><span><svg[^]*<\/svg><\/span><span><b>Willkommen-zurück-Bonus einschalten<\/b><small>Ein kleiner Bonus für Kunden, die länger nicht da waren.<\/small><\/span><svg/);
    expect(band).not.toContain('<section class="ow-brought"');
    state.loads["/api/merchant/analytics/location"] = ok(analytics());
    expect(showing([row("loc-1", null)])).not.toContain("ow-brought");
    off();
    state.me = me({ role: "manager" });
    expect(showing([row("loc-1", stamps)])).not.toContain("ow-brought");
    state.me = me();
    state.loads["/api/merchant/retention"] = { state: "error", message: "x" };
    expect(showing([row("loc-1", stamps)])).not.toContain("ow-brought");
  });

  it("replaces the „Wiedergekommen“ tile while it shows; with the gate closed the four tiles stay as they were", () => {
    const shown = showing([row("loc-1", stamps)]);
    expect(labels(shown)).toEqual(["Buchungen", "Neue Karten", "Prämien eingelöst"]);
    expect(shown.slice(shown.lastIndexOf("<dialog"), shown.lastIndexOf("</dialog>"))).not.toContain("gekommen"); // the sheet explains only the rows on screen
    expect(labels(showing([row("loc-1", null)]))).toEqual(["Buchungen", "Neue Karten", "Wieder­gekommen", "Prämien eingelöst"]);
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
  it("say „erste Woche“ and „zweite Woche“ after the programme start, „vorher N“ with a full previous period, else what was counted", () => {
    const notes = (patch: Partial<LocationAnalytics>) => tilesOf(analytics(patch), { owner: true, bookingsHref: null, bonusHref: "/merchant/wallet-messages#winback-title" }).map(tile => typeof tile.note === "string" ? tile.note : "link");
    expect(notes({ programStartedOn: "2026-10-29", previous: null })).toEqual(["erste Woche", "erste Woche", "erste Woche", "erste Woche"]);
    expect(notes({ programStartedOn: "2026-10-22", previous: null })).toEqual(["zweite Woche", "zweite Woche", "zweite Woche", "zweite Woche"]);
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

describe("delight beat 1 (spec §6.1)", () => {
  it("counts „Neue Karten“ up only from a lower number this browser showed, and never under reduced motion", () => {
    expect(countUpFrom(3, 5, true)).toBe(3);
    expect(countUpFrom(null, 5, true)).toBeNull(); // first visit
    expect(countUpFrom(5, 5, true)).toBeNull();
    expect(countUpFrom(7, 5, true)).toBeNull(); // the 30-day window moved on: no count-down
    expect(countUpFrom(3, 5, false)).toBeNull();
    expect(countUpFrom(Number.NaN, 5, true)).toBeNull();
    const cards = tilesOf(analytics(), { owner: true, seenKey: "k", bookingsHref: null, bonusHref: null })[1];
    expect(cards).toMatchObject({ value: "4", count: 4, seenKey: "k" });
    expect(tilesOf(analytics(), { owner: true, stats: { members: 0, awards: 1, redemptions: 0 }, seenKey: "k", bookingsHref: null, bonusHref: null })[1].count).toBeUndefined();
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
    expect(html).toContain(`<p class="ow-board-big">1${NBSP}<small>von 3</small></p><p class="ow-board-sub">Pflichtschritte erledigt</p>`);
    expect(html).toContain('<h1 class="ow-hello"><span class="ow-sr">Dein Treueprogramm einrichten: </span>Willkommen bei Loynara, Café Lindenblatt.</h1>');
    // The current step is the green band; its external link opens in a new tab, its label the last line.
    expect(html).toMatch(/<a class="ow-band" target="_blank" rel="noopener noreferrer" href="http:\/\/localhost:3000\/join\/cafe">[^]*<b>Melde die erste Karte selbst an\.<\/b><small>Mit deinem eigenen Handy\.[^<]*<\/small><span class="ow-band-go">Anmeldelink öffnen<svg/);
    expect(html.indexOf('class="ow-band"')).toBeLessThan(html.indexOf("Pflichtschritte erledigt")); // the card holds the count and the strip
    expect(html).toContain("Hier siehst du bald jeden Tag am Tresen.");
    for (const text of ["Programm und Prämie", "Stempelkarte · 8 Stempel → Kugel", "Erste Karte anmelden", "Mit Anmeldelink oder Tresenschild", "Erste Buchung an der Kasse", "Ein Stempel auf deine eigene Karte.", "Einlösung einmal durchspielen", "Zeigt deinem Team die Bestätigung."]) expect(html).toContain(text);
    expect(html).not.toContain("NFC am Tresen");
    expect(html).not.toContain("Kundenkarte gestaltet");
    expect(html).not.toContain("Wenn du magst");
    expect([...html.matchAll(/class="ow-day" data-state="(\w+)"><div class="ow-day-rail" aria-hidden="true"><i>(<svg)?/g)].map(match => `${match[1]}${match[2] ? "+check" : ""}`))
      .toEqual(["done+check", "current", "open", "open"]); // done, current and open differ by shape
    expect(html).not.toContain("Kunden einladen"); // under Kunden since ENG-122a
  });

  it("a step without an action is a band without an arrow that nothing can tap; a failed read keeps the white card", () => {
    state.loads["/api/merchant/readiness"] = ok(readiness([{ id: "programme", group: "setup", required: true, status: "todo", title: "Programm und Prämie", evidence: "Noch kein Programm." }]));
    const html = render();
    expect(html).toMatch(/<div class="ow-band">[^]*<b>Noch kein Programm\.<\/b><\/span><\/div>/);
    expect(html).not.toContain("ow-band-go");
    state.loads["/api/merchant/readiness"] = { state: "error", message: "x" };
    const failed = render();
    expect(failed).toMatch(/<section class="ow-board"[^]*Die Zahlen sind gerade nicht da\.[^]*>Erneut laden<\/button>/);
    expect(failed).not.toContain("ow-band");
  });

  it("gives a manager no owner-only links", () => {
    state.me = me({ role: "manager", programType: "stamp", stats: { members: 0, awards: 0, redemptions: 0 } });
    const html = render();
    expect(html).not.toContain("/merchant/staff");
    expect(html).not.toContain("/merchant/program/card");
    expect(html).not.toContain("Tresenschild laden"); // the Leitung finds it under Kunden (ENG-122a), which it can open
  });
});
