"use client";

import Link from "next/link";
import { ErrorNotice, LoadingBlock, MoreInfo, Notice } from "./owner-ui";
import { useLoad } from "./use-load";
import type { BookingFigures, MerchantSpend, SpendFigures } from "@/lib/merchant-analytics";
import { BOOKING_COPY as B, formatMinor, SPEND_COPY as C } from "@/lib/spend-copy";

const AVERAGE_HREF = "/merchant/program";

/**
 * ENG-070: "Spent by your Loynara customers", last 30 local days and since start. Owner-only, like the API. One number per
 * period and how sure it is; the method sits behind „So zählen wir den Umsatz“ (L3). While no booking has an amount the card
 * leads with entering the average, never with a count under a revenue title (top-10 item 7).
 */
export function SpendCard({ multiLocation, booking }: { multiLocation: boolean; booking?: BookingFigures | null }) {
  const [spend, reload] = useLoad<MerchantSpend>("/api/merchant/spend");
  const s = spend.state === "ok" ? spend.data : null;
  const money = (minor: number) => formatMinor(minor, s?.currency ?? "EUR");
  return (
    <section className="ow-card ow-stack" aria-labelledby="an-spend">
      <div className="ow-card-head" style={{ marginBottom: 0 }}><div><h2 id="an-spend">{C.title}</h2><p>{C.lead}</p></div></div>
      {spend.state === "error" && <ErrorNotice message={spend.message} onRetry={reload} />}
      {spend.state === "loading" && <LoadingBlock rows={1} height={64} />}
      {s && (s.overall.total.visits === 0 ? <p className="ow-muted">{C.empty}</p>
        : s.overall.total.averagePerVisitMinor === null ? <>
          <p>{C.noAverage}</p>
          <div><Link className="ow-btn ow-btn--primary ow-btn--sm" href={AVERAGE_HREF}>{C.missingAverageLink}</Link></div>
        </> : <>
          {/* auto: one column on a phone, so a five-digit total never overflows its tile */}
          <div className="ow-metrics ow-metrics--auto">
            <Figure label={C.recent} figures={s.overall.recent} money={money} />
            <Figure label={C.total} figures={s.overall.total} money={money} />
          </div>
          {s.overall.recent.newCardMinor !== null && s.overall.recent.spentMinor > 0 && <p className="ow-hint">{C.recent}: {C.newAndReturning(money(s.overall.recent.newCardMinor), money(s.overall.recent.returningCardMinor ?? 0))}</p>}
          {multiLocation && <><h3 style={{ fontSize: "var(--text-16)" }}>{C.perLocation}</h3><ul className="ow-feed">
            {s.locations.map(row => <li key={row.locationId}><strong>{row.name}</strong><span className="ow-num">{C.recent}: {value(row.recent, money)} · {C.total}: {value(row.total, money)}</span></li>)}
          </ul></>}
          {s.overall.total.unpricedVisits > 0 && <><Notice>{C.missingAverage}</Notice><div><Link className="ow-btn ow-btn--secondary ow-btn--sm" href={AVERAGE_HREF}>{C.missingAverageLink}</Link></div></>}
        </>)}
      <details className="ow-muted"><summary>{C.howWeCountTitle}</summary><p style={{ marginTop: 6, maxWidth: "80ch" }}>{C.howWeCount}</p></details>
      {booking && <BookingLines booking={booking} money={money} multiLocation={multiLocation} />}
    </section>
  );
}

/** Money when any booking of the period is priced, else „ohne Betrag“ (no average entered yet). */
function amount(f: SpendFigures, money: (minor: number) => string) {
  return f.averagePerVisitMinor === null ? C.unpriced : money(f.spentMinor);
}
const estimateMark = (f: SpendFigures) => f.estimatedMinor === 0 ? "" : f.realMinor === 0 ? C.estimated : C.partlyEstimated;
const value = (f: SpendFigures, money: (minor: number) => string) => `${amount(f, money)}${estimateMark(f) ? ` (${estimateMark(f)})` : ""}`;

function Figure({ label, figures, money }: { label: string; figures: SpendFigures; money: (minor: number) => string }) {
  return <div className="ow-metric"><h3 style={{ fontSize: "var(--text-14)", color: "var(--color-ink-muted)" }}>{label}</h3><strong className="ow-metric-value">{amount(figures, money)}</strong>{estimateMark(figures) && <p className="ow-metric-note"><strong>{estimateMark(figures)}</strong></p>}
    <p className="ow-metric-note">{figures.averagePerVisitMinor === null ? C.bookings(figures.visits) : figures.unpricedVisits > 0 ? C.pricedBookings(figures.visits - figures.unpricedVisits, money(figures.averagePerVisitMinor)) : `${C.bookings(figures.visits)} · ${C.average(money(figures.averagePerVisitMinor))}`}</p></div>;
}

/** Loynara Termin: hidden while booking is off at the selected location (booking null). */
function BookingLines({ booking: b, money, multiLocation }: { booking: BookingFigures; money: (minor: number) => string; multiLocation: boolean }) {
  return <div className="ow-stack">
    <h3 style={{ fontSize: "var(--text-16)" }}>{multiLocation ? `${B.title} · ${b.locationName}` : B.title}</h3>
    <ul className="ow-feed">
      <li>{B.today(b.appointmentsToday, b.upcoming7)}</li>
      {b.done30 === 0 ? <li className="ow-muted">{B.empty}</li> : <>
        <li>{B.noShow(b.noShow30, b.total30)}</li>
        <li>{B.listPrice(money(b.listPriceMinor30))}</li>
        {b.confirmedMinor30 > 0 && <li>{B.confirmed(money(b.confirmedMinor30))}</li>}
      </>}
      {b.rebooked30 > 0 && <li>{B.rebooked(b.rebooked30)}</li>}
    </ul>
    <MoreInfo summary="So zählen wir die Termine"><p>{B.howWeCount}</p></MoreInfo>
  </div>;
}
