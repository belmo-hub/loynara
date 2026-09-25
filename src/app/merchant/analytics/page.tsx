"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiJson, ClientApiError, type MeResponse } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";
import type { AnalyticsWindowDays, MerchantAnalytics } from "@/lib/merchant-analytics";
import styles from "./analytics.module.css";

function date(value: string) {
  return new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function timestamp(value: string) {
  return new Date(value).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

export default function MerchantAnalyticsPage() {
  const router = useRouter();
  const [windowDays, setWindowDays] = useState<AnalyticsWindowDays>(30);
  const [report, setReport] = useState<MerchantAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiJson<MeResponse>("/api/me").then(account => {
      if (!active) return null;
      if (account.role !== "owner") { setForbidden(true); setLoading(false); return null; }
      if (!account.programSlug) { router.replace("/merchant/program"); return null; }
      setForbidden(false);
      return apiJson<MerchantAnalytics>(`/api/merchant/analytics?window=${windowDays}`);
    }).then(result => {
      if (!active || !result) return;
      setReport(result); setLoading(false);
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 403) { setForbidden(true); setLoading(false); return; }
      setError(cause instanceof Error ? cause.message : "Die Auswertung konnte nicht geladen werden.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [router, windowDays]);

  const maxSeries = Math.max(1, ...(report?.series.map(bucket => Math.max(bucket.newCards, bucket.checkouts)) ?? []));

  return <div className="app-page">
    <header className={`app-header ${styles.header}`}><div className="app-header-inner"><Link href="/merchant"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link><Link href="/merchant/customers">Kundenkarten</Link><Link href="/merchant/campaigns">Kampagnen</Link><Link href="/merchant/analytics" aria-current="page">Auswertung</Link><Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Auswertung</span></div></header>
    <main className={`app-container ${styles.main}`}>
      <div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> BESTÄTIGTE APP-VORGÄNGE</span><h1>Auswertung</h1><p>Anmeldungen, bestätigte Kassenvorgänge, Prämien und lokale Zustellversuche im gewählten Zeitraum.</p></div>
      <div className={styles.toolbar}><label htmlFor="analytics-window">Zeitraum</label><select id="analytics-window" value={windowDays} onChange={event => { setLoading(true); setError(""); setWindowDays(Number(event.target.value) as AnalyticsWindowDays); }}><option value={30}>Letzte 30 Tage</option><option value={90}>Letzte 90 Tage</option></select>{report && !loading && <span>{date(report.from)} bis {date(report.asOf)} · Stand {timestamp(report.asOf)} UTC</span>}</div>
      {loading ? <section className="app-panel"><p role="status">Auswertung wird geladen …</p></section> : forbidden ? <section className="app-panel"><p role="alert">Nur Inhaberinnen und Inhaber können die Auswertung sehen.</p></section> : error ? <section className="app-panel"><p role="alert">{error}</p></section> : report && <>
        <section aria-labelledby="analytics-overview-heading"><h2 id="analytics-overview-heading" className={styles.sectionTitle}>Karten und Kassenvorgänge</h2><div className={styles.metrics}>
          <Metric label="Aktive Karten aktuell" value={report.currentActiveCards} note="Bestand zum angegebenen Stand; nicht auf den Zeitraum begrenzt." />
          <Metric label="Neue Karten" value={report.newCards} note="Im Zeitraum angelegte Karten, einschließlich später geschlossener Karten." />
          <Metric label="Bestätigte Kassenvorgänge" value={report.qualifyingCheckouts} note="Eindeutige Karten- und Anfragekennungen, ohne vollständig rückgängig gemachte Gutschriften." />
          <Metric label="Wiederkehrende Karten" value={report.repeatCards} note={`Von ${report.participatingCards} Karten mit mindestens einem bestätigten Kassenvorgang; mindestens zwei im Zeitraum.`} />
        </div></section>
        <section className={styles.twoColumns} aria-label="Prämien und Gutschriften">
          <div className="app-panel"><span className="tiny-label">GUTSCHRIFTEN</span><h2>Vergebene Einheiten</h2><dl className={styles.facts}><div><dt>Stempel</dt><dd>{report.issued.stampUnits}</dd></div><div><dt>Punkte</dt><dd>{report.issued.pointUnits}</dd></div><div><dt>Gutschrift-Einträge</dt><dd>{report.issued.awardActions}</dd></div></dl><p>Stempel und Punkte sind verschiedene Einheiten. Korrekturen werden abgezogen, wenn die ursprüngliche Gutschrift vollständig rückgängig gemacht wurde.</p></div>
          <div className="app-panel"><span className="tiny-label">PRÄMIEN</span><h2>Einlösungen</h2><strong className={styles.largeNumber}>{report.rewards.redemptions}</strong>{report.rewards.topTitles.length ? <><h3>Häufigste eingelöste Prämien</h3><ol className={styles.topTitles}>{report.rewards.topTitles.map(item => <li key={item.title}><span>{item.title}</span><strong>{item.count}</strong></li>)}</ol></> : <p>Im Zeitraum wurde keine Prämie eingelöst.</p>}</div>
        </section>
        <section className={`app-panel ${styles.trend}`} aria-labelledby="analytics-trend-heading"><span className="tiny-label">VERLAUF</span><h2 id="analytics-trend-heading">Wochenabschnitte</h2><p>Je Abschnitt: neu angelegte Karten und bestätigte Kassenvorgänge. Der letzte Abschnitt kann kürzer als sieben Tage sein.</p><div className={styles.trendRows}>{report.series.map(bucket => <div className={styles.trendRow} key={bucket.from}><span>{date(bucket.from)}–{date(bucket.to)}</span><div className={styles.barGroup}><div className={styles.barTrack}><div className={styles.cardBar} style={{ width: `${bucket.newCards / maxSeries * 100}%` }} /></div><small>{bucket.newCards} Karten</small><div className={styles.barTrack}><div className={styles.checkoutBar} style={{ width: `${bucket.checkouts / maxSeries * 100}%` }} /></div><small>{bucket.checkouts} Kassen</small></div></div>)}</div></section>
        <section className="app-panel" aria-labelledby="analytics-campaign-heading"><span className="tiny-label">LOKALE TESTZUSTELLUNG</span><h2 id="analytics-campaign-heading">Kampagnenversuche</h2><dl className={styles.attempts}><div><dt>Insgesamt</dt><dd>{report.campaignAttempts.total}</dd></div><div><dt>Vom lokalen Testkanal angenommen</dt><dd>{report.campaignAttempts.complete}</dd></div><div><dt>Unterdrückt</dt><dd>{report.campaignAttempts.suppressed}</dd></div><div><dt>Erneut geplant</dt><dd>{report.campaignAttempts.retry}</dd></div><div><dt>Fehlgeschlagen</dt><dd>{report.campaignAttempts.failed}</dd></div><div><dt>Blockiert</dt><dd>{report.campaignAttempts.blocked}</dd></div></dl><p>Dies zählt Versuche, nicht einzigartige Empfänger. Die Annahme durch Mailpit bestätigt weder die Zustellung in ein echtes Postfach noch eine Öffnung.</p></section>
        <aside className={styles.rules}><h2>Zählregeln und Grenzen</h2><p>{report.countingRule}</p><p>Zeitzone: {report.timezone}. Verfügbare Zeiträume: {report.limits.availableWindowsDays.join(" und ")} Tage. Abschnitte: {report.limits.bucketDays} Tage. Die Prämienliste zeigt höchstens {report.limits.topRewardTitles} Titel. Diese Daten messen weder tatsächliche Besuche noch Umsatzsteigerungen oder zusätzliche Verkäufe.</p></aside>
      </>}
    </main>
  </div>;
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return <div className={`app-panel ${styles.metric}`}><h3>{label}</h3><strong>{value}</strong><p>{note}</p></div>;
}
