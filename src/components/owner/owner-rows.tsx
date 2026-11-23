"use client";

import { ArrowRight, ChevronLeft, CircleHelp, type LucideIcon } from "lucide-react";
import { Children, isValidElement, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { GuardedLink } from "./owner-shell";
import { OwnerIcon } from "./owner-ui";

/* The „Mehr“ pages (ENG-122c) in the Programm list's grammar (ENG-099) and the Übersicht's (ENG-121): a heading with its
   back link, section heads on the grey, rows with the value at the right edge, an arrow only where a row opens something. */

/** „Mehr“ beside the phone's bottom bar, „Einstellungen“ beside the desktop sidebar: the labels the navigation shows. */
export const MoreLabel = () => <><span className="ow-tabs-only">Mehr</span><span className="ow-side-only">Einstellungen</span></>;

/** `back` leads to a page (`href`) or, for a step inside a page, runs `onClick`. */
export function PageTitle({ back, title, lead }: { back?: { label: ReactNode; href?: string; onClick?: () => void }; title: ReactNode; lead?: ReactNode }) {
  const arrow = <ChevronLeft size={20} aria-hidden="true" />;
  return (
    <header className="ow-pagehead"><div className="ow-qhead">
      {back && (back.href ? <GuardedLink href={back.href} className="ow-back">{arrow}{back.label}</GuardedLink> : <button type="button" className="ow-back ow-back--step" onClick={back.onClick}>{arrow}{back.label}</button>)}
      <h1>{title}</h1>
      {lead && <p>{lead}</p>}
    </div></header>
  );
}

/** A link with `href` (a file with `download`), a button with `onClick`, otherwise a plain row. */
export type RowProps = { icon: LucideIcon; title: ReactNode; sub?: ReactNode; value?: ReactNode; big?: boolean; off?: boolean; href?: string; download?: boolean; onClick?: () => void;
  /** A state on its own line under the text, 4 below it (the 55 chip rule): ok for a state, warn for a to-do. */ chip?: { label: string; warn?: boolean; /** Overrides warn: neutral has no colour and no icon, danger the alert icon. */ tone?: "ok" | "warn" | "danger" | "neutral" };
  /** Outlined after its page saved (Design rule 10). */ saved?: boolean };

export function Row({ icon: Icon, title, sub, value, big, off, href, download, onClick, chip, saved }: RowProps) {
  const opens = Boolean(href || onClick);
  const body = <>
    <span className="ow-prog-icon"><Icon size={22} aria-hidden="true" /></span>
    <span className="ow-prog-main">
      <span className="ow-prog-text"><strong>{title}</strong>{sub && <small>{sub}</small>}{chip && <Chip {...chip} />}</span>
      {value != null && value !== "" && <span className="ow-prog-value" data-big={big || undefined} data-off={off || undefined}>{value}</span>}
    </span>
    {opens && <ArrowRight className="ow-prog-arrow" size={22} aria-hidden="true" />}
  </>;
  if (href) return download ? <a className="ow-prog-row" href={href} download>{body}</a> : <GuardedLink className="ow-prog-row" href={href} data-saved={saved || undefined}>{body}</GuardedLink>;
  if (onClick) return <button type="button" className="ow-prog-row" onClick={onClick}>{body}</button>;
  return <div className="ow-prog-row">{body}</div>;
}

/** The one green band of a page (Wegweiser): its single next step, the whole band one link or button. */
export function Band({ icon: Icon, title, sub, href, onClick }: { icon: LucideIcon; title: string; sub?: string; href?: string; onClick?: () => void }) {
  const body = <>
    <span className="ow-band-icon"><Icon size={22} aria-hidden="true" /></span>
    <span className="ow-band-text"><b>{title}</b>{sub && <small>{sub}</small>}</span>
    <ArrowRight className="ow-band-arrow" size={22} aria-hidden="true" />
  </>;
  return href ? <GuardedLink className="ow-band" href={href}>{body}</GuardedLink> : <button type="button" className="ow-band" onClick={onClick}>{body}</button>;
}

/** A confirmation as a screen of its own (Programm 28/30): the question, what happens, the action filled and „Abbrechen“ under it. */
export function Confirm({ title, back, action, busyAction, busy, danger = true, disabled = false, onConfirm, onCancel, children }: { title: string; back: ReactNode; action: string; busyAction?: string; busy: boolean; danger?: boolean; disabled?: boolean; onConfirm: () => void; onCancel: () => void; children: ReactNode }) {
  return (
    <div className="ow-page ow-qpage">
      <PageTitle back={{ label: back, onClick: onCancel }} title={title} />
      <div className="ow-q">
        {children}
        <div className="ow-qsave ow-qsave--pair">
          <button type="button" className={`ow-btn ${danger ? "ow-btn--danger" : "ow-btn--primary"}`} disabled={busy || disabled} aria-busy={busy} onClick={onConfirm}>{busy && busyAction ? busyAction : action}</button>
          <button type="button" className="ow-btn ow-btn--secondary" onClick={onCancel}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
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
/** `noteTone`: the note is an outcome under the panel: an error (alert icon, announced), a confirmation (check, status) or a
 *  neutral next step (status, its text and button wrapping as one row). */
export function Rows({ title, help, helpTitle = "So zählen wir", note, noteTone, children }: { title: string; help?: ReactNode; helpTitle?: string; note?: ReactNode; noteTone?: "error" | "ok" | "info"; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div>
      {help
        ? <div className="ow-rows-head ow-prog-head"><h2>{title}</h2><button type="button" className="ow-tile-q" aria-haspopup="dialog" onClick={() => setOpen(true)}><CircleHelp size={22} aria-hidden="true" /><span className="ow-sr">{helpTitle} „{title}“</span></button></div>
        : <h2>{title}</h2>}
      <ul>{Children.toArray(children).map((child, index) => <li key={isValidElement(child) ? child.key : index}>{child}</li>)}</ul>
      {note && (noteTone === "info"
        ? <p className="ow-prog-note ow-prog-step" role="status">{note}</p>
        : noteTone
        ? <p className={`ow-prog-note ow-prog-outcome${noteTone === "error" ? " ow-error" : ""}`} role={noteTone === "error" ? "alert" : "status"}><OwnerIcon name={noteTone === "error" ? "alert" : "check"} size={20} /><span>{note}</span></p>
        : <p className="ow-prog-note">{note}</p>)}
      {help && <Sheet open={open} onClose={close} title={helpTitle} footer={<Button variant="secondary" block onClick={close}>Schließen</Button>}>{help}</Sheet>}
    </div>
  );
}

function Chip({ label, warn, tone = warn ? "warn" : "ok" }: { label: string; warn?: boolean; tone?: "ok" | "warn" | "danger" | "neutral" }) {
  return <span className={tone === "neutral" ? "ow-chip" : `ow-chip ow-chip--${tone}`}>{tone !== "neutral" && <OwnerIcon name={tone === "ok" ? "check" : "alert"} size={16} />}{label}</span>;
}
