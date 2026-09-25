"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiJson, ClientApiError, postJson } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";
import styles from "./billing.module.css";

type Overview = {
  status: string; currency: "EUR" | "MAD"; locationCount: number; monthlySubtotalMinor: number;
  currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; graceUntil: string | null;
  liveBilling: false; fixtureAvailable: boolean; countingRule: string;
  locations: Array<{ locationId: string; locationName: string; planCode: string; priceMinor: number; memberLimit: number; activeMembers: number }>;
  invoices: Array<{ id: string; providerInvoiceId: string; status: string; amountMinor: number; currency: "EUR" | "MAD"; taxMinor: null; periodEnd: string; createdAt: string }>;
};

function money(minor: number, currency: "EUR" | "MAD") { return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(minor / 100); }
function date(value: string) { return new Date(value).toLocaleDateString("de-DE"); }
function statusLabel(value: string) {
  const labels: Record<string, string> = { manual_pending: "Entwurf ohne Zahlung", pending_checkout: "Lokaler Testvorgang offen", active_fixture: "Lokale Testperiode aktiv", grace_fixture: "Lokale Test-Nachfrist", suspended_fixture: "Lokale Testperiode ausgesetzt", cancelled: "Lokale Testperiode beendet" };
  return labels[value] ?? value;
}

export default function MerchantBillingPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    try { setOverview(await apiJson<Overview>("/api/merchant/billing")); setError(""); setForbidden(false); }
    catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 403) { setForbidden(true); return; }
      setError(cause instanceof Error ? cause.message : "Abrechnung konnte nicht geladen werden.");
    } finally { setLoading(false); }
  }, [router]);
  useEffect(() => {
    let active = true;
    void apiJson<Overview>("/api/merchant/billing").then(result => {
      if (active) { setOverview(result); setError(""); setForbidden(false); setLoading(false); }
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 403) { setForbidden(true); setLoading(false); return; }
      setError(cause instanceof Error ? cause.message : "Abrechnung konnte nicht geladen werden."); setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

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
    try { await postJson("/api/merchant/billing/cancel", {}); setConfirmCancel(false); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Kündigung konnte nicht vorgemerkt werden."); }
    finally { setBusy(false); }
  }

  return <div className="app-page"><header className="app-header"><div className="app-header-inner"><Link href="/merchant"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/locations">Standorte</Link><Link href="/merchant/billing" aria-current="page">Abrechnung</Link><Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Abrechnung</span></div></header>
    <main className={`app-container ${styles.main}`}><div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> TARIFENTWURF · SYNTHETISCHE DATEN</span><h1>Tarif und Abrechnung</h1><p>Preise und Nutzung pro Standort. Diese Vorschau löst keine Zahlung aus.</p></div>
      {loading ? <section className="app-panel"><p role="status">Tarif wird geladen …</p></section> : forbidden ? <section className="app-panel"><p role="alert">Nur Inhaberinnen und Inhaber können Abrechnungsdaten sehen.</p></section> : overview ? <>
        {error && <p role="alert" className="inline-message inline-message--error">{error}</p>}
        <section className={`app-panel ${styles.summary}`}><div><span className="tiny-label">STATUS</span><h2>{statusLabel(overview.status)}</h2><p>{overview.cancelAtPeriodEnd && overview.currentPeriodEnd ? `Beendigung zum ${date(overview.currentPeriodEnd)} vorgemerkt.` : overview.graceUntil ? `Test-Nachfrist bis ${date(overview.graceUntil)}.` : "Keine Live-Zahlung und kein freigegebener Zahlungsanbieter."}</p></div><div><span className="tiny-label">MONATLICHER ENTWURF</span><strong className={styles.total}>{money(overview.monthlySubtotalMinor, overview.currency)}</strong><p>{overview.locationCount} Standort{overview.locationCount === 1 ? "" : "e"} · zzgl. gegebenenfalls anfallender Steuer; keine Rechnung.</p></div></section>
        <section className="app-panel"><h2>Standortpläne und Nutzung</h2><div className={styles.planList}>{overview.locations.map(location => <article className={styles.plan} key={location.locationId}><div><strong>{location.locationName}</strong><small>Standard · {money(location.priceMinor, overview.currency)} / Monat als Entwurf</small></div><p>{location.activeMembers} von {location.memberLimit} aktiven Karten</p></article>)}</div><p className={styles.note}>Geschlossene Karten zählen nicht zum Kartenlimit. Der Preis ist je Standort gespeichert; ein neuer Standort löst keine automatische Zahlung aus.</p></section>
        <section className="app-panel"><h2>Belege aus lokalen Tests</h2>{overview.invoices.length ? <div className={styles.invoiceList}>{overview.invoices.map(invoice => <article key={invoice.id}><strong>{money(invoice.amountMinor, invoice.currency)} · Testbuchung</strong><span>Erfasst {date(invoice.createdAt)} · Testperiode bis {date(invoice.periodEnd)}</span><small>Fixture-Beleg {invoice.providerInvoiceId}. Steuer nicht berechnet; keine gültige Steuerrechnung.</small></article>)}</div> : <p>Keine Testbelege vorhanden. Es wurde keine Zahlung erfasst.</p>}</section>
        <section className="app-panel"><h2>Test und nächste Schritte</h2><p>Ein echter gehosteter Checkout, Portalzugang, Steuerberechnung und Rechnungsversand sind nicht eingerichtet.</p>{overview.fixtureAvailable && ["manual_pending", "pending_checkout", "cancelled", "suspended_fixture"].includes(overview.status) && <button type="button" className="button button--outline" onClick={() => void startFixture()} disabled={busy}>Lokalen Zahlungstest öffnen</button>}{overview.fixtureAvailable && ["active_fixture", "grace_fixture"].includes(overview.status) && !overview.cancelAtPeriodEnd && <>{!confirmCancel ? <button type="button" className="button button--outline" onClick={() => setConfirmCancel(true)}>Testperiode zum Ende beenden</button> : <div className={styles.confirm}><p>Die Testperiode endet zum angezeigten Periodenende. Bestehende Karten und Buchungen bleiben erhalten.</p><button type="button" className="button button--outline" disabled={busy} onClick={() => void cancelFixture()}>Beendigung bestätigen</button><button type="button" className="text-button" onClick={() => setConfirmCancel(false)}>Zurück</button></div>}</>}</section>
        <aside className={styles.note}>{overview.countingRule} Es gibt keine geprüfte Steuer- oder Zahlungsintegration.</aside>
      </> : <section className="app-panel"><p role="alert">{error || "Tarif konnte nicht geladen werden."}</p><button type="button" className="button button--outline" onClick={() => void load()}>Erneut versuchen</button></section>}
    </main></div>;
}
