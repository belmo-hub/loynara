"use client";

import { Scale } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/components/client-api";
import { Row, Rows } from "@/components/owner/owner-rows";
import { Notice, OwnerDialog } from "@/components/owner/owner-ui";
import { OWNER_AVV, OWNER_TERMS } from "@/lib/owner-contract";

/** A stored Fassung version (YYYY-MM-DD) as its Stand, e.g. „29. November 2026“. */
const fassungDay = (version: string) => new Date(`${version}T12:00:00Z`).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fassungen = ({ terms, avv }: Fassung) => terms === avv ? `Fassung vom ${fassungDay(terms)}` : `Vertragsbedingungen vom ${fassungDay(terms)}, Auftragsverarbeitung vom ${fassungDay(avv)}`;
type Fassung = { terms: string; avv: string };
const day = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
/** The plan's name never breaks across lines (Design, 24 Nov). */
const PLAN = "Termin\u00a0+\u00a0Treue";
/** Legal § 5 and § 7: the price stands before the button, the same for every shop (founder, 24 Nov: no founding price any more). */
export const BOOKING_PRICE_LINE = `69 € statt 49 € je Standort und Monat, nur für Standorte mit ${PLAN}.`;
const documents = <><Link className="ow-link" href="/vertragsbedingungen" target="_blank" rel="noopener">Vertragsbedingungen</Link> · <Link className="ow-link" href="/avv" target="_blank" rel="noopener">Auftragsverarbeitung</Link></>;

/**
 * ENG-339 (Legal 22 and 23 Nov, § 6): optional for every owner, and accepting costs nothing; the Inhaberkonto accepts the Vertragsbedingungen and the AVV Fassung with „Termin + Treue“
 * here, before Loynara can switch online booking on. One append-only acceptance with both versions; afterwards the row says when.
 * The answer comes with /api/me, so the page has its full height when it scrolls to a section (#absender).
 */
export function BookingAvvRows({ acceptedAt, fassung }: { acceptedAt: string | null; fassung: Fassung | null }) {
  const [accepted, setAccepted] = useState<(Fassung & { acceptedAt: string }) | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answered = accepted ?? (acceptedAt && fassung ? { acceptedAt, ...fassung } : null);
  // The dialog hands focus back to the row it opened from, which an acceptance turns into plain text: move it to the outcome.
  const section = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const note = accepted ? section.current?.querySelector<HTMLElement>("[role=status]") : null;
    if (note) { note.tabIndex = -1; note.focus(); }
  }, [accepted]);
  async function accept() {
    setBusy(true); setError("");
    try { setAccepted(await postJson<Fassung & { acceptedAt: string }>("/api/merchant/booking/avv", {})); setAsking(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Annehmen fehlgeschlagen."); }
    finally { setBusy(false); }
  }
  return <>
    <div ref={section}><Rows title="Verträge" noteTone={accepted ? "ok" : undefined}
      note={accepted ? <>Angenommen. Schreib uns an <a className="ow-link" href="mailto:support@getloynara.com">support@getloynara.com</a>, für welchen Standort du {PLAN} möchtest. {documents}</> : answered ? documents : undefined}>
      {answered
        ? <Row icon={Scale} title={PLAN} sub={`Vertragsbedingungen und Auftragsverarbeitung · angenommen am ${day(answered.acceptedAt)} · ${fassungen(answered)}`} />
        : <Row icon={Scale} title={PLAN} sub="Optional: Vertragsbedingungen und Auftragsverarbeitung für Online-Termine. Annehmen kostet nichts." onClick={() => setAsking(true)} />}
    </Rows></div>
    {asking && <OwnerDialog title={`Verträge für ${PLAN} annehmen?`} onClose={() => setAsking(false)}
      actions={<><button type="button" className="ow-btn ow-btn--ghost" onClick={() => setAsking(false)} disabled={busy} data-autofocus>Abbrechen</button><button type="button" className="ow-btn ow-btn--primary" onClick={() => void accept()} disabled={busy} aria-busy={busy}>Annehmen</button></>}>
      <p>Annehmen kostet nichts.</p>
      <p><strong>{BOOKING_PRICE_LINE}</strong></p>
      <p>Loynara schaltet {PLAN} nur auf deinen Wunsch für einzelne Standorte ein; erst ab dann gilt dort der neue Preis. Es gelten die <Link className="ow-link" href="/vertragsbedingungen" target="_blank" rel="noopener">Vertragsbedingungen, Fassung vom {OWNER_TERMS.stand}</Link>, und der <Link className="ow-link" href="/avv" target="_blank" rel="noopener">Vertrag zur Auftragsverarbeitung, Fassung vom {OWNER_AVV.stand}</Link>. Mit Online-Terminen verarbeitet Loynara für dich auch Namen und Telefonnummern deiner Kundschaft.</p>
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
    </OwnerDialog>}
  </>;
}
