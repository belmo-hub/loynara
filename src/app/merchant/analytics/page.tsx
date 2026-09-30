"use client";

import { useState } from "react";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, Notice, PageHead } from "@/components/owner/owner-ui";
import { ALL_LOCATIONS_NOTE, PeriodBar } from "@/components/owner/period-bar";
import { useLoad } from "@/components/owner/use-load";
import type { AnalyticsWindowDays, MerchantAnalytics } from "@/lib/merchant-analytics";

const date = (value: string) => new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const timestamp = (value: string) => new Date(value).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default function MerchantAnalyticsPage() {
  const { me } = useOwner();
  const [windowDays, setWindowDays] = useState<AnalyticsWindowDays>(30);
  const [report, reload] = useLoad<MerchantAnalytics>(me?.role === "owner" ? `/api/merchant/analytics?window=${windowDays}` : null);
  if (!me) return null;
  const head = <PageHead eyebrow="Aktionen · Ergebnisse" title="Auswertung" lead="Anmeldungen, bestätigte Kassenvorgänge, Prämien, Empfehlungen und lokale Zustellversuche im gewählten Zeitraum." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur Inhaber:innen können die Auswertung sehen.</Notice></div>;
  const r = report.state === "ok" ? report.data : null;
  const maxSeries = Math.max(1, ...(r?.series.map(bucket => Math.max(bucket.newCards, bucket.checkouts)) ?? []));
  return (
    <div className="ow-page">
      {head}
      <Notice>{ALL_LOCATIONS_NOTE}</Notice>
      <PeriodBar id="analytics-window" value={windowDays} onChange={setWindowDays} meta={r ? `${date(r.from)} bis ${date(r.asOf)} · Stand ${timestamp(r.asOf)} UTC` : undefined} />
      {report.state === "error" && <ErrorNotice message={report.message} onRetry={reload} />}
      {report.state === "loading" && <LoadingBlock rows={3} />}
      {r && <>
        <section aria-labelledby="an-overview" className="ow-stack"><h2 id="an-overview" style={{ fontSize: 17 }}>Karten und Kassenvorgänge</h2>
          <div className="ow-metrics">
            <Metric label="Aktive Karten aktuell" value={r.currentActiveCards} note="Bestand zum angegebenen Stand; nicht auf den Zeitraum begrenzt." />
            <Metric label="Neue Karten" value={r.newCards} note="Im Zeitraum angelegte Karten, einschließlich später geschlossener Karten." />
            <Metric label="Bestätigte Kassenvorgänge" value={r.qualifyingCheckouts} note="Eindeutige Karten- und Anfragekennungen, ohne vollständig rückgängig gemachte Gutschriften." />
            <Metric label="Wiederkehrende Karten" value={r.repeatCards} note={`Von ${r.participatingCards} Karten mit mindestens einem bestätigten Kassenvorgang; mindestens zwei im Zeitraum.`} />
          </div>
        </section>
        <div className="ow-two" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }} aria-label="Prämien und Gutschriften">
          <section className="ow-card ow-stack"><h2>Vergebene Einheiten</h2>
            <dl className="ow-dl"><dt>Stempel</dt><dd className="ow-num">{r.issued.stampUnits}</dd><dt>Punkte</dt><dd className="ow-num">{r.issued.pointUnits}</dd><dt>Gutschrift-Einträge</dt><dd className="ow-num">{r.issued.awardActions}</dd></dl>
            <p className="ow-hint">Stempel und Punkte sind verschiedene Einheiten. Korrekturen werden abgezogen, wenn die ursprüngliche Gutschrift vollständig rückgängig gemacht wurde.</p></section>
          <section className="ow-card ow-stack"><h2>Einlösungen</h2><strong className="ow-metric-value">{r.rewards.redemptions}</strong>
            {r.rewards.topTitles.length ? <><h3 style={{ fontSize: 15 }}>Häufigste eingelöste Prämien</h3><ol className="ow-feed">{r.rewards.topTitles.map(item => <li key={item.title}><span>{item.title}</span><strong className="ow-num">{item.count}</strong></li>)}</ol></> : <p className="ow-muted">Im Zeitraum wurde keine Prämie eingelöst.</p>}</section>
        </div>
        <section className="ow-card ow-stack" aria-labelledby="an-ref"><h2 id="an-ref">Empfehlungsereignisse</h2>
          <dl className="ow-dl"><dt>Zugeordnete Beitritte</dt><dd className="ow-num">{r.referrals.attributed}</dd><dt>Bonusqualifikationen</dt><dd className="ow-num">{r.referrals.qualified}</dd><dt>Korrigierte Empfehlungen</dt><dd className="ow-num">{r.referrals.reversed}</dd></dl>
          <p className="ow-hint">Ein bestätigter Beitritt ist noch keine Bonusqualifikation. Jede Zahl folgt dem Datum ihres eigenen Ereignisses; dieselbe Empfehlung kann hier mehrfach erscheinen. Daraus lässt sich kein zusätzlicher Umsatz ableiten.</p></section>
        <section className="ow-card ow-stack" aria-labelledby="an-trend"><div><h2 id="an-trend">Wochenabschnitte</h2><p className="ow-muted" style={{ fontSize: 14 }}>Je Abschnitt: neu angelegte Karten und bestätigte Kassenvorgänge. Der letzte Abschnitt kann kürzer als sieben Tage sein.</p></div>
          <div className="ow-trend">{r.series.map(bucket => <div className="ow-trend-row" key={bucket.from}><span className="ow-num">{date(bucket.from)}–{date(bucket.to)}</span>
            <div><div className="ow-bar"><span style={{ width: `${bucket.newCards / maxSeries * 100}%` }} /></div><small>{bucket.newCards} Karten</small></div>
            <div><div className="ow-bar ow-bar--alt"><span style={{ width: `${bucket.checkouts / maxSeries * 100}%` }} /></div><small>{bucket.checkouts} Kassenvorgänge</small></div></div>)}</div></section>
        <section className="ow-card ow-stack" aria-labelledby="an-camp"><h2 id="an-camp">Kampagnenversuche</h2>
          <dl className="ow-dl"><dt>Insgesamt</dt><dd className="ow-num">{r.campaignAttempts.total}</dd><dt>Vom lokalen Testkanal angenommen</dt><dd className="ow-num">{r.campaignAttempts.complete}</dd><dt>Unterdrückt</dt><dd className="ow-num">{r.campaignAttempts.suppressed}</dd><dt>Erneut geplant</dt><dd className="ow-num">{r.campaignAttempts.retry}</dd><dt>Fehlgeschlagen</dt><dd className="ow-num">{r.campaignAttempts.failed}</dd><dt>Blockiert</dt><dd className="ow-num">{r.campaignAttempts.blocked}</dd></dl>
          <p className="ow-hint">Dies zählt Versuche, nicht einzigartige Empfänger. Die Annahme durch Mailpit bestätigt weder die Zustellung in ein echtes Postfach noch eine Öffnung.</p></section>
        <Notice><div><strong>Zählregeln und Grenzen</strong><p style={{ marginTop: 4 }}>{r.countingRule}</p><p style={{ marginTop: 4 }}>Zeitzone: {r.timezone}. Verfügbare Zeiträume: {r.limits.availableWindowsDays.join(" und ")} Tage. Abschnitte: {r.limits.bucketDays} Tage. Die Prämienliste zeigt höchstens {r.limits.topRewardTitles} Titel. Diese Daten messen weder tatsächliche Besuche noch Umsatzsteigerungen oder zusätzliche Verkäufe.</p></div></Notice>
      </>}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return <div className="ow-metric"><h3 style={{ fontSize: 13, color: "var(--ow-ink-2)" }}>{label}</h3><strong className="ow-metric-value">{value}</strong><p className="ow-metric-note">{note}</p></div>;
}
