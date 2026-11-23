"use client";

import { Scale } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/components/client-api";
import { Row, Rows } from "@/components/owner/owner-rows";
import { ErrorNotice, Notice, OwnerDialog } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

type Fassung = { version: string; stand: string };
type BookingContractStatus = { terms: Fassung; avv: Fassung; acceptedAt: string | null };
const day = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
/** Legal § 5 (23 Nov): the price stands before the button. */
export const BOOKING_PRICE_LINE = "69 € statt 49 € je Standort und Monat.";

/**
 * ENG-339 (Legal 22 and 23 Nov): the Inhaberkonto accepts the Vertragsbedingungen and the AVV Fassung with „Termin + Treue“
 * here, before Loynara can switch online booking on. One append-only acceptance with both versions; afterwards the row says when.
 */
export function BookingAvvRows() {
  const [status, reload] = useLoad<BookingContractStatus>("/api/merchant/booking/avv");
  const [accepted, setAccepted] = useState<BookingContractStatus | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (status.state === "error") return <ErrorNotice message={status.message} onRetry={reload} />;
  const current = accepted ?? (status.state === "ok" ? status.data : null);
  if (!current) return null;
  async function accept() {
    setBusy(true); setError("");
    try { setAccepted(await postJson<BookingContractStatus>("/api/merchant/booking/avv", {})); setAsking(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Annehmen fehlgeschlagen."); }
    finally { setBusy(false); }
  }
  const title = "Termin + Treue";
  return <>
    <Rows title="Verträge" note={accepted ? "Angenommen. Loynara kann Termin + Treue jetzt für dein Geschäft einschalten." : undefined} noteTone="ok">
      {current.acceptedAt
        ? <Row icon={Scale} title={title} sub={`Vertragsbedingungen und Auftragsverarbeitung · angenommen am ${day(current.acceptedAt)}`} />
        : <Row icon={Scale} title={title} sub="Vertragsbedingungen und Auftragsverarbeitung für Online-Termine. Nötig, bevor Loynara sie für dein Geschäft einschaltet." chip={{ label: "Offen", warn: true }} onClick={() => setAsking(true)} />}
    </Rows>
    {asking && <OwnerDialog title="Termin + Treue annehmen?" onClose={() => setAsking(false)}
      actions={<><button type="button" className="ow-btn ow-btn--ghost" onClick={() => setAsking(false)} disabled={busy} data-autofocus>Abbrechen</button><button type="button" className="ow-btn ow-btn--primary" onClick={() => void accept()} disabled={busy} aria-busy={busy}>Annehmen</button></>}>
      <p><strong>{BOOKING_PRICE_LINE}</strong></p>
      <p>Es gelten die <Link className="ow-link" href="/vertragsbedingungen" target="_blank" rel="noopener">Vertragsbedingungen, Fassung vom {current.terms.stand}</Link>, und der <Link className="ow-link" href="/avv" target="_blank" rel="noopener">Vertrag zur Auftragsverarbeitung, Fassung vom {current.avv.stand}</Link>. Mit Online-Terminen verarbeitet Loynara für dich auch Namen und Telefonnummern deiner Kunden.</p>
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
    </OwnerDialog>}
  </>;
}
