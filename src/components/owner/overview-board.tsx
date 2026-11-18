"use client";

import { DEMO_DATA_NOTE } from "@/lib/demo-texts";
import Link from "next/link";
import { ArrowRight, Award, CalendarDays, ChevronRight, CircleHelp, CirclePlus, Flag, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { NumberRoll } from "@/components/ui/number-roll";
import { cx } from "@/components/ui/cx";
import { mixButton, mixStyles as mix, MixTile } from "@/components/ui/mix";
import { Sheet } from "@/components/ui/sheet";
import type { BroughtCustomers } from "@/lib/merchant-analytics";
import { bookingsText, dayLabel, weekdayShort, type DayCount, type DiaryDay } from "@/lib/overview-day";
import { BROUGHT_COPY, formatMinor } from "@/lib/spend-copy";
import { LinkPending, nf } from "./owner-ui";
import s from "./overview.module.css";

/* ENG-085, direction D, drawn in the founder's mix since ENG-260: the Übersicht's parts. overview.tsx decides what goes in them; these only draw. */

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

/** Still placeholders while the board's numbers load. */
export function BoardPlaceholder() {
  return <div className="ow-board-ph" aria-hidden="true"><span className="ow-ph" style={{ height: 64, width: "60%" }} /><span className="ow-ph" style={{ height: 14, width: "70%" }} /><span className="ow-ph" style={{ height: 112 }} /></div>;
}

/**
 * C's week chart (ENG-260): the last six complete local days and today. Yesterday's bar is dark if it had bookings, and
 * then a key after the caption names it, „gestern“; today's bar is an outline while it has a count that is not final. `days` end yesterday and stay the headline's only source. Without `today` (numbers this device kept
 * before today's count was stored) the chart is the seven complete days. With `week` (ENG-210, the weekly line above it):
 * this week's complete days with bookings are dark, the other days muted, a hairline stands before Monday, and there is no
 * „gestern“ key, since the dark bars are the week's. The spoken label leads with the week's sentence.
 */
export function Strip({ days, caption, today, week: thisWeek }: { days: DayCount[]; caption: string; today?: DayCount; week?: { from: string; line: string } }) {
  const week = today ? [...days.slice(-6), today] : days.slice(-7);
  const yesterday = days.at(-1);
  const max = Math.max(1, ...week.map(day => day.bookings));
  const label = (day: DayCount) => day === today ? "heute" : day === yesterday ? "gestern" : weekdayShort(day.date);
  const lit = (day: DayCount) => day.bookings > 0 && (thisWeek ? day.date >= thisWeek.from && day !== today : day === yesterday);
  return (
    <div className={s.week}>
      <p className={s.legend}><span><i aria-hidden="true" />{caption}</span>{!thisWeek && yesterday && lit(yesterday) && <span><i data-lit="" aria-hidden="true" />gestern</span>}</p>
      <div>
        <div className={s.chart} data-week={thisWeek ? "" : undefined} role="img" aria-label={`${thisWeek ? `${thisWeek.line} ` : ""}${caption}: ${week.map(day => `${label(day)} ${bookingsText(day.bookings)}`).join(", ")}`}>
          {week.map((day, index) => {
            // ISO dates compare as text. The hairline stands before Monday unless Monday is the chart's first column.
            const inWeek = thisWeek !== undefined && day.date >= thisWeek.from;
            return (
              <div className={s.day} key={day.date} aria-hidden="true" data-in-week={inWeek ? "" : undefined} data-week-start={inWeek && index > 0 && week[index - 1].date < thisWeek.from ? "" : undefined}>
                {day.bookings > 0 && <b>{nf.format(day.bookings)}</b>}
                <i className={s.bar} data-lit={lit(day) ? "" : undefined} data-today={day === today ? "" : undefined} data-zero={day.bookings === 0 ? "" : undefined} style={day.bookings > 0 ? { height: `${Math.round(day.bookings / max * 144)}px` } : undefined} />
              </div>
            );
          })}
        </div>
        {/* „gestern“ and „heute“ do not fit side by side on a phone: beside today, yesterday shows its weekday. */}
        {/* Beside „heute“ nothing is bold: a bold weekday next to it reads as today (Design, 10 Nov). */}
        <div className={s.days} aria-hidden="true">{week.map(day => <span key={day.date} data-yesterday={day === yesterday && !today ? "" : undefined}>{today && day === yesterday ? weekdayShort(day.date) : label(day)}</span>)}</div>
      </div>
    </div>
  );
}

/** The empty shop's preview: seven dashed bars for the days still to come, no scale and no key, then its sentence. */
export function EmptyStrip({ today, caption }: { today: string; caption: string }) {
  const base = new Date(`${today}T12:00:00Z`).getTime();
  const dates = Array.from({ length: 7 }, (_, index) => new Date(base - (7 - index) * 86_400_000).toISOString().slice(0, 10));
  return <>
    <div className={s.week} aria-hidden="true"><div>
      <div className={s.chart} data-empty="">{dates.map(date => <div className={s.day} key={date}><i className={s.bar} data-empty="" /></div>)}</div>
      <div className={s.days}>{dates.map((date, index) => <span key={date} data-yesterday={index === 6 ? "" : undefined}>{index === 6 ? "gestern" : weekdayShort(date)}</span>)}</div>
    </div></div>
    <p className={s.foot}>{caption}</p>
  </>;
}

/** The board's placeholders while its reads load: still, flat, in the loaded board's shapes (DESIGN: the owner board's placeholder stands still). */
export function BookPlaceholder({ caption }: { caption: string }) {
  const week = Array.from({ length: 7 }, (_, index) => ({ date: `2026-01-0${index + 1}`, bookings: index === 6 ? 1 : 0 }));
  return <>
    <span className={s.sk} data-small="" style={{ width: 120 }} />
    <div className={s.skFig}><span className={s.sk} data-fig="" /><span className={s.sk} data-small="" style={{ width: 248 }} /></div>
    {/* The week keeps its own box (legend, chart and days, hidden), so nothing moves when the numbers come. */}
    <div className={s.ghost}><Strip days={week} caption={caption} /></div>
    <div className={s.foot} data-sk=""><span className={s.sk} data-line="" style={{ width: 240 }} /></div>
  </>;
}

/** The figure rows' placeholders, each as wide as its loaded title and sub line. */
export function FactsPlaceholder() {
  return <div className={cx(mix.panel, s.facts)} aria-hidden="true">
    {[[96, 136], [140, 220], [140, 80]].map(([title, sub]) => <div className={mix.row} data-sk="" key={title + sub}><div className={mix.body}>
      <span className={mix.text}><span className={s.sk} data-line="" style={{ width: title }} /><span className={s.sk} data-small="" style={{ width: sub }} /></span><span className={s.sk} data-num="" />
    </div></div>)}
  </div>;
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
export function Tiles({ title, note, tiles }: { title: string; /** Said once after the title, for all rows („zweite Woche“). */ note?: string; tiles: Tile[] }) {
  const [help, setHelp] = useState(false);
  const titleId = useId();
  const close = () => setHelp(false);
  return (
    <section className="ow-rows-section" aria-labelledby={titleId}>
      <div className="ow-rows-head">
        <h2 id={titleId} className="ow-tiles-title">{title}{note && ` · ${note}`}</h2>
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

/** ENG-095 §5 as C's „Vorschlag“: until the location has a brought customer, the place names the next step while the bonus is off, never a 0. */
export function BonusOffBand({ href }: { href: string }) {
  return (
    <Link className={cx(mix.panel, mix.pad, s.sug)} href={href}>
      <span className={s.kicker}><CirclePlus size={16} aria-hidden="true" focusable="false" />Vorschlag<ChevronRight size={16} aria-hidden="true" focusable="false" /></span>
      <span><b>{BROUGHT_COPY.bonusOff}</b><small>{BROUGHT_COPY.bonusOffText}</small></span>
      <LinkPending />
    </Link>
  );
}

/**
 * C's figure rows for the 30 days (ENG-260): label and note left, the figure on the inset; a linked row is the link.
 * `note` („erste Woche“) heads the rows: in the section title it came with the reads and pushed the board down.
 */
export function Facts({ tiles, note }: { tiles: Tile[]; note?: string }) {
  return (
    <div className={cx(mix.panel, s.facts)}>
      {note && <div className={mix.ph}><p className={s.kicker}>{note}</p></div>}
      {tiles.map(tile => {
        // The value comes first in the DOM, so a screen reader says „9 Buchungen vorher 10“; CSS puts it at the inset.
        const body = <div className={mix.body}>
          <span className={s.num} data-none={tile.value === "–" || undefined}><NumberRoll value={digits(tile.value)}>{tile.value}</NumberRoll></span>
          <span className={mix.text}><b>{tile.label}</b>{tile.note && <small>{tile.note}</small>}</span>
          {tile.href && <ChevronRight className={mix.chev} size={20} aria-hidden="true" />}
        </div>;
        return tile.href ? <Link key={tile.key} className={mix.row} href={tile.href} data-fact="">{body}<LinkPending /></Link> : <div key={tile.key} className={mix.row} data-fact="">{body}</div>;
      })}
    </div>
  );
}

/** The 30 days' „?“ on the section head: one sheet with the help of every figure on screen. */
export function FactsHelp({ title, tiles }: { title: string; tiles: Tile[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <>
    <button type="button" className={s.help} aria-haspopup="dialog" onClick={() => setOpen(true)}><CircleHelp size={22} aria-hidden="true" /><span className="ow-sr">So zählen wir „{title}“</span></button>
    <Sheet open={open} onClose={close} title={BROUGHT_COPY.howWeCountTitle} footer={<Button variant="secondary" block onClick={close}>Schließen</Button>}>
      {tiles.filter(tile => tile.help).map(tile => <div className="ow-rows-help" key={tile.key}><h3>{tile.label}</h3><p>{tile.help}</p></div>)}
    </Sheet>
  </>;
}

export type NextAction = { label: string; href: string; external?: boolean } | { label: string; onClick: () => void };
/**
 * The „Als Nächstes“ panel's slot while the reads it is chosen from load (ENG-203): a flat block of the panel's size, so
 * the board stands where it will stay. The panel takes its place; without one it closes in place (owner.css, .ow-next-ph).
 */
// shortcut: sized for the panel with one next-step row; the milestone's second row still moves the board by 64, size the slot from the reads once they can say which rows come
export function NextBandPlaceholder({ closing }: { closing: boolean }) {
  return <div className="ow-next ow-next-ph" data-closing={closing || undefined} aria-hidden="true"><span><span className={cx("ow-ph", s.nextPh)} /></span></div>;
}

/**
 * F's „Als Nächstes“ (ENG-260): the next step and the milestone as the rows of one panel. A ready reward leads with the
 * card's thumbnail; the action stands under the sentence on a phone and at the row's end from 600.
 */
export function NextPanel({ next, lead, milestone, onSign }: { next: { title: string; text?: string; action?: NextAction } | null; /** The row's lead: the card thumbnail (`card`) or an icon tile. */ lead?: { kind: "card" | "tile"; node: ReactNode }; milestone: number | null; onSign: () => void }) {
  const action = next?.action;
  const go = action && <>{action.label}<ArrowRight size={20} aria-hidden="true" focusable="false" /></>;
  return (
    <section className={cx(mix.panel, s.next)} data-ow="next" data-thumbs={lead?.kind === "card" ? "" : undefined} aria-label="Als Nächstes">
      <div className={mix.ph}><h2 className={mix.h}><Flag size={20} aria-hidden="true" focusable="false" />Als Nächstes</h2></div>
      {next && <div className={mix.row} data-hang="" data-lead={lead?.kind}>
        {lead?.node}
        <div className={mix.body}><span className={s.line}>
          <span><b>{next.title}</b>{next.text && <small>{next.text}</small>}</span>
          {!action ? null : "href" in action ? <Link className={mixButton()} href={action.href} {...action.external && { target: "_blank", rel: "noopener noreferrer" }}>{go}<LinkPending /></Link>
            : <button type="button" className={mixButton()} onClick={action.onClick}>{go}</button>}
        </span></div>
      </div>}
      {milestone !== null && <div className={mix.row} data-lead="tile">
        <MixTile tone="mute"><Award size={20} aria-hidden="true" focusable="false" /></MixTile>
        <div className={mix.body}><span className={s.line}><span><b>Deine {nf.format(milestone)}. Karte</b></span><button type="button" className={mix.link} data-link="" onClick={onSign}>Tresenschild laden</button></span></div>
      </div>}
    </section>
  );
}

const pillOf = (entry: DiaryDay["entries"][number], unit: string) => entry.kind === "award" ? { mark: `+${nf.format(entry.amount)}`, text: "Buchung bestätigt", label: `${nf.format(entry.amount)} ${unit} gebucht` }
  : entry.kind === "correction" && entry.amount < 0 ? { mark: "", text: `Korrektur −${nf.format(-entry.amount)}`, label: `Korrektur, ${nf.format(-entry.amount)} ${unit} zurückgenommen` }
    // A positive correction is an undone redemption: the units go back on the card (Reviewer N-1; Marketing, 26 Oct).
    : entry.kind === "correction" ? { mark: "", text: "Einlösung rückgängig", label: `Einlösung rückgängig gemacht, ${nf.format(entry.amount)} ${entry.amount === 1 && unit === "Punkte" ? "Punkt" : unit} wieder auf der Karte` }
    : { mark: "", text: "Prämie eingelöst", label: "Prämie eingelöst" };

/** A busy day's first entries; the rest is one „… weitere“ count, so thirty bookings are not a wall of thirty pills. */
const DAY_ENTRIES = 8;
/** What a busy day shows: redemptions and corrections first, then bookings, so the rarer moments never vanish into the count of the rest. */
export const shownEntries = (day: DiaryDay) => [...day.entries.filter(entry => entry.kind !== "award"), ...day.entries.filter(entry => entry.kind === "award")].slice(0, DAY_ENTRIES);

/**
 * „Die letzten Tage am Tresen“ (C, ENG-260): one row per local day, newest first, the day's sum as its sub line, no
 * timestamps; a quiet stretch is one row „keine Buchung“. Redemptions and corrections follow the sum in their live words,
 * since the sum counts bookings only.
 */
export function Diary({ diary, today, unit, gap }: { diary: DiaryDay[]; today: string; unit: string; gap?: { from: string; to: string } | null }) {
  const yesterday = today ? new Date(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) : "";
  const title = (date: string) => date === today ? "Heute" : date === yesterday ? "Gestern" : dayLabel(date);
  const rows = [
    ...gap ? [{ key: "gap", title: gap.from === gap.to ? dayLabel(gap.from) : `${gap.from.slice(8, 10)}.${gap.from.slice(5, 7) === gap.to.slice(5, 7) ? "" : `${gap.from.slice(5, 7)}.`}–${gap.to.slice(8, 10)}.${gap.to.slice(5, 7)}.`, sub: "keine Buchung" }] : [],
    ...diary.map(day => ({ key: day.date, title: title(day.date), sub: [
      day.bookings > 0 ? `${bookingsText(day.bookings)}${day.units > 0 ? ` · ${nf.format(day.units)}${NBSP}${day.units === 1 && unit === "Punkte" ? "Punkt" : unit} vergeben` : ""}` : "",
      ...shownEntries(day).filter(entry => entry.kind !== "award").map(entry => pillOf(entry, unit).text),
    ].filter(Boolean).join(" · ") })),
  ];
  return (
    <section className={cx(mix.panel, s.diary)} data-ow="diary" aria-labelledby="ow-diary-title">
      <div className={mix.ph}><h2 id="ow-diary-title" className={s.kicker}><CalendarDays size={16} aria-hidden="true" focusable="false" />Die letzten Tage am Tresen</h2></div>
      {rows.map(row => <div className={mix.row} data-day="" key={row.key}><div className={mix.body}><span className={mix.text}><b>{row.title}</b>{row.sub && <small>{row.sub}</small>}</span></div></div>)}
    </section>
  );
}

