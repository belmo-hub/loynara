import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";
import { hideTouchingPrices, PointsLadder, titleLayout } from "./points-ladder";
import { ProgressRing } from "./progress-ring";
import { Skeleton } from "./skeleton";
import { StampGrid } from "./stamp-grid";
import { Stat, StatGroup } from "./stat";

const html = renderToStaticMarkup;

describe("StampGrid", () => {
  it("announces progress once and renders one slot per required stamp", () => {
    const out = html(h(StampGrid, { earned: 6, total: 8 }));
    expect(out).toContain('aria-label="6 von 8 Stempeln"');
    expect(out.match(/<li/g)).toHaveLength(8);
    expect(out.match(/data-earned="true"/g)).toHaveLength(6);
  });
  it("marks only the newest stamp for the landing motion", () => {
    expect(html(h(StampGrid, { earned: 3, total: 8, landed: 3 })).match(/data-new="true"/g)).toHaveLength(1);
  });
  it("never shows more earned stamps than slots", () => {
    expect(html(h(StampGrid, { earned: 11, total: 8 })).match(/data-earned="true"/g)).toHaveLength(8);
  });
  it("speaks French when asked", () => {
    expect(html(h(StampGrid, { earned: 1, total: 5, locale: "fr" }))).toContain('aria-label="1 tampon sur 5"');
  });
  it("says a one-stamp card in the singular, and French zero too (ENG-108)", () => {
    expect(html(h(StampGrid, { earned: 0, total: 1 }))).toContain('aria-label="0 von 1 Stempel"');
    expect(html(h(StampGrid, { earned: 0, total: 2 }))).toContain('aria-label="0 von 2 Stempeln"');
    expect(html(h(StampGrid, { earned: 0, total: 5, locale: "fr" }))).toContain('aria-label="0 tampon sur 5"');
    expect(html(h(StampGrid, { earned: 2, total: 5, locale: "fr" }))).toContain('aria-label="2 tampons sur 5"');
  });
  it("draws one track instead of a mark per stamp above 30 stamps", () => {
    const long = html(h(StampGrid, { earned: 40, total: 1000 }));
    expect(long).not.toContain("<li");
    expect(long).toContain('role="img"');
    expect(long).toContain('aria-label="40 von 1000 Stempeln"');
    expect(html(h(StampGrid, { earned: 0, total: 30 })).match(/<li/g)).toHaveLength(30);
  });
});

describe("PointsLadder", () => {
  const rewards = [{ title: "Kleiner Kaffee", cost: 30 }, { title: "Stück Kuchen", cost: 70 }, { title: "Frühstück für zwei", cost: 150 }];
  it("describes the balance against the most expensive reward", () => {
    const out = html(h(PointsLadder, { balance: 64, rewards }));
    expect(out).toContain('aria-label="64 von 150 Punkten"');
    expect(out.match(/data-reached="true"/g)).toHaveLength(1);
  });
  it("counts one point in the singular in French (ENG-104)", () => {
    expect(html(h(PointsLadder, { balance: 1, rewards, locale: "fr" }))).toContain('aria-label="1 point sur 150"');
    expect(html(h(PointsLadder, { balance: 2, rewards, locale: "fr" }))).toContain('aria-label="2 points sur 150"');
    expect(html(h(PointsLadder, { balance: 1, rewards }))).toContain('aria-label="1 von 150 Punkten"');
  });
  it("writes large numbers with the thousands separator, on the markers and in its name", () => {
    const out = html(h(PointsLadder, { balance: 124800, rewards: [{ title: "Gratis-Getränk", cost: 500 }, { title: "Wochenende", cost: 250000 }] }));
    expect(out).toContain(">250.000</small>");
    expect(out).not.toContain(">250000<");
    expect(out).toContain('aria-label="124.800 von 250.000 Punkten"');
  });
  it("says a one-point reward in the singular, and French zero too (ENG-108)", () => {
    expect(html(h(PointsLadder, { balance: 0, rewards: [{ title: "Kaffee", cost: 1 }] }))).toContain('aria-label="0 von 1 Punkt"');
    expect(html(h(PointsLadder, { balance: 0, rewards: [{ title: "Kaffee", cost: 2 }] }))).toContain('aria-label="0 von 2 Punkten"');
    expect(html(h(PointsLadder, { balance: 0, rewards, locale: "fr" }))).toContain('aria-label="0 point sur 150"');
  });
  it("draws nothing when the programme has no reward yet", () => {
    expect(html(h(PointsLadder, { balance: 64, rewards: [] }))).toBe("");
  });
  it("hides labels of markers that would collide", () => {
    const out = html(h(PointsLadder, { balance: 0, rewards: [{ title: "A", cost: 10 }, { title: "B", cost: 11 }, { title: "C", cost: 100 }] }));
    expect(out.match(/data-label-hidden="true"/g)).toHaveLength(1);
  });
  // ENG-292 (Design, 20 Nov): the mix card's crossed marks press 90 ms apart, in order, at the Kasse as on the guest card.
  it("staggers the marks a booking crossed 90 ms apart", () => {
    const out = html(h(PointsLadder, { balance: 162, landedFrom: 42, tone: "mix", rewards: [{ title: "Espresso", cost: 50 }, { title: "Pizza", cost: 150 }, { title: "Menü", cost: 300 }] }));
    const marks = [...out.matchAll(/<span class="[^"]*mark[^"]*" style="([^"]*)"[^>]*data-new="true"/g)].map((m) => m[1]);
    expect(marks).toHaveLength(2);
    expect(marks[0]).not.toContain("--land-stagger");
    expect(marks[1]).toContain("--land-stagger:90ms");
  });
  // ENG-292 (Design, 20 Nov): in the mix tone a name is never cut with an ellipsis; without its room it hides, cost and dot stay.
  it("hides a name in the mix tone instead of cutting it", () => {
    const marks = [{ at: 0.2, hideLabel: false }, { at: 0.5, hideLabel: false }, { at: 1, hideLabel: false }];
    const needs = [60, 150, 60];
    const house = titleLayout(marks, 300, needs);
    expect(house.titles[1]?.width).toBeLessThan(150); // the house ladder cuts it
    expect(titleLayout(marks, 300, needs, undefined, true).titles[1]).toBeNull();
    expect(titleLayout(marks, 300, needs, undefined, true).titles[0]?.width).toBe(60);
  });
});

describe("ProgressRing", () => {
  it("is a progressbar with its value", () => {
    const out = html(h(ProgressRing, { value: 6, max: 8, label: "Stempel bis zur Prämie" }));
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="6"');
    expect(out).toContain('aria-valuemax="8"');
  });
});

describe("Stat", () => {
  it("renders label and value as a description pair inside a list", () => {
    const out = html(h(StatGroup, { label: "Kennzahlen" }, h(Stat, { label: "Aktive Karten", value: 10, note: "10 neu in 30 Tagen" })));
    expect(out).toMatch(/^<dl[^>]*aria-label="Kennzahlen"/);
    expect(out).toMatch(/<dt[^>]*>Aktive Karten<\/dt>/);
    expect(out).toMatch(/<dd[^>]*><span[^>]*>10<\/span><\/dd>/);
  });
  it("summarises a trend in words for screen readers", () => {
    const out = html(h(Stat, { label: "Besuche", value: 36, trend: [{ label: "KW 38", value: 0 }, { label: "KW 41", value: 36 }] }));
    expect(out).toMatch(/role="img"[^>]*aria-label="Verlauf: KW 38 0, KW 41 36"/);
  });
  it("formats numbers in German", () => {
    expect(html(h(Stat, { label: "Besuche", value: 1284 }))).toContain("1.284");
  });
});

describe("EmptyState, Skeleton, PageHeader", () => {
  it("renders an empty state with a heading and its action", () => {
    const out = html(h(EmptyState, { title: "Noch keine Kampagnen", action: h("a", { href: "#" }, "Kampagne anlegen") }, "Mit einer Kampagne erinnerst du Gäste an ihre Karte."));
    expect(out).toMatch(/<h2[^>]*>Noch keine Kampagnen<\/h2>/);
    expect(out).toContain("Kampagne anlegen");
  });
  it("keeps skeletons out of the accessibility tree", () => {
    expect(html(h(Skeleton, { height: 40 }))).toContain('aria-hidden="true"');
  });
  it("renders one h1 with context and actions", () => {
    const out = html(h(PageHeader, { title: "Übersicht", description: "Kassel Mitte, letzte 30 Tage", actions: h("button", null, "Kasse öffnen") }));
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain("Kasse öffnen");
  });
});

// Design, 12 Nov (ruling 49): a price with its thousands separator is wider than the 24 px the fixed gap assumed.
describe("hideTouchingPrices", () => {
  const marks = (...at: number[]) => at.map(a => ({ at: a, hideLabel: false }));
  const hidden = (list: Array<{ hideLabel: boolean }>) => list.map(m => m.hideLabel);
  it("hides a price that would touch the goal's, by the labels' own widths", () => {
    expect(hidden(hideTouchingPrices(marks(0.83, 1), 300, [56, 72]))).toEqual([true, false]);
  });
  it("keeps a price that has room, and lets the earlier one win among the others", () => {
    expect(hidden(hideTouchingPrices(marks(0.4, 1), 300, [56, 72]))).toEqual([false, false]);
    expect(hidden(hideTouchingPrices(marks(0.4, 0.55, 1), 300, [56, 56, 72]))).toEqual([false, true, false]);
  });
  it("leaves three-digit prices as they were", () => {
    expect(hidden(hideTouchingPrices(marks(0.4, 0.6, 1), 228, [24, 24, 24]))).toEqual([false, false, false]);
  });
});
