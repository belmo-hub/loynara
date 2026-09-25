"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiJson, ClientApiError, postJson } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";

type Handoff = { id: string; status: "pending" | "complete"; amountMinor: number; currency: "EUR" | "MAD" };

export default function BillingFixturePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void apiJson<Handoff>(`/api/merchant/billing/fixture/${encodeURIComponent(id)}`).then(result => {
      if (active) { setHandoff(result); setError(""); setLoading(false); }
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      setError(cause instanceof Error ? cause.message : "Testvorgang nicht verfügbar."); setLoading(false);
    });
    return () => { active = false; };
  }, [id, router]);
  async function complete() {
    setBusy(true); setError("");
    try { await postJson(`/api/merchant/billing/fixture/${encodeURIComponent(id)}/complete`, {}); setDone(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Testbuchung nicht möglich."); }
    finally { setBusy(false); }
  }
  const amount = handoff ? new Intl.NumberFormat("de-DE", { style: "currency", currency: handoff.currency }).format(handoff.amountMinor / 100) : "";
  return <div className="app-page"><header className="app-header"><div className="app-header-inner"><Link href="/merchant"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant/billing">Abrechnung</Link></nav><span className="app-header-location">Lokaler Test</span></div></header><main className="app-container" style={{ maxWidth: 760, paddingBlock: "3rem 5rem" }}><div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> LOKALE FIXTURE</span><h1>Test einer gehosteten Übergabe</h1><p>Nur ein lokaler Test. Es wird kein Geld bewegt.</p></div><section className="app-panel" style={{ marginTop: "2rem" }}>
    {loading ? <p role="status">Testvorgang wird geladen …</p> : error && !handoff ? <p role="alert">{error}</p> : handoff ? <><h2>{done ? "Lokale Testbuchung erfasst." : handoff.status === "complete" ? "Bereits als Test erfasst" : "Testbetrag bestätigen"}</h2><p><strong>{amount}</strong> als synthetische Monatsperiode. Steuerberechnung, externe Zahlung und gültige Rechnung sind nicht Teil dieser Fixture.</p>{handoff.status === "pending" && !done && <button type="button" className="button button--ink" disabled={busy} onClick={() => void complete()}>{busy ? "Wird geprüft …" : "Testbuchung bestätigen"}</button>}{error && <p role="alert" className="inline-message inline-message--error">{error}</p>}<p><Link href="/merchant/billing" className="button button--outline">Zur Abrechnung</Link></p></> : null}
  </section></main></div>;
}
