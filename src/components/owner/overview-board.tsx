"use client";

import Link from "next/link";
import { CircleCheck, CreditCard, Gift, Undo2, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { bookingsText, dayLabel, weekdayShort, type DayCount, type DiaryDay } from "@/lib/overview-day";
import { nf } from "./owner-ui";

/* ENG-085, direction D: the Übersicht's parts. overview.tsx decides what goes in them; these only draw. */

const NBSP = "\u00a0";

/** The one deep green panel: greeting, kicker, then the number area and the strip the caller passes in. */
export function Board({ hello, kicker, busy = false, children }: { hello: string; kicker: string; busy?: boolean; children: ReactNode }) {
  return (
    <section className="ow-board" aria-labelledby="ow-board-kicker" aria-busy={busy}>
      <p className="ow-board-hello">{hello}</p>
      <p className="ow-board-kicker" id="ow-board-kicker">{kicker}</p>
      {children}
    </section>
  );
}

/** „128,10 €“ with the cents set smaller, from the shared money formatter's output. */
export function BigMoney({ text }: { text: string }) {
  const split = text.match(/^(.*?)(,\d{2}.*)$/);
  return <p className="ow-board-big">{split ? <>{split[1]}<small>{split[2]}</small></> : text}</p>;
}

/** Calm placeholders while the board's numbers load (the pulse runs only without reduced motion). */
export function BoardPlaceholder() {
  return <div aria-hidden="true"><span className="ow-ph" style={{ height: 64, width: "60%", margin: "8px 0" }} /><span className="ow-ph" style={{ height: 14, width: "70%" }} /><span className="ow-ph" style={{ height: 112, marginTop: 20 }} /></div>;
}

/** The last 7 local days ending yesterday; only yesterday lights up, and only if it had bookings. */
export function Strip({ days, caption }: { days: DayCount[]; caption: string }) {
  const week = days.slice(-7);
  const max = Math.max(1, ...week.map(day => day.bookings));
  const label = (index: number) => index === week.length - 1 ? "gestern" : weekdayShort(week[index].date);
  return (
    <>
      <div className="ow-strip" role="img" aria-label={`${caption}: ${week.map((day, index) => `${label(index)} ${bookingsText(day.bookings)}`).join(", ")}`}>
        {week.map((day, index) => {
          const yesterday = index === week.length - 1;
          return (
            <div className="ow-strip-day" key={day.date} aria-hidden="true">
              <span className="ow-strip-n">{day.bookings > 0 ? nf.format(day.bookings) : ""}</span>
              <span className="ow-strip-bar" data-lit={yesterday && day.bookings > 0 ? "" : undefined} style={{ height: `${Math.max(6, Math.round(day.bookings / max * 72))}px` }} />
              <span className="ow-strip-d" data-yesterday={yesterday ? "" : undefined}>{label(index)}</span>
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

const TILE_ICONS = { bookings: CircleCheck, cards: CreditCard, back: Undo2, rewards: Gift } satisfies Record<string, LucideIcon>;
export type Tile = { key: keyof typeof TILE_ICONS; label: string; value: string; note: ReactNode; help: string; href?: string };
/** The four tiles, always in this order, numbers in ink: no arrows, no colour coding (spec §1.3). */
export function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <section className="ow-stack" aria-labelledby="ow-tiles-title" style={{ gap: 8 }}>
      <h2 id="ow-tiles-title" className="ow-tiles-title">Letzte 30 Tage an diesem Standort</h2>
      <div className="ow-tiles">{tiles.map(tile => <TileCard key={tile.key} tile={tile} />)}</div>
    </section>
  );
}
function TileCard({ tile }: { tile: Tile }) {
  const [open, setOpen] = useState(false);
  const helpId = useId();
  const Icon = TILE_ICONS[tile.key];
  return (
    <div className="ow-tile">
      <div className="ow-tile-head">
        <Icon size={18} aria-hidden="true" focusable="false" />
        <h3 className="ow-tile-label">{tile.label}</h3>
        <button type="button" className="ow-tile-q" aria-expanded={open} aria-controls={helpId} onClick={() => setOpen(value => !value)}><span aria-hidden="true">?</span><span className="ow-sr">So zählen wir „{tile.label}“</span></button>
      </div>
      {/* The number and its note are the link; the „?“ stays its own button, outside it. */}
      {tile.href
        ? <Link className="ow-tile-link" href={tile.href}><span className="ow-sr">{tile.label}: </span><span className="ow-tile-n">{tile.value}</span><span className="ow-tile-note">{tile.note}</span></Link>
        : <><span className="ow-tile-n">{tile.value}</span><span className="ow-tile-note">{tile.note}</span></>}
      <p id={helpId} className="ow-tile-help" hidden={!open}>{tile.help}</p>
    </div>
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

export type NextAction = { label: string; href: string } | { label: string; onClick: () => void };
/** „Als Nächstes“: a bar above the bottom navigation on phones, a card in the right column on desktop. */
export function NextBar({ title, text, action }: { title: string; text?: string; action?: NextAction }) {
  return (
    <section className="ow-nextbar" aria-label="Als Nächstes">
      <p><b>{title}</b>{text}</p>
      {action && ("href" in action
        ? <Link className="ow-btn ow-btn--primary ow-btn--sm" href={action.href}>{action.label}</Link>
        : <button type="button" className="ow-btn ow-btn--primary ow-btn--sm" onClick={action.onClick}>{action.label}</button>)}
    </section>
  );
}

const pillOf = (entry: DiaryDay["entries"][number], unit: string) => entry.kind === "award" ? { mark: `+${nf.format(entry.amount)}`, text: "Buchung bestätigt", label: `${nf.format(entry.amount)} ${unit} gebucht` }
  : entry.kind === "correction" ? { mark: "", text: `Korrektur −${nf.format(entry.amount)}`, label: `Korrektur, ${nf.format(entry.amount)} ${unit} zurückgenommen` }
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
