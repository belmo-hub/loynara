import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";
import { PointsLadder } from "./points-ladder";
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
});

describe("PointsLadder", () => {
  const rewards = [{ title: "Kleiner Kaffee", cost: 30 }, { title: "Stück Kuchen", cost: 70 }, { title: "Frühstück für zwei", cost: 150 }];
  it("describes the balance against the most expensive reward", () => {
    const out = html(h(PointsLadder, { balance: 64, rewards }));
    expect(out).toContain('aria-label="64 von 150 Punkten"');
    expect(out.match(/data-reached="true"/g)).toHaveLength(1);
  });
  it("draws nothing when the programme has no reward yet", () => {
    expect(html(h(PointsLadder, { balance: 64, rewards: [] }))).toBe("");
  });
  it("hides labels of markers that would collide", () => {
    const out = html(h(PointsLadder, { balance: 0, rewards: [{ title: "A", cost: 10 }, { title: "B", cost: 11 }, { title: "C", cost: 100 }] }));
    expect(out.match(/data-label-hidden="true"/g)).toHaveLength(1);
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
    expect(out).toMatch(/<dd[^>]*>10<\/dd>/);
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
