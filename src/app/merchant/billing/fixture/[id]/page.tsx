"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/client-api";
import { ErrorNotice, LoadingBlock, PageHead } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

type Handoff = { id: string; status: "pending" | "complete"; amountMinor: number; currency: "EUR" | "MAD" };

export default function BillingFixturePage() {
  const { id } = useParams<{ id: string }>();
  const [handoff, reload] = useLoad<Handoff>(`/api/merchant/billing/fixture/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function complete() {
    setBusy(true); setError("");
    try { await postJson(`/api/merchant/billing/fixture/${encodeURIComponent(id)}/complete`, {}); setDone(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Testbuchung nicht möglich."); }
    finally { setBusy(false); }
  }
  const h = handoff.state === "ok" ? handoff.data : null;
  const amount = h ? new Intl.NumberFormat("de-DE", { style: "currency", currency: h.currency }).format(h.amountMinor / 100) : "";
  return (
    <div className="ow-page" style={{ maxWidth: 760 }}>
      <PageHead eyebrow="Einstellungen · Lokale Fixture" title="Test einer gehosteten Übergabe" lead="Nur ein lokaler Test. Es wird kein Geld bewegt." />
      {handoff.state === "loading" && <LoadingBlock rows={1} />}
      {handoff.state === "error" && <ErrorNotice message={handoff.message} onRetry={reload} />}
      {h && (
        <section className="ow-card ow-stack">
          <h2>{done ? "Lokale Testbuchung erfasst." : h.status === "complete" ? "Bereits als Test erfasst" : "Testbetrag bestätigen"}</h2>
          <p><strong>{amount}</strong> als synthetische Monatsperiode. Steuerberechnung, externe Zahlung und gültige Rechnung sind nicht Teil dieser Fixture.</p>
          {error && <ErrorNotice message={error} />}
          <div className="ow-row">
            {h.status === "pending" && !done && <button type="button" className="ow-btn ow-btn--primary" disabled={busy} aria-busy={busy} onClick={() => void complete()}>{busy ? "Wird geprüft …" : "Testbuchung bestätigen"}</button>}
            <Link href="/merchant/billing" className="ow-btn ow-btn--secondary">Zur Abrechnung</Link>
          </div>
        </section>
      )}
    </div>
  );
}
