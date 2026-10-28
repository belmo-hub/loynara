"use client";

import { ArrowRight, ChevronLeft, type LucideIcon } from "lucide-react";
import { Children, isValidElement, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { GuardedLink } from "./owner-shell";
import { OwnerIcon } from "./owner-ui";

/* The „Mehr“ pages (ENG-122c) in the Programm list's grammar (ENG-099) and the Übersicht's (ENG-121): a heading with its
   back link, section heads on the grey, rows with the value at the right edge, an arrow only where a row opens something. */

/** „Mehr“ beside the phone's bottom bar, „Einstellungen“ beside the desktop sidebar: the labels the navigation shows. */
export const MoreLabel = () => <><span className="ow-tabs-only">Mehr</span><span className="ow-side-only">Einstellungen</span></>;

export function PageTitle({ back, title, lead }: { back?: { href: string; label: ReactNode }; title: ReactNode; lead?: ReactNode }) {
  return (
    <header className="ow-pagehead"><div className="ow-qhead">
      {back && <GuardedLink href={back.href} className="ow-back"><ChevronLeft size={20} aria-hidden="true" />{back.label}</GuardedLink>}
      <h1>{title}</h1>
      {lead && <p>{lead}</p>}
    </div></header>
  );
}

/** A link with `href` (a file with `download`), a button with `onClick`, otherwise a plain row. */
export type RowProps = { icon: LucideIcon; title: ReactNode; sub?: ReactNode; value?: ReactNode; big?: boolean; off?: boolean; href?: string; download?: boolean; onClick?: () => void;
  /** A state on its own line under the text (the 55 chip rule): ok for a state, warn for a to-do. */ chip?: { label: string; warn?: boolean } };

export function Row({ icon: Icon, title, sub, value, big, off, href, download, onClick, chip }: RowProps) {
  const opens = Boolean(href || onClick);
  const body = <>
    <span className="ow-prog-icon"><Icon size={22} aria-hidden="true" /></span>
    <span className="ow-prog-main">
      <span className="ow-prog-text"><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      {value != null && value !== "" && <span className="ow-prog-value" data-big={big || undefined} data-off={off || undefined}>{value}</span>}
    </span>
    {opens && <ArrowRight className="ow-prog-arrow" size={22} aria-hidden="true" />}
    {chip && <span className="ow-prog-chip"><span className={`ow-chip ow-chip--${chip.warn ? "warn" : "ok"}`}><OwnerIcon name={chip.warn ? "alert" : "check"} size={14} />{chip.label}</span></span>}
  </>;
  if (href) return download ? <a className="ow-prog-row" href={href} download>{body}</a> : <GuardedLink className="ow-prog-row" href={href}>{body}</GuardedLink>;
  if (onClick) return <button type="button" className="ow-prog-row" onClick={onClick}>{body}</button>;
  return <div className="ow-prog-row">{body}</div>;
}

/** The white card for the one number that matters (the Übersicht's board): its label, the number and its unit, a line per fact. */
export function NumberCard({ label, value, unit, facts, children }: { label: string; value: string; unit?: string; facts?: Array<[string, string]>; children?: ReactNode }) {
  const id = useId();
  return (
    <section className="ow-board ow-numcard" aria-labelledby={id}>
      <p className="ow-board-kicker" id={id}>{label}</p>
      <p className="ow-board-big">{value}{unit && <small>{` ${unit}`}</small>}</p>
      {facts && <dl className="ow-numcard-facts">{facts.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>}
      {children}
    </section>
  );
}

/** A section head on the grey and its rows; `help` puts a „?“ on the head that opens the live help text in a sheet. */
export function Rows({ title, help, note, children }: { title: string; help?: ReactNode; note?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div>
      {help
        ? <div className="ow-rows-head ow-prog-head"><h2>{title}</h2><button type="button" className="ow-tile-q" aria-haspopup="dialog" onClick={() => setOpen(true)}><span aria-hidden="true">?</span><span className="ow-sr">So zählen wir „{title}“</span></button></div>
        : <h2>{title}</h2>}
      <ul>{Children.toArray(children).map((child, index) => <li key={isValidElement(child) ? child.key : index}>{child}</li>)}</ul>
      {note && <p className="ow-prog-note">{note}</p>}
      {help && <Sheet open={open} onClose={close} title="So zählen wir" footer={<Button variant="secondary" block onClick={close}>Schließen</Button>}>{help}</Sheet>}
    </div>
  );
}
