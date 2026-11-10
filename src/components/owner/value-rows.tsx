"use client";

import Link from "next/link";
import { ArrowRight, CircleHelp, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { BROUGHT_COPY } from "@/lib/spend-copy";
import { LinkPending } from "./owner-ui";

/** One signpost row (Wegweiser): the value at the right edge in ink, muted when it says „off“ (`off`), an arrow only with `href`. */
export type ValueRow = { key: string; icon: LucideIcon; title: string; sub?: string; value?: string; off?: boolean; href?: string };

/** A help block in the sheet: an optional name (a row's title) and its live text. */
export type Help = { title?: string; text: ReactNode };

/** A section head on the grey; its „?“ opens the section's live help texts in the shared „So zählen wir“ sheet. */
export function RowSection({ title, help, helpTitle = BROUGHT_COPY.howWeCountTitle, children }: { title: string; help?: Help[] | null; helpTitle?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const close = () => setOpen(false);
  return (
    <section className="ow-rows-section" aria-labelledby={id}>
      <div className="ow-rows-head">
        <h2 id={id} className="ow-tiles-title">{title}</h2>
        {help && <button type="button" className="ow-tile-q" aria-haspopup="dialog" onClick={() => setOpen(true)}><CircleHelp size={22} aria-hidden="true" /><span className="ow-sr">{helpTitle} „{title}“</span></button>}
      </div>
      {children}
      {help && <Sheet open={open} onClose={close} title={helpTitle} footer={<Button variant="secondary" block onClick={close}>Schließen</Button>}>
        {help.map((block, index) => <div className="ow-rows-help" key={index}>{block.title && <h3>{block.title}</h3>}<p>{block.text}</p></div>)}
      </Sheet>}
    </section>
  );
}

/** The rows of a section, as the Übersicht draws them: the value first in the DOM (read before the label), drawn at the right. */
export function Rows({ rows }: { rows: ValueRow[] }) {
  return <ul className="ow-rows">{rows.map(({ key, icon: Icon, title, sub, value, off, href }) => {
    const body = <>
      <span className="ow-prog-icon"><Icon size={22} aria-hidden="true" focusable="false" /></span>
      <span className="ow-prog-main">
        {/* Numbers and amounts big, words („An“) at text size, as on the Programm list. */}
        {value !== undefined && <span className="ow-prog-value" data-big={(!off && /\d/.test(value)) || undefined} data-off={off || undefined}>{value}</span>}
        <span className="ow-prog-text"><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      </span>
    </>;
    return <li key={key}>{href ? <Link className="ow-prog-row" href={href}>{body}<ArrowRight className="ow-prog-arrow" size={22} aria-hidden="true" /><LinkPending /></Link> : <div className="ow-prog-row">{body}</div>}</li>;
  })}</ul>;
}
