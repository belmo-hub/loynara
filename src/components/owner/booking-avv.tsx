"use client";

import { Scale } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/components/client-api";
import { Row, Rows } from "@/components/owner/owner-rows";
import { ErrorNotice, Notice, OwnerDialog } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

type AvvStatus = { version: string; stand: string; acceptedAt: string | null };
const day = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });

/**
 * ENG-339 (Legal 22 Nov): the Inhaberkonto accepts the AVV Fassung with Terminbuchung here, before Loynara can switch
 * online booking on for the shop. One append-only acceptance; afterwards the row only says when.
 */
export function BookingAvvRows() {
  const [status, reload] = useLoad<AvvStatus>("/api/merchant/booking/avv");
  const [accepted, setAccepted] = useState<AvvStatus | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (status.state === "error") return <ErrorNotice message={status.message} onRetry={reload} />;
  const current = accepted ?? (status.state === "ok" ? status.data : null);
  if (!current) return null;
  async function accept() {
    setBusy(true); setError("");
    try { setAccepted(await postJson<AvvStatus>("/api/merchant/booking/avv", {})); setAsking(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Annehmen fehlgeschlagen."); }
    finally { setBusy(false); }
  }
  const title = "Auftragsverarbeitung mit Terminbuchung";
  return <>
    <Rows title="Verträge" note={accepted ? "Angenommen. Loynara kann Online-Termine jetzt für dein Geschäft einschalten." : undefined} noteTone="ok">
      {current.acceptedAt
        ? <Row icon={Scale} title={title} sub={`Fassung vom ${current.stand} · angenommen am ${day(current.acceptedAt)}`} />
        : <Row icon={Scale} title={title} sub={`Fassung vom ${current.stand}. Nötig, bevor Online-Termine für dein Geschäft eingeschaltet werden.`} chip={{ label: "Offen", warn: true }} onClick={() => setAsking(true)} />}
    </Rows>
    {asking && <OwnerDialog title="Auftragsverarbeitung annehmen?" onClose={() => setAsking(false)}
      actions={<><button type="button" className="ow-btn ow-btn--ghost" onClick={() => setAsking(false)} disabled={busy} data-autofocus>Abbrechen</button><button type="button" className="ow-btn ow-btn--primary" onClick={() => void accept()} disabled={busy} aria-busy={busy}>Annehmen</button></>}>
      <p>Mit Online-Terminen verarbeitet Loynara für dich auch Namen und Telefonnummern deiner Kunden. Das regelt der <Link className="ow-qlink" href="/avv" target="_blank" rel="noopener">Vertrag zur Auftragsverarbeitung, Fassung vom {current.stand}</Link>.</p>
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
    </OwnerDialog>}
  </>;
}
