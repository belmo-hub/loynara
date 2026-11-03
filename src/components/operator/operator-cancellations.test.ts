import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
import { OperatorClient } from "./operator-client";

const fact = (value: string) => ({ label: "x", value, sub: "" });
const facts = { lastDay: fact("27.11.2026"), lastInvoice: fact("Keine weitere Rechnung"), exportUntil: fact("27.12.2026") };
const cancellation = (over: Record<string, unknown> = {}) => ({ tenantId: "t1", tenant: "Café Lindenblatt", locations: ["Kassel Mitte", "Kassel Nord"], programId: "p1", endDate: "2026-11-27", endText: "27.11.2026",
  acknowledged: false, freeMonth: false, factsLine: "vor 2 Tagen angefragt · Abrechnung am 28. · keine weitere Rechnung · Export bis 27.12.2026", badge: "gekündigt zum 27.11.2026",
  deadline: "bestätigen bis 26.11.2026", requestedOn: "01.11.2026", anchorDay: 28, choices: [{ endDate: "2026-11-27", label: "27.11.2026 · Wie gekündigt · keine weitere Rechnung", consent: false, facts }],
  withdrawal: "Das Programm von Café Lindenblatt läuft dann ohne Enddatum weiter.", ...over });
const render = (cancellations: unknown[]) => renderToStaticMarkup(createElement(OperatorClient, { rows: [], plates: [], awaiting: [], billing: [], guarantees: [], freeMonths: [], cancellations } as never));

describe("operator „Kündigungen“ (ENG-167 b)", () => {
  it("one row per business with its locations, the badge, the deadline badge on a paid end, the facts line and the next step", () => {
    const html = render([cancellation()]);
    expect(html).toContain("Offene zuerst. Eine Kündigung gilt ab Eingang. Bestätigen heißt: Datum behalten oder mit Zustimmung des Geschäfts nach hinten verschieben.");
    for (const text of ["Café Lindenblatt", "Kassel Mitte, Kassel Nord", "gekündigt zum 27.11.2026", "bestätigen bis 26.11.2026", "vor 2 Tagen angefragt · Abrechnung am 28. · keine weitere Rechnung · Export bis 27.12.2026", "Datum bestätigen"]) expect(html).toContain(text);
    expect(html).not.toContain("Ohne Bestätigung endet nichts");
  });

  it("an acknowledged end reads „bestätigt bis“ with „Datum ändern“; a free-month end has no deadline badge", () => {
    const html = render([cancellation({ acknowledged: true, badge: "bestätigt bis 27.11.2026", deadline: null }), cancellation({ tenantId: "t2", tenant: "Barbier Nord", freeMonth: true, deadline: null, factsLine: "heute angefragt · kostenloser Monat · keine Rechnung · Stripe-Abo beendet · Export bis 26.12.2026" })]);
    expect(html).toContain("bestätigt bis 27.11.2026");
    expect(html).toContain("Datum ändern");
    expect(html).toContain("Stripe-Abo beendet");
    expect(html).not.toContain("bestätigen bis");
  });

  it("shows no Kündigungen card without a cancellation, and no free-month two-step in Tarife any more (P4)", () => {
    const html = render([]);
    expect(html).not.toContain("Kündigungen");
    expect(html).not.toContain("Gekündigt im kostenlosen Monat");
  });
});
