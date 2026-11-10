"use client";

import { DEMO_DATA_NOTE } from "@/lib/demo-texts";
import Link from "next/link";
import { ArrowRight, CircleHelp, Flag, RefreshCw, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { NumberRoll } from "@/components/ui/number-roll";
import { Sheet } from "@/components/ui/sheet";
import type { BroughtCustomers } from "@/lib/merchant-analytics";
import { bookingsText, dayLabel, weekdayShort, type DayCount, type DiaryDay } from "@/lib/overview-day";
import { BROUGHT_COPY, formatMinor } from "@/lib/spend-copy";
import { LinkPending, nf } from "./owner-ui";

/* ENG-085, direction D: the Übersicht's parts. overview.tsx decides what goes in them; these only draw. */

const NBSP = "\u00a0";
/** A formatted figure as the number its digits spell, for the ticker: it rolls when they change, never on arrival. */
const digits = (text: string) => Number(text.replace(/\D/g, ""));

/**
 * The overview card (Wegweiser A): white, since green marks only the one thing to do. No kicker (SF-5): the number leads
 * and its sub-line says what it counts and over which days; `label` names the card for screen readers.
 */
export function Board({ label, busy = false, demo = false, children }: { label: string; busy?: boolean; /** Demo environment: its numbers include the sample visits. */ demo?: boolean; children: ReactNode }) {
  return <section className="ow-board" aria-label={label} aria-busy={busy}>{demo ? <p style={{ marginBottom: "var(--space-3)" }}><DemoDataChip /></p> : null}{children}</section>;
}

/** The demo environment's sample visits count in these numbers (lib/demo-environment visitSources); Legal's line (9 Nov). */
export const DemoDataChip = () => <span className="ow-chip ow-chip--info">{DEMO_DATA_NOTE}</span>;

/** „128,10 €“ with the cents set smaller, from the shared money formatter's output. */
export function BigMoney({ text }: { text: string }) {
  const split = text.match(/^(.*?)(,\d{2}.*)$/);
  return <p className="ow-board-big"><NumberRoll value={digits(text)}>{split ? <>{split[1]}<small>{split[2]}</small></> : text}</NumberRoll></p>;
}

/** Calm placeholders while the board's numbers load (the pulse runs only without reduced motion). */
export function BoardPlaceholder() {
  return <div className="ow-board-ph" aria-hidden="true"><span className="ow-ph" style={{ height: 64, width: "60%" }} /><span className="ow-ph" style={{ height: 14, width: "70%" }} /><span className="ow-ph" style={{ height: 112 }} /></div>;
}

/**
 * The last six complete local days and today. Yesterday lights up if it had bookings; today's bar is an outline, since
 * its count is not final. `days` end yesterday and stay the headline's only source. Without `today` (numbers this device
 * kept before today's count was stored) the strip is the seven complete days.
 */
export function Strip({ days, caption, today }: { days: DayCount[]; caption: string; today?: DayCount }) {
  const week = today ? [...days.slice(-6), today] : days.slice(-7);
  const max = Math.max(1, ...week.map(day => day.bookings));
  const label = (day: DayCount) => day === today ? "heute" : day === days.at(-1) ? "gestern" : weekdayShort(day.date);
  return (
    <>
      <div className="ow-strip" role="img" aria-label={`${caption}: ${week.map(day => `${label(day)} ${bookingsText(day.bookings)}`).join(", ")}`}>
        {week.map(day => {
          const yesterday = day === days.at(-1);
          return (
            <div className="ow-strip-day" key={day.date} aria-hidden="true">
              <span className="ow-strip-n">{day.bookings > 0 ? nf.format(day.bookings) : ""}</span>
              <span className="ow-strip-bar" data-lit={yesterday && day.bookings > 0 ? "" : undefined} data-today={day === today ? "" : undefined} style={{ height: `${Math.max(6, Math.round(day.bookings / max * 72))}px` }} />
              {/* „gestern“ and „heute“ do not fit side by side on a phone: beside today, yesterday shows its weekday. */}
              <span className="ow-strip-d" data-yesterday={yesterday ? "" : undefined}>{today && yesterday ? weekdayShort(day.date) : label(day)}</span>
            </div>
          );
        })}
      </div>
      <p className="ow-strip-cap">{caption}</p>
    </>
  );
}

/** The empty shop's preview: seven dashed bars for the days still to come. */
export function EmptyStrip({ today, caption }: { today: string; caption: string }) {
  const base = new Date(`${today}T12:00:00Z`).getTime();
  const dates = Array.from({ length: 7 }, (_, index) => new Date(base - (7 - index) * 86_400_000).toISOString().slice(0, 10));
  return (
    <>
      <div className="ow-strip" aria-hidden="true">
        {dates.map((date, index) => <div className="ow-strip-day" key={date}><span className="ow-strip-n" /><span className="ow-strip-bar" data-empty="" style={{ height: 36 }} /><span className="ow-strip-d" data-yesterday={index === 6 ? "" : undefined}>{index === 6 ? "gestern" : weekdayShort(date)}</span></div>)}
      </div>
      <p className="ow-strip-cap">{caption}</p>
    </>
  );
}

/** The Leitung's card stock: one segment per card up to 60 cards, then three proportional segments. */
export function CardStock({ recent, drifting, never }: { recent: number; drifting: number; never: number }) {
  const total = recent + drifting + never;
  const parts = [{ kind: "recent", n: recent }, { kind: "drifting", n: drifting }, { kind: "never", n: never }];
  const summary = `${nf.format(recent)} da · ${nf.format(drifting)} länger nicht da · ${nf.format(never)} noch nie an der Kasse`;
  return (
    <>
      <div className="ow-stock" role="img" aria-label={`Karten an deinem Standort: ${summary}`}>
        {total <= 60
          ? parts.flatMap(part => Array.from({ length: part.n }, (_, index) => <span key={`${part.kind}-${index}`} data-kind={part.kind} />))
          : parts.filter(part => part.n > 0).map(part => <span key={part.kind} data-kind={part.kind} style={{ flexGrow: part.n }} />)}
      </div>
      <p className="ow-board-legend" aria-hidden="true"><span>{nf.format(recent)} da</span><span>{nf.format(drifting)} länger nicht da</span><span>{nf.format(never)} noch nie an der Kasse</span></p>
    </>
  );
}

/** No `help`: not in the sheet. */
export type Tile = { key: string; icon: LucideIcon; label: string; value: string; note?: ReactNode; help: string; href?: string };
/**
 * Rows under a section head whose „?“ opens their help (Wegweiser A): value at the right edge, the note as sub-line, an
 * arrow only where the row links. The Übersicht's 30 days and Kunden's groups (ENG-122a).
 */
export function Tiles({ title, tiles }: { title: string; tiles: Tile[] }) {
  const [help, setHelp] = useState(false);
  const titleId = useId();
  const close = () => setHelp(false);
  return (
    <section className="ow-stack ow-stack--tight" aria-labelledby={titleId}>
      <div className="ow-rows-head">
        <h2 id={titleId} className="ow-tiles-title">{title}</h2>
        <button type="button" className="ow-tile-q" aria-haspopup="dialog" onClick={() => setHelp(true)}><CircleHelp size={22} aria-hidden="true" /><span className="ow-sr">So zählen wir „{title}“</span></button>
      </div>
      <ul className="ow-rows">{tiles.map(tile => <li key={tile.key}><TileRow tile={tile} /></li>)}</ul>
      <Sheet open={help} onClose={close} title={BROUGHT_COPY.howWeCountTitle} footer={<Button variant="secondary" block onClick={close}>Schließen</Button>}>
        {tiles.filter(tile => tile.help).map(tile => <div className="ow-rows-help" key={tile.key}><h3>{tile.label}</h3><p>{tile.help}</p></div>)}
      </Sheet>
    </section>
  );
}
function TileRow({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  const body = <>
    <span className="ow-prog-icon"><Icon size={22} aria-hidden="true" focusable="false" /></span>
    {/* The value comes first in the DOM, so a screen reader says „9 Buchungen vorher 10“; CSS puts it at the right edge. */}
    <span className="ow-prog-main">
      <span className="ow-prog-value" data-big=""><NumberRoll value={digits(tile.value)}>{tile.value}</NumberRoll></span>
      <span className="ow-prog-text"><strong>{tile.label}</strong>{tile.note && <small>{tile.note}</small>}</span>
    </span>
  </>;
  return tile.href
    ? <Link className="ow-prog-row" href={tile.href}>{body}<ArrowRight className="ow-prog-arrow" size={22} aria-hidden="true" /><LinkPending /></Link>
    : <div className="ow-prog-row">{body}</div>;
}

/**
 * ENG-095 (rules: Product, 27 Oct): customers back with the win-back bonus or new on a referral, last 30 days at this
 * location. Exact counts and, for points shops, the till amounts of exactly those bookings; no share, no estimate, and no
 * coral (nothing here is earned). `all` is the all-card total: euros for till amounts, else bookings.
 */
export function Brought({ brought, all, currency }: { brought: BroughtCustomers; all: string; currency: string }) {
  const [help, setHelp] = useState(false);
  const titleId = useId();
  const { revenue, bookings } = brought;
  const close = () => setHelp(false);
  return (
    <section className="ow-brought" aria-labelledby={titleId}>
      <div className="ow-brought-head">
        <h2 id={titleId} className="ow-tiles-title">{BROUGHT_COPY.title}</h2>
        <button type="button" className="ow-tile-q" aria-haspopup="dialog" onClick={() => setHelp(true)}><CircleHelp size={22} aria-hidden="true" /><span className="ow-sr">So zählen wir „Wieder da oder neu auf Empfehlung“</span></button>
      </div>
      <p className="ow-brought-n">{BROUGHT_COPY.customers(brought.customers)}</p>
      <dl className="ow-brought-lines">
        <div><dt>{BROUGHT_COPY.winback}</dt><dd>{nf.format(brought.winback)}</dd></div>
        <div><dt>{BROUGHT_COPY.referral}</dt><dd>{nf.format(brought.referral)}</dd></div>
        {revenue && bookings > 0 && <div><dt>{BROUGHT_COPY.revenue}</dt><dd>{revenue.pricedBookings > 0 ? formatMinor(revenue.amountMinor, currency) : "–"}</dd><dd>{BROUGHT_COPY.priced(revenue.pricedBookings, bookings)}</dd></div>}
      </dl>
      <p className="ow-brought-all">{BROUGHT_COPY.all} <span>{all}</span>. {BROUGHT_COPY.allNote}</p>
      <Sheet open={help} onClose={close} title={BROUGHT_COPY.howWeCountTitle} footer={<Button variant="secondary" block onClick={close}>Schließen</Button>}>
        <p>{BROUGHT_COPY.howWeCount}</p>
      </Sheet>
    </section>
  );
}

/** ENG-095 §5: until the location has a brought customer, the block's place names the next step while the bonus is off, never a 0. */
export function BonusOffBand({ href }: { href: string }) {
  return (
    <Link className="ow-brought-off" href={href}>
      <span><RefreshCw size={22} aria-hidden="true" focusable="false" /></span>
      <span><b>{BROUGHT_COPY.bonusOff}</b><small>{BROUGHT_COPY.bonusOffText}</small></span>
      <ArrowRight size={22} aria-hidden="true" focusable="false" />
      <LinkPending />
    </Link>
  );
}

/** A milestone, shown once: a quiet white card above the board, no confetti, no sound (spec §4.3). */
export function Milestone({ cards, action }: { cards: number; action: () => void }) {
  return (
    <section className="ow-card ow-row" style={{ justifyContent: "space-between", alignItems: "center" }} aria-label="Meilenstein">
      <h2>Deine {nf.format(cards)}. Karte.</h2>
      <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={action}>Tresenschild laden</button>
    </section>
  );
}

export type NextAction = { label: string; href: string; external?: boolean } | { label: string; onClick: () => void };
/** „Als Nächstes“ as the green band in the page's flow: the whole band is the action; without one it is only text. */
/** `children` render under the band, inside its section (the Tresenschild's error line, beside what was tapped). */
export function NextBand({ title, text, action, children }: { title: string; text?: string; action?: NextAction; children?: ReactNode }) {
  const body = <>
    <span className="ow-band-icon"><Flag size={22} aria-hidden="true" focusable="false" /></span>
    <span className="ow-band-text">
      <b>{title}</b>{text && <small>{text}</small>}
      {action && <span className="ow-band-go">{action.label}<ArrowRight size={20} aria-hidden="true" focusable="false" /></span>}
    </span>
  </>;
  return (
    <section className="ow-next" aria-label="Als Nächstes">
      {!action ? <div className="ow-band">{body}</div>
        : "href" in action ? <Link className="ow-band" href={action.href} {...action.external && { target: "_blank", rel: "noopener noreferrer" }}>{body}<LinkPending /></Link>
          : <button type="button" className="ow-band" onClick={action.onClick}>{body}</button>}
      {children}
    </section>
  );
}

const pillOf = (entry: DiaryDay["entries"][number], unit: string) => entry.kind === "award" ? { mark: `+${nf.format(entry.amount)}`, text: "Buchung bestätigt", label: `${nf.format(entry.amount)} ${unit} gebucht` }
  : entry.kind === "correction" && entry.amount < 0 ? { mark: "", text: `Korrektur −${nf.format(-entry.amount)}`, label: `Korrektur, ${nf.format(-entry.amount)} ${unit} zurückgenommen` }
    // A positive correction is an undone redemption: the units go back on the card (Reviewer N-1; Marketing, 26 Oct).
    : entry.kind === "correction" ? { mark: "", text: "Einlösung rückgängig", label: `Einlösung rückgängig gemacht, ${nf.format(entry.amount)} ${entry.amount === 1 && unit === "Punkte" ? "Punkt" : unit} wieder auf der Karte` }
    : { mark: "", text: "Prämie eingelöst", label: "Prämie eingelöst" };

/** „Die letzten Tage am Tresen“: one entry per local day, newest first, no timestamps; a quiet stretch shows as one grey gap. */
export function Diary({ diary, today, unit, gap, children }: { diary: DiaryDay[]; today: string; unit: string; gap?: { from: string; to: string } | null; children?: ReactNode }) {
  const yesterday = today ? new Date(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) : "";
  const title = (date: string) => date === today ? "Heute" : date === yesterday ? "Gestern" : dayLabel(date);
  return (
    <section className="ow-diary" aria-labelledby="ow-diary-title">
      <h2 id="ow-diary-title">Die letzten Tage am Tresen</h2>
      {children}
      {gap && <div className="ow-day" data-gap=""><div className="ow-day-rail" aria-hidden="true"><i /><span /></div><div><h3>{gap.from === gap.to ? dayLabel(gap.from) : `${gap.from.slice(8, 10)}.${gap.from.slice(5, 7) === gap.to.slice(5, 7) ? "" : `${gap.from.slice(5, 7)}.`}–${gap.to.slice(8, 10)}.${gap.to.slice(5, 7)}.`}</h3><p className="ow-day-sum">keine Buchung</p></div></div>}
      {diary.map(day => (
        <div className="ow-day" key={day.date}>
          <div className="ow-day-rail" aria-hidden="true"><i /><span /></div>
          <div>
            <h3>{title(day.date)}</h3>
            {day.bookings > 0 && <p className="ow-day-sum">{bookingsText(day.bookings)}{day.units > 0 && ` · ${nf.format(day.units)}${NBSP}${day.units === 1 && unit === "Punkte" ? "Punkt" : unit} vergeben`}</p>}
            <ul className="ow-pills">
              {day.entries.map((entry, index) => { const pill = pillOf(entry, unit); return <li className="ow-pill" data-kind={entry.kind} key={index} aria-label={pill.label}>{(pill.mark || entry.kind === "redemption") && <b aria-hidden="true">{pill.mark}</b>}<span aria-hidden="true">{pill.text}</span></li>; })}
              {day.more > 0 && <li className="ow-pill" data-kind="more">{nf.format(day.more)}{NBSP}weitere</li>}
            </ul>
          </div>
        </div>
      ))}
    </section>
  );
}
