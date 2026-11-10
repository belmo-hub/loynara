"use client";

import { CalendarCheck, CalendarDays, CalendarX, Euro, MapPin, ReceiptText, Repeat } from "lucide-react";
import { ErrorNotice, LoadingBlock } from "./owner-ui";
import { useLoad } from "./use-load";
import { Rows, RowSection, type ValueRow } from "./value-rows";
import type { BookingFigures, MerchantSpend, SpendFigures } from "@/lib/merchant-analytics";
import { BOOKING_COPY as B, formatMinor, SPEND_COPY as C } from "@/lib/spend-copy";

/** The average-spend question; a programme that cannot have one sends the owner on to the Programm list. */
const AVERAGE_HREF = "/merchant/program/average-spend";

/**
 * ENG-070: "Spent by your Loynara customers", last 30 local days and since start. Owner-only, like the API. One number per
 * period and how sure it is; the method sits behind the head's „?“ (L3). While no booking has an amount the section leads
 * with entering the average, never with a count under a revenue title (top-10 item 7).
 */
export function SpendCard({ multiLocation, booking }: { multiLocation: boolean; booking?: BookingFigures | null }) {
  const [spend, reload] = useLoad<MerchantSpend>("/api/merchant/spend");
  const s = spend.state === "ok" ? spend.data : null;
  const money = (minor: number) => formatMinor(minor, s?.currency ?? "EUR");
  const enter: ValueRow = { key: "average", icon: ReceiptText, title: C.missingAverageLink, href: AVERAGE_HREF };
  return (
    <>
    <RowSection title={C.title} helpTitle={C.howWeCountTitle} help={[{ text: C.howWeCount }]}>
      {spend.state === "error" && <ErrorNotice message={spend.message} onRetry={reload} />}
      {spend.state === "loading" && <LoadingBlock rows={1} height={64} />}
      {s && (s.overall.total.visits === 0 ? <p className="ow-rows-note">{C.empty}</p>
        : s.overall.total.averagePerVisitMinor === null ? <>
          <p className="ow-rows-note">{C.noAverage}</p>
          <Rows rows={[enter]} />
        </> : <>
          <Rows rows={[
            figure("recent", C.recent, s.overall.recent, money),
            figure("total", C.total, s.overall.total, money),
            ...(multiLocation ? s.locations.map(row => ({ key: row.locationId, icon: MapPin, title: row.name, sub: `${C.recent}: ${value(row.recent, money)} · ${C.total}: ${value(row.total, money)}` })) : []),
          ]} />
          {s.overall.recent.newCardMinor !== null && s.overall.recent.spentMinor > 0 && <p className="ow-rows-note">{C.recent}: {C.newAndReturning(money(s.overall.recent.newCardMinor), money(s.overall.recent.returningCardMinor ?? 0))}</p>}
          {s.overall.total.unpricedVisits > 0 && <><p className="ow-rows-note">{C.missingAverage}</p><Rows rows={[enter]} /></>}
        </>)}
    </RowSection>
    {booking && <BookingSection booking={booking} money={money} multiLocation={multiLocation} />}
    </>
  );
}

/** Loynara Termin: hidden while booking is off at the selected location (booking null). Estimated list prices are named apart from cashier amounts. */
function BookingSection({ booking: b, money, multiLocation }: { booking: BookingFigures; money: (minor: number) => string; multiLocation: boolean }) {
  const rows: ValueRow[] = [{ key: "today", icon: CalendarDays, title: B.today(b.appointmentsToday, b.upcoming7) }];
  if (b.done30 === 0) rows.push({ key: "empty", icon: CalendarCheck, title: B.empty });
  else {
    rows.push({ key: "noshow", icon: CalendarX, title: B.noShow(b.noShow30, b.total30) }, { key: "list", icon: Euro, title: B.listPrice(money(b.listPriceMinor30)) });
    if (b.confirmedMinor30 > 0) rows.push({ key: "confirmed", icon: Euro, title: B.confirmed(money(b.confirmedMinor30)) });
  }
  if (b.rebooked30 > 0) rows.push({ key: "rebooked", icon: Repeat, title: B.rebooked(b.rebooked30) });
  return <RowSection title={multiLocation ? `${B.title} · ${b.locationName}` : B.title} helpTitle="So zählen wir die Termine" help={[{ text: B.howWeCount }]}><Rows rows={rows} /></RowSection>;
}

/** Money when any booking of the period is priced, else „ohne Betrag“ (no average entered yet); no booking at all is 0. */
function amount(f: SpendFigures, money: (minor: number) => string) {
  return f.averagePerVisitMinor === null && f.visits > 0 ? C.unpriced : money(f.spentMinor);
}
const estimateMark = (f: SpendFigures) => f.estimatedMinor === 0 ? "" : f.realMinor === 0 ? C.estimated : C.partlyEstimated;
const value = (f: SpendFigures, money: (minor: number) => string) => `${amount(f, money)}${estimateMark(f) ? ` (${estimateMark(f)})` : ""}`;

/** A period's euros at the right edge; how sure they are and what they come from as the sub-line. */
function figure(key: string, title: string, f: SpendFigures, money: (minor: number) => string): ValueRow {
  const basis = f.averagePerVisitMinor === null ? C.bookings(f.visits) : f.unpricedVisits > 0 ? C.pricedBookings(f.visits - f.unpricedVisits, money(f.averagePerVisitMinor)) : `${C.bookings(f.visits)} · ${C.average(money(f.averagePerVisitMinor))}`;
  return { key, icon: Euro, title, value: amount(f, money), off: f.averagePerVisitMinor === null, sub: estimateMark(f) ? `${estimateMark(f)} · ${basis}` : basis };
}
