"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/components/client-api";
import { JoinCard } from "@/components/owner/join-card";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, Notice } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

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
        : <label className="ow-check"><input type="checkbox" checked={enabled ?? false} disabled={enabled === null || saving} onChange={event => change(event.target.checked)} /> Wochenbericht per E-Mail senden</label>}
      {error && <Notice tone="danger">{error}</Notice>}
    </section>
  );
}
