"use client";

import { germanDate, keepUnits } from "@/lib/german-date";
import { OwnerIcon } from "./owner-ui";

export type SentRow = { id: string; text: string; status: "queued" | "sending" | "complete" | "stopped"; createdAt: string; audience: number; sent: number; failed: number; skipped: number; removed: number; warn: boolean };

const NB = " ";
// Only a message still going or stopped carries a chip; a finished one says so in its line (Design, 6 Nov).
const CHIP = { queued: "Wartet", sending: "Läuft", stopped: "Gestoppt" } as const;
const day = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));

/** The quiet line under a sent message: „29.10., 12:43 · an 26 Karten gesendet“, „Heute, 12:58 · 6 von 26 gesendet“.
 *  „gesendet“, never „erreicht“: the device never confirms a native Apple push. */
export function sentLine(row: SentRow, timeZone: string, now = new Date()) {
  const when = day(row.createdAt, timeZone) === day(now.toISOString(), timeZone)
    ? `Heute, ${new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(row.createdAt))}`
    : germanDate(row.createdAt, "feed", { timeZone });
  const count = row.status !== "complete" ? `${row.sent}${NB}von${NB}${row.audience} gesendet`
    : row.sent === row.audience ? `an ${row.sent}${NB}${row.sent === 1 ? "Karte" : "Karten"} gesendet` : `an ${row.sent}${NB}von${NB}${row.audience} gesendet`;
  return `${when} · ${count}`;
}

/** Cards removed in the 48 hours after a send, only once there is one (Design, 6 Nov). */
export const removedLine = (removed: number) => removed > 0 ? `${removed}${NB}${removed === 1 ? "Karte" : "Karten"} in 48${NB}Stunden entfernt` : "";

/** Gesendete Nachrichten (Design rule 5): the message first, one quiet line under it; no table on a phone. */
export function SentMessages({ rows, timeZone, onStop }: { rows: SentRow[]; timeZone: string; onStop: (id: string) => void }) {
  return (
    <section className="ow-qpanel ow-stack ow-history" aria-labelledby="wm-history">
      <h2 id="wm-history">Gesendete Nachrichten</h2>
      {rows.length === 0 ? <p className="ow-muted">Noch keine Nachricht gesendet.</p> : (
        <ul className="ow-sent" role="list">{rows.map(row => {
          const removed = removedLine(row.removed);
          return (
            <li key={row.id}>
              <p className="ow-sent-text">{keepUnits(row.text)}</p>
              <p className="ow-sent-meta">{sentLine(row, timeZone)}</p>
              {removed && (row.warn ? <p className="ow-sent-warn"><OwnerIcon name="alert" size={16} />{removed}</p> : <p className="ow-sent-meta">{removed}</p>)}
              {row.status !== "complete" && <div className="ow-sent-live"><span className="ow-chip ow-chip--info">{CHIP[row.status]}</span>
                {row.status !== "stopped" && <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => onStop(row.id)}>Stoppen</button>}</div>}
            </li>
          );
        })}</ul>
      )}
    </section>
  );
}
