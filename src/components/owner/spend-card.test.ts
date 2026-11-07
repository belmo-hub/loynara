import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MerchantSpend, SpendFigures } from "@/lib/merchant-analytics";

const state = vi.hoisted(() => ({ spend: null as MerchantSpend | null }));
vi.mock("./use-load", () => ({ useLoad: () => [{ state: "ok", data: state.spend, at: 0 }, () => {}] }));

import { SpendCard } from "./spend-card";

const figures = (patch: Partial<SpendFigures>): SpendFigures => ({ visits: 0, spentMinor: 0, realMinor: 0, estimatedMinor: 0, unpricedVisits: 0, averagePerVisitMinor: null, newCardMinor: null, returningCardMinor: null, ...patch });
const spend = (recent: SpendFigures, total: SpendFigures, locations: MerchantSpend["locations"] = []): MerchantSpend => ({ asOf: "2026-10-24T10:00:00.000Z", currency: "EUR", overall: { recent, total }, locations });
const render = (s: MerchantSpend, multiLocation = false) => { state.spend = s; return renderToStaticMarkup(createElement(SpendCard, { multiLocation })); };
// A whole row is the control (64 px tall), as on the Programm list.
const AVERAGE_ROW = /<a class="ow-prog-row" href="\/merchant\/program\/average-spend">(?:(?!<\/a>).)*<strong>Durchschnittsbon eintragen<\/strong>/;

describe("euro section (item 7, L3, ENG-077)", () => {
  it("leads with entering the average, not a count under the revenue title, while nothing has an amount", () => {
    const unpriced = figures({ visits: 6, unpricedVisits: 6, newCardMinor: 0, returningCardMinor: 0 });
    const html = render(spend(unpriced, { ...unpriced, newCardMinor: null, returningCardMinor: null }));
    expect(html).toMatch(AVERAGE_ROW);
    expect(html).not.toContain("ow-prog-value");
    expect(html).not.toContain("6 Buchungen");
  });

  it("names bookings „Buchungen“, never „Besuche“, keeps the method behind one „?“ and does not repeat a location's count", () => {
    const recent = figures({ visits: 10, spentMinor: 18_220, realMinor: 18_220, averagePerVisitMinor: 1_822, newCardMinor: 13_290, returningCardMinor: 4_930 });
    const total = figures({ visits: 29, spentMinor: 47_970, realMinor: 47_970, averagePerVisitMinor: 1_654 });
    const html = render(spend(recent, total, [{ locationId: "a", name: "Kassel Süd", recentFrom: "2026-09-25T22:00:00.000Z", recent, total, brought: null }]), true);
    expect(html).toContain("10 Buchungen");
    expect(html).toContain("10 Buchungen · Ø 18,22 € pro Buchung");
    expect(html).not.toContain("Besuch");
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(1);
    expect(html).toContain("So zählen wir den Umsatz");
    expect(html.match(/10 Buchungen/g)).toHaveLength(1); // the location row shows amounts only
    expect(html).toContain("Kassel Süd");
    expect(html).toContain('<span class="ow-prog-value" data-big="true">182,20 €</span>');
  });

  it("gives a location without any booking 0 €, not „ohne Betrag“", () => {
    const recent = figures({ visits: 10, spentMinor: 18_220, realMinor: 18_220, averagePerVisitMinor: 1_822 });
    const html = render(spend(recent, recent, [{ locationId: "b", name: "Neu", recentFrom: "2026-09-25T22:00:00.000Z", recent: figures({}), total: figures({}), brought: null }]), true);
    expect(html).not.toContain("ohne Betrag");
    expect(html).toMatch(/Neu<\/strong><small>[^<]*0,00\s€[^<]*0,00\s€/);
  });

  it("shows the reminder with a whole-row control when only some bookings have no amount", () => {
    const recent = figures({ visits: 4, spentMinor: 3_000, estimatedMinor: 3_000, averagePerVisitMinor: 1_000, unpricedVisits: 1, newCardMinor: 0, returningCardMinor: 3_000 });
    const html = render(spend(recent, { ...recent, newCardMinor: null, returningCardMinor: null }));
    expect(html).toContain("geschätzt");
    expect(html).toContain("3 Buchungen mit Betrag · Ø 10,00 € pro Buchung"); // ENG-084, Marketing's line: 3 of the 4 bookings had an amount
    expect(html).toContain("Für Buchungen ohne Kassenbetrag fehlt dein Durchschnittsbon.");
    expect(html).toMatch(AVERAGE_ROW);
  });
});
