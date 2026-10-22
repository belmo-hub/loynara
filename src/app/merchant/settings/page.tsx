"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/components/client-api";
import { JoinCard } from "@/components/owner/join-card";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, Notice } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";
import { cancellationEnd, germanDate, MIN_NOTICE_DAYS } from "@/lib/programme-end-date";


export default function MerchantSettingsPage() {
  const { me, locations, hiddenSurfaces } = useOwner();
  if (!me) return null;
  if (me.role !== "owner") return <div className="ow-page"><Notice tone="warn">Die Einstellungen sind Inhaber:innen vorbehalten.</Notice></div>;
  return (
    <div className="ow-page">
      <header className="ow-pagehead"><div><p className="ow-eyebrow">Einstellungen</p><h1>Geschäft</h1><p>Name, Standort und Zugang für deine Kunden.</p></div></header>
      <div className="ow-two">
        <section className="ow-card ow-stack" aria-labelledby="ow-biz-title">
          <h2 id="ow-biz-title">Dein Geschäft</h2>
          <dl className="ow-dl">
            <dt>Geschäft</dt><dd>{me.businessName}</dd>
            <dt>Aktiver Standort</dt><dd>{me.locationName}</dd>
            <dt>Standorte</dt><dd>{locations.length || 1}</dd>
            <dt>Programm</dt><dd>{me.programType === "stamp" ? "Stempelkarte" : "Punktekarte"}</dd>
          </dl>
          <div className="ow-row">
            <Link className="ow-btn ow-btn--secondary ow-btn--sm" href="/merchant/program/card">{hiddenSurfaces.includes("cardLogo") ? "Name und Farbe ändern" : "Name, Farbe und Logo ändern"}</Link>
            <Link className="ow-btn ow-btn--ghost ow-btn--sm" href="/merchant/locations">Standorte verwalten</Link>
          </div>
        </section>
        <JoinCard me={me} exportUrl="/api/merchant/export" />
        <WeeklyReport />
        {!hiddenSurfaces.includes("cancellation") && <Cancellation />}
      </div>
    </div>
  );
}

// Deliberately not a pilot surface: it only controls owner mail and must stay reachable on production.
function WeeklyReport() {
  const [setting, reload] = useLoad<{ enabled: boolean }>("/api/merchant/weekly-report");
  const [saved, setSaved] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const enabled = saved ?? (setting.state === "ok" ? setting.data.enabled : null);
  async function change(next: boolean) {
    setSaving(true); setError("");
    try { setSaved((await postJson<{ enabled: boolean }>("/api/merchant/weekly-report", { enabled: next })).enabled); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen."); }
    finally { setSaving(false); }
  }
  return (
    <section className="ow-card ow-stack" aria-labelledby="ow-weekly-title">
      <h2 id="ow-weekly-title">Wochenbericht</h2>
      <p>Jeden Montag um 7 Uhr eine E-Mail mit Besuchen, neuen Kunden, Stammkunden, zurückgewonnenen Kunden und eingelösten Prämien der Vorwoche.</p>
      {setting.state === "error" ? <ErrorNotice message={setting.message} onRetry={reload} />
        : <label className="ow-check"><input type="checkbox" role="switch" checked={enabled ?? false} disabled={enabled === null || saving} onChange={event => change(event.target.checked)} /> Wochenbericht per E-Mail senden</label>}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}

// Cancelling records an end date only; nothing is sent to customers and nothing is deleted. Redemptions work until then.
function Cancellation() {
  const { me, refresh } = useOwner();
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  if (!me) return null;
  const endDate = me.cancellationEndDate ?? null;
  const confirmed = me.cancellationConfirmed === true;
  const planned = cancellationEnd(new Date());
  const text = endDate ? `Unsere Punktekarte endet am ${germanDate(endDate)}. Löse deine Punkte bis dahin ein.` : "";
  async function send(withdraw: boolean) {
    if (!me) return;
    setSaving(true); setError("");
    try { await postJson("/api/merchant/program/cancel", { programSlug: me.programSlug, withdraw }); setConfirming(false); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen."); }
    finally { setSaving(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setError("Kopieren nicht möglich. Markiere den Text und kopiere ihn manuell."); }
  }
  return (
    <section className="ow-card ow-stack" aria-labelledby="ow-cancel-title">
      <h2 id="ow-cancel-title">Programm beenden</h2>
      {endDate ? <>
        {confirmed
          ? <Notice tone="warn">Dein Programm endet am {germanDate(endDate)}. Bis dahin läuft alles normal, auch das Einlösen von Prämien.</Notice>
          : <Notice tone="warn">Voraussichtlich bis zum {germanDate(endDate)}. Laut Pilotvereinbarung endet der Vertrag mit {MIN_NOTICE_DAYS} Tagen Frist zum Ende eines Abrechnungsmonats. Wir bestätigen dir das genaue Enddatum per E-Mail. Bis dahin läuft alles normal.</Notice>}
        {confirmed && <>
          <p>Diesen Text kannst du an der Kasse aushängen oder an deine Kunden schicken. Wir schicken nichts an deine Kunden.</p>
          <div className="ow-field"><label htmlFor="ow-cancel-text" className="ow-sr">Text für deine Kunden</label><textarea id="ow-cancel-text" className="ow-input" readOnly rows={2} value={text} onFocus={event => event.currentTarget.select()} /></div>
        </>}
        <div className="ow-row">
          {confirmed && <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void copy()}>{copied ? "Text kopiert" : "Text kopieren"}</button>}
          <button type="button" className="ow-btn ow-btn--ghost" disabled={saving} onClick={() => void send(true)}>Kündigung zurücknehmen</button>
        </div>
      </> : <>
        <p>Bis zum Enddatum läuft alles normal. Deine Kunden können ihre Punkte weiter einlösen, danach nicht mehr. Ihre Stände bleiben gespeichert.</p>
        <p><strong>Voraussichtlich bis zum {germanDate(planned.endDate)}.</strong> Wir bestätigen dir das genaue Enddatum per E-Mail.{planned.nextMonth ? ` Weil bis zum Monatsende weniger als ${MIN_NOTICE_DAYS} Tage bleiben, rechnen wir mit dem Ende des Folgemonats.` : ""}</p>
        {confirming
          ? <div className="ow-row">
            <button type="button" className="ow-btn ow-btn--danger" disabled={saving} onClick={() => void send(false)}>Ja, Programm beenden</button>
            <button type="button" className="ow-btn ow-btn--ghost" disabled={saving} onClick={() => setConfirming(false)}>Abbrechen</button>
          </div>
          : <div className="ow-row"><button type="button" className="ow-btn ow-btn--secondary" onClick={() => setConfirming(true)}>Programm beenden</button></div>}
      </>}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}
