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

describe("euro card (item 7, L3, ENG-077)", () => {
  it("leads with entering the average, not a count under the revenue title, while nothing has an amount", () => {
    const unpriced = figures({ visits: 6, unpricedVisits: 6, newCardMinor: 0, returningCardMinor: 0 });
    const html = render(spend(unpriced, { ...unpriced, newCardMinor: null, returningCardMinor: null }));
    expect(html).toContain("Durchschnittsbon eintragen");
    expect(html).toMatch(/class="ow-btn ow-btn--primary ow-btn--sm" href="\/merchant\/program"/); // a 44 px control, not a 21 px text link
    expect(html).not.toContain("ow-metric-value");
    expect(html).not.toContain("6 Buchungen");
  });

  it("names bookings „Buchungen“, never „Besuche“, keeps the method behind one summary and does not repeat a location's count", () => {
    const recent = figures({ visits: 10, spentMinor: 18_220, realMinor: 18_220, averagePerVisitMinor: 1_822, newCardMinor: 13_290, returningCardMinor: 4_930 });
    const total = figures({ visits: 29, spentMinor: 47_970, realMinor: 47_970, averagePerVisitMinor: 1_654 });
    const html = render(spend(recent, total, [{ locationId: "a", name: "Kassel Süd", recentFrom: "2026-09-25T22:00:00.000Z", recent, total }]), true);
    expect(html).toContain("10 Buchungen");
    expect(html).toContain("pro Buchung");
    expect(html).not.toContain("Besuch");
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).toContain("So zählen wir den Umsatz");
    expect(html.match(/10 Buchungen/g)).toHaveLength(1); // the location row shows amounts only
    expect(html).toContain("Kassel Süd");
  });

  it("shows the reminder with a 44 px control when only some bookings have no amount", () => {
    const recent = figures({ visits: 4, spentMinor: 3_000, estimatedMinor: 3_000, averagePerVisitMinor: 1_000, unpricedVisits: 1, newCardMinor: 0, returningCardMinor: 3_000 });
    const html = render(spend(recent, { ...recent, newCardMinor: null, returningCardMinor: null }));
    expect(html).toContain("geschätzt");
    expect(html).toContain("4 Buchungen · Ø\u00a010,00\u00a0€ pro\u00a0Buchung mit Betrag"); // the average covers the priced bookings only
    expect(html).toMatch(/class="ow-btn ow-btn--secondary ow-btn--sm" href="\/merchant\/program">Durchschnittsbon eintragen/);
  });
});
