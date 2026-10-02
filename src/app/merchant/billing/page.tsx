"use client";

import { useState } from "react";
import { postJson } from "@/components/client-api";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, Notice, PageHead } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

type Overview = {
  status: string; currency: "EUR" | "MAD"; locationCount: number; monthlySubtotalMinor: number;
  currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; graceUntil: string | null;
  liveBilling: false; fixtureAvailable: boolean; countingRule: string;
  locations: Array<{ locationId: string; locationName: string; planCode: string; priceMinor: number; memberLimit: number; activeMembers: number }>;
  invoices: Array<{ id: string; providerInvoiceId: string; status: string; amountMinor: number; currency: "EUR" | "MAD"; taxMinor: null; periodEnd: string; createdAt: string }>;
};
const money = (minor: number, currency: "EUR" | "MAD") => new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(minor / 100);
const date = (value: string) => new Date(value).toLocaleDateString("de-DE");
const STATUS: Record<string, string> = { manual_pending: "Entwurf ohne Zahlung", pending_checkout: "Lokaler Testvorgang offen", active_fixture: "Lokale Testperiode aktiv", grace_fixture: "Lokale Test-Nachfrist", suspended_fixture: "Lokale Testperiode ausgesetzt", cancelled: "Lokale Testperiode beendet" };

export default function MerchantBillingPage() {
  const { me } = useOwner();
  const [data, reload] = useLoad<Overview>(me?.role === "owner" ? "/api/merchant/billing" : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!me) return null;
  const head = <PageHead eyebrow="Einstellungen · Abrechnung" title="Tarif und Abrechnung" lead="Preise und Nutzung pro Standort. Diese Vorschau löst keine Zahlung aus." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur Inhaber:innen können Abrechnungsdaten sehen.</Notice></div>;
  if (data.state === "error") return <div className="ow-page">{head}<ErrorNotice message={data.message} onRetry={reload} /></div>;
  if (data.state !== "ok") return <div className="ow-page">{head}<LoadingBlock rows={3} /></div>;
  const o = data.data;

  async function startFixture() {
    setBusy(true); setError("");
    try {
      const handoff = await postJson<{ url: string }>("/api/merchant/billing/handoff", {});
      const target = new URL(handoff.url);
      if (target.origin !== window.location.origin || !target.pathname.startsWith("/merchant/billing/fixture/")) throw new Error("Lokaler Testlink ist ungültig.");
      window.location.assign(target.pathname);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Testvorgang konnte nicht gestartet werden."); setBusy(false); }
  }
  async function cancelFixture() {
    setBusy(true); setError("");
    try { await postJson("/api/merchant/billing/cancel", {}); setConfirmCancel(false); reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Kündigung konnte nicht vorgemerkt werden."); }
    finally { setBusy(false); }
  }

  return (
    <div className="ow-page">
      {head}
      <Notice tone="warn">Nur ein Tarifentwurf. Es gibt keine Live-Zahlung, keine geprüfte Steuerberechnung und keinen Rechnungsversand.</Notice>
      {error && <ErrorNotice message={error} />}
      <section className="ow-card ow-two" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", alignItems: "center" }}>
        <div><p className="ow-eyebrow">Status</p><h2>{STATUS[o.status] ?? o.status}</h2><p className="ow-muted" style={{ marginTop: 4 }}>{o.cancelAtPeriodEnd && o.currentPeriodEnd ? `Beendigung zum ${date(o.currentPeriodEnd)} vorgemerkt.` : o.graceUntil ? `Test-Nachfrist bis ${date(o.graceUntil)}.` : "Keine Live-Zahlung und kein freigegebener Zahlungsanbieter."}</p></div>
        <div><p className="ow-eyebrow">Monatlicher Entwurf</p><strong className="ow-metric-value" style={{ fontSize: 36 }}>{money(o.monthlySubtotalMinor, o.currency)}</strong><p className="ow-muted" style={{ marginTop: 4 }}>{o.locationCount} Standort{o.locationCount === 1 ? "" : "e"} · zzgl. gegebenenfalls anfallender Steuer; keine Rechnung.</p></div>
      </section>
      <section className="ow-card ow-stack" aria-labelledby="bi-plans"><h2 id="bi-plans">Standortpläne und Nutzung</h2>
        <ul className="ow-feed">{o.locations.map(location => <li key={location.locationId}><span><strong>{location.locationName}</strong><br /><small className="ow-muted">Standard · {money(location.priceMinor, o.currency)} / Monat als Entwurf</small></span><span className="ow-num">{location.activeMembers} von {location.memberLimit} aktiven Karten</span></li>)}</ul>
        <p className="ow-hint">Geschlossene Karten zählen nicht zum Kartenlimit. Der Preis ist je Standort gespeichert; ein neuer Standort löst keine automatische Zahlung aus.</p></section>
      <section className="ow-card ow-stack" aria-labelledby="bi-inv"><h2 id="bi-inv">Belege</h2>
        {o.invoices.length ? <ul className="ow-feed">{o.invoices.map(invoice => <li key={invoice.id} style={{ display: "block" }}><strong>{money(invoice.amountMinor, invoice.currency)} · Testbuchung</strong><br /><span className="ow-muted">Erfasst {date(invoice.createdAt)} · Testperiode bis {date(invoice.periodEnd)}</span><br /><small className="ow-muted">Fixture-Beleg {invoice.providerInvoiceId}. Steuer nicht berechnet; keine gültige Steuerrechnung.</small></li>)}</ul> : <p className="ow-muted">Keine Belege vorhanden. Es wurde keine Zahlung erfasst.</p>}</section>
      <section className="ow-card ow-stack" aria-labelledby="bi-next"><h2 id="bi-next">Nächste Schritte</h2>
        <p>Ein echter gehosteter Checkout, Portalzugang, Steuerberechnung und Rechnungsversand sind nicht eingerichtet.</p>
        <div className="ow-row">
          {o.fixtureAvailable && ["manual_pending", "pending_checkout", "cancelled", "suspended_fixture"].includes(o.status) && <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void startFixture()} disabled={busy}>Lokalen Zahlungstest öffnen</button>}
          {o.fixtureAvailable && ["active_fixture", "grace_fixture"].includes(o.status) && !o.cancelAtPeriodEnd && (!confirmCancel
            ? <button type="button" className="ow-btn ow-btn--secondary" onClick={() => setConfirmCancel(true)}>Testperiode zum Ende beenden</button>
            : <div className="ow-readonly ow-stack"><p>Die Testperiode endet zum angezeigten Periodenende. Bestehende Karten und Buchungen bleiben erhalten.</p><div className="ow-row"><button type="button" className="ow-btn ow-btn--danger" disabled={busy} onClick={() => void cancelFixture()}>Beendigung bestätigen</button><button type="button" className="ow-btn ow-btn--ghost" onClick={() => setConfirmCancel(false)}>Zurück</button></div></div>)}
        </div>
      </section>
      <Notice>{o.countingRule} Es gibt keine geprüfte Steuer- oder Zahlungsintegration.</Notice>
    </div>
  );
}
