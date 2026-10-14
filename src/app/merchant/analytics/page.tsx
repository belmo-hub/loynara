"use client";

import { useState } from "react";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, Notice, PageHead } from "@/components/owner/owner-ui";
import { ALL_LOCATIONS_NOTE, PeriodBar } from "@/components/owner/period-bar";
import { useLoad } from "@/components/owner/use-load";
import Link from "next/link";
import { CardBase } from "@/components/owner/retention-insights";
import type { AnalyticsWindowDays, MerchantAnalytics } from "@/lib/merchant-analytics";
import { retentionCustomerHref } from "@/lib/retention-links";
import type { RetentionDays, RetentionSummary } from "@/lib/retention";

const date = (value: string) => new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

export default function MerchantAnalyticsPage() {
  const { me, locations } = useOwner();
  const [windowDays, setWindowDays] = useState<AnalyticsWindowDays>(30);
  const [report, reload] = useLoad<MerchantAnalytics>(me?.role === "owner" ? `/api/merchant/analytics?window=${windowDays}` : null);
  const [lapseDays, setLapseDays] = useState<RetentionDays>(30);
  const [retention, reloadRetention] = useLoad<RetentionSummary>(me?.role === "owner" ? `/api/merchant/retention?days=${lapseDays}` : null);
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
            <Metric label="Wiederkehrende Karten" value={r.repeatCards} note={r.participatingCards > 0 ? `${Math.round(r.repeatCards / r.participatingCards * 100)} % der Karten mit Vorgang hatten im Zeitraum mehrere bestätigte Kassenvorgänge.` : "Karten mit mindestens zwei bestätigten Vorgängen im Zeitraum."} />
          </div>
        </section>
        <section className="ow-card ow-stack" aria-labelledby="an-locations">
          <div className="ow-card-head"><div><h2 id="an-locations">Aktivität je Standort</h2><p>Gutschrift-Buchungen im gewählten Zeitraum, nach dem bei der Buchung erfassten Standort. Auch Vorgänge aus archivierten Programmen zählen.</p></div></div>
          {r.locationActivity.length === 0 ? <p className="ow-muted">Keine Standorte vorhanden.</p> : <ul className="ow-feed">
            {r.locationActivity.map(row => <li key={row.locationId}><span><strong>{row.name}</strong><span className="ow-muted"> · {row.awardActions.toLocaleString("de-DE")} Gutschrift-Buchungen</span></span><span className="ow-num">{row.stampUnits.toLocaleString("de-DE")} Stempel · {row.pointUnits.toLocaleString("de-DE")} Punkte</span></li>)}
          </ul>}
          <p className="ow-hint">Aktuelle Standortnamen. Mehrere Buchungen können zu einem Kassenvorgang gehören. Keine Umsatzkennzahl.</p>
        </section>
        <section className="ow-card ow-stack" aria-labelledby="an-staff">
          <div className="ow-card-head"><div><h2 id="an-staff">Teamaktivität</h2><p>Bestätigte Gutschrift-Buchungen im gewählten Zeitraum, über alle Standorte dieses Betriebs. Vollständig korrigierte Buchungen zählen nicht. Frühere Teammitglieder bleiben in der Historie.</p></div></div>
          {r.staffActivity.length === 0 ? <p className="ow-muted">Keine Gutschrift-Buchungen in diesem Zeitraum.</p> : <ul className="ow-feed">
            {r.staffActivity.map(row => <li key={row.userId}><span><strong>{row.name}</strong><span className="ow-muted"> · {row.awardActions.toLocaleString("de-DE")} Gutschrift-Buchungen</span></span><span className="ow-num">{row.stampUnits.toLocaleString("de-DE")} Stempel · {row.pointUnits.toLocaleString("de-DE")} Punkte</span></li>)}
          </ul>}
          <p className="ow-hint">Mehrere Buchungen können zu einem Kassenvorgang gehören. Diese Zahlen belegen keinen Umsatz und keine Arbeitsleistung.</p>
        </section>
        <section className="ow-card ow-stack" aria-labelledby="an-ret">
          <div className="ow-card-head" style={{ marginBottom: 0 }}><div><h2 id="an-ret">Kundenbindung heute</h2><p>Stand jetzt, unabhängig vom Zeitraum oben. Welche Kassenvorgänge sind erfasst?</p></div>
            <div className="ow-field"><label htmlFor="an-lapse" className="ow-sr">Als weggeblieben gilt nach</label><select id="an-lapse" className="ow-select" value={lapseDays} onChange={event => setLapseDays(Number(event.target.value) as RetentionDays)}>{([14, 30, 60, 90] as const).map(days => <option key={days} value={days}>Weg nach {days} Tagen</option>)}</select></div></div>
          {retention.state === "error" && <ErrorNotice message={retention.message} onRetry={reloadRetention} />}
          {retention.state === "loading" && <LoadingBlock rows={1} height={64} />}
          {retention.state === "ok" && <>
            <CardBase summary={retention.data} />
            <div className="ow-metrics">
              <RetentionMetric label="Länger nicht da" value={retention.data.drifting} note={`Früher bestätigte Kassenvorgänge, seit ${retention.data.inactiveDays}+ Tagen keiner mehr. Vor einer Woche: ${retention.data.driftingWeekAgo}.`} href={retentionCustomerHref(retention.data, "drifting")} />
              <RetentionMetric label="Prämie jetzt einlösbar" value={retention.data.rewardReady} note="Ein Anlass, die Prämie beim nächsten Besuch anzubieten." href={retentionCustomerHref(retention.data, "reward_ready")} />
              <RetentionMetric label="Kurz vor der Prämie" value={retention.data.nearReward} note="Höchstens ein Viertel fehlt bis zur günstigsten Prämie, auf ganze Einheiten aufgerundet." href={retentionCustomerHref(retention.data, "near_reward")} />
              <RetentionMetric label="Noch nie an der Kasse" value={retention.data.never} note={`${retention.data.neverAfterWeek} davon seit über einer Woche angemeldet.`} href={retentionCustomerHref(retention.data, "never")} />
            </div>
          </>}
        </section>
        <div className="ow-two" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }} aria-label="Prämien und Gutschriften">
          <section className="ow-card ow-stack"><h2>Vergebene Einheiten</h2>
            <dl className="ow-dl">{(me.programType === "stamp" || r.issued.stampUnits > 0) && <><dt>Stempel</dt><dd className="ow-num">{r.issued.stampUnits}</dd></>}{(me.programType === "points" || r.issued.pointUnits > 0) && <><dt>Punkte</dt><dd className="ow-num">{r.issued.pointUnits}</dd></>}<dt>Buchungen</dt><dd className="ow-num">{r.issued.awardActions}</dd></dl></section>
          <section className="ow-card ow-stack"><h2>Einlösungen</h2><strong className="ow-metric-value">{r.rewards.redemptions}</strong>
            {r.rewards.topTitles.length ? <><h3 style={{ fontSize: 15 }}>Häufigste eingelöste Prämien</h3><ol className="ow-feed">{r.rewards.topTitles.map(item => <li key={item.title}><span>{item.title}</span><strong className="ow-num">{item.count}</strong></li>)}</ol></> : <p className="ow-muted">Im Zeitraum wurde keine Prämie eingelöst.</p>}</section>
        </div>
        {r.referrals.attributed + r.referrals.qualified + r.referrals.reversed > 0 && (
        <section className="ow-card ow-stack" aria-labelledby="an-ref"><h2 id="an-ref">Empfehlungen im Zeitraum</h2>
          <dl className="ow-dl"><dt>Über Empfehlungslink angemeldet</dt><dd className="ow-num">{r.referrals.attributed}</dd><dt>Erster Einkauf bestätigt, Bonus gebucht</dt><dd className="ow-num">{r.referrals.qualified}</dd><dt>Nach Korrektur zurückgenommen</dt><dd className="ow-num">{r.referrals.reversed}</dd></dl>
          <p className="ow-hint">Erst der bestätigte erste Einkauf macht aus einer Anmeldung eine gewonnene Kundin oder einen gewonnenen Kunden. <Link className="ow-link" href="/merchant/referrals">Empfehlungen ansehen</Link></p>
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
        <details className="ow-muted"><summary>So zählen wir</summary><p style={{ marginTop: 6, maxWidth: "80ch" }}>{r.countingRule} Die Zahlen zeigen bestätigte Kassenvorgänge, nicht alle Besuche, und sagen nichts über Umsatz.</p></details>
      </>}
    </div>
  );
}

function RetentionMetric({ label, value, note, href }: { label: string; value: number; note: string; href: string }) {
  return <div className="ow-metric"><h3 style={{ fontSize: 14, color: "var(--ow-ink-2)" }}>{label}</h3><strong className="ow-metric-value">{value}</strong><p className="ow-metric-note">{note}</p>{value > 0 && <Link className="ow-link ow-link--block" href={href}>Karten ansehen</Link>}</div>;
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return <div className="ow-metric"><h3 style={{ fontSize: 14, color: "var(--ow-ink-2)" }}>{label}</h3><strong className="ow-metric-value">{value}</strong><p className="ow-metric-note">{note}</p></div>;
}
