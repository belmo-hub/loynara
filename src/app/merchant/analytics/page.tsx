"use client";

import { useState } from "react";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, Notice, PageHead } from "@/components/owner/owner-ui";
import { ALL_LOCATIONS_NOTE, PeriodBar } from "@/components/owner/period-bar";
import { useLoad } from "@/components/owner/use-load";
import type { AnalyticsWindowDays, MerchantAnalytics } from "@/lib/merchant-analytics";

const date = (value: string) => new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

export default function MerchantAnalyticsPage() {
  const { me, locations } = useOwner();
  const [windowDays, setWindowDays] = useState<AnalyticsWindowDays>(30);
  const [report, reload] = useLoad<MerchantAnalytics>(me?.role === "owner" ? `/api/merchant/analytics?window=${windowDays}` : null);
  if (!me) return null;
  const head = <PageHead eyebrow="Ergebnisse" title="Auswertung" lead="Neue Karten, bestätigte Kassenvorgänge und Prämien im gewählten Zeitraum." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur Inhaber:innen können die Auswertung sehen.</Notice></div>;
  const r = report.state === "ok" ? report.data : null;
  const maxSeries = Math.max(1, ...(r?.series.map(bucket => Math.max(bucket.newCards, bucket.checkouts)) ?? []));
  return (
    <div className="ow-page">
      {head}
      {locations.length > 1 && <Notice>{ALL_LOCATIONS_NOTE}</Notice>}
      <PeriodBar id="analytics-window" value={windowDays} onChange={setWindowDays} meta={r ? `${date(r.from)} bis ${date(r.asOf)}` : undefined} />
      {report.state === "error" && <ErrorNotice message={report.message} onRetry={reload} />}
      {report.state === "loading" && <LoadingBlock rows={3} />}
      {r && <>
        <section aria-labelledby="an-overview" className="ow-stack"><h2 id="an-overview" style={{ fontSize: 17 }}>Karten und Kassenvorgänge</h2>
          <div className="ow-metrics">
            <Metric label="Aktive Karten aktuell" value={r.currentActiveCards} note="Aktuell nicht geschlossene Karten." />
            <Metric label="Neue Karten" value={r.newCards} note="Im Zeitraum angemeldet." />
            <Metric label="Bestätigte Kassenvorgänge" value={r.qualifyingCheckouts} note="Vom Team bestätigte Vergaben, ohne vollständig rückgängig gemachte." />
            <Metric label="Wiederkehrende Karten" value={r.repeatCards} note="Karten mit mindestens zwei bestätigten Vorgängen im Zeitraum." />
          </div>
        </section>
        <div className="ow-two" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }} aria-label="Prämien und Gutschriften">
          <section className="ow-card ow-stack"><h2>Vergebene Einheiten</h2>
            <dl className="ow-dl">{(me.programType === "stamp" || r.issued.stampUnits > 0) && <><dt>Stempel</dt><dd className="ow-num">{r.issued.stampUnits}</dd></>}{(me.programType === "points" || r.issued.pointUnits > 0) && <><dt>Punkte</dt><dd className="ow-num">{r.issued.pointUnits}</dd></>}<dt>Buchungen</dt><dd className="ow-num">{r.issued.awardActions}</dd></dl></section>
          <section className="ow-card ow-stack"><h2>Einlösungen</h2><strong className="ow-metric-value">{r.rewards.redemptions}</strong>
            {r.rewards.topTitles.length ? <><h3 style={{ fontSize: 15 }}>Häufigste eingelöste Prämien</h3><ol className="ow-feed">{r.rewards.topTitles.map(item => <li key={item.title}><span>{item.title}</span><strong className="ow-num">{item.count}</strong></li>)}</ol></> : <p className="ow-muted">Im Zeitraum wurde keine Prämie eingelöst.</p>}</section>
        </div>
        {r.referrals.attributed + r.referrals.qualified + r.referrals.reversed > 0 && (
        <section className="ow-card ow-stack" aria-labelledby="an-ref"><h2 id="an-ref">Empfehlungsereignisse</h2>
          <dl className="ow-dl"><dt>Zugeordnete Beitritte</dt><dd className="ow-num">{r.referrals.attributed}</dd><dt>Bonusqualifikationen</dt><dd className="ow-num">{r.referrals.qualified}</dd><dt>Korrigierte Empfehlungen</dt><dd className="ow-num">{r.referrals.reversed}</dd></dl>
</section>
        )}
        {r.series.some(bucket => bucket.newCards + bucket.checkouts > 0) && (
        <section className="ow-card ow-stack" aria-labelledby="an-trend"><div><h2 id="an-trend">Verlauf</h2><p className="ow-muted" style={{ fontSize: 14 }}>Neue Karten und bestätigte Kassenvorgänge je Woche.</p></div>
          <div className="ow-trend">{r.series.map(bucket => <div className="ow-trend-row" key={bucket.from}><span className="ow-num">{date(bucket.from)}–{date(bucket.to)}</span>
            <div><div className="ow-bar"><span style={{ width: `${bucket.newCards / maxSeries * 100}%` }} /></div><small>{bucket.newCards} {bucket.newCards === 1 ? "Karte" : "Karten"}</small></div>
            <div><div className="ow-bar ow-bar--alt"><span style={{ width: `${bucket.checkouts / maxSeries * 100}%` }} /></div><small>{bucket.checkouts} {bucket.checkouts === 1 ? "Kassenvorgang" : "Kassenvorgänge"}</small></div></div>)}</div></section>
        )}
        {r.campaignAttempts.total > 0 && (
        <section className="ow-card ow-stack" aria-labelledby="an-camp"><h2 id="an-camp">Kampagnenversuche</h2>
          <dl className="ow-dl"><dt>Insgesamt</dt><dd className="ow-num">{r.campaignAttempts.total}</dd><dt>Angenommen</dt><dd className="ow-num">{r.campaignAttempts.complete}</dd><dt>Unterdrückt</dt><dd className="ow-num">{r.campaignAttempts.suppressed}</dd><dt>Erneut geplant</dt><dd className="ow-num">{r.campaignAttempts.retry}</dd><dt>Fehlgeschlagen</dt><dd className="ow-num">{r.campaignAttempts.failed}</dd><dt>Blockiert</dt><dd className="ow-num">{r.campaignAttempts.blocked}</dd></dl>
          <p className="ow-hint">Dies zählt Versuche, nicht einzigartige Empfänger. Die Annahme bestätigt weder die Zustellung in ein echtes Postfach noch eine Öffnung.</p></section>
        )}
        <details className="ow-muted" style={{ fontSize: 13 }}><summary style={{ cursor: "pointer", minHeight: 24 }}>So zählen wir</summary><p style={{ marginTop: 6, maxWidth: "80ch" }}>{r.countingRule} Die Zahlen zeigen bestätigte Kassenvorgänge, nicht alle Besuche, und sagen nichts über Umsatz.</p></details>
      </>}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return <div className="ow-metric"><h3 style={{ fontSize: 13, color: "var(--ow-ink-2)" }}>{label}</h3><strong className="ow-metric-value">{value}</strong><p className="ow-metric-note">{note}</p></div>;
}
