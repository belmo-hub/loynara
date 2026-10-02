"use client";

import Link from "next/link";
import { useState } from "react";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, Notice, PageHead } from "@/components/owner/owner-ui";
import { ALL_LOCATIONS_NOTE, PeriodBar } from "@/components/owner/period-bar";
import { useLoad } from "@/components/owner/use-load";
import type { MerchantAdvice } from "@/lib/adviser";

const day = (value: string) => new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

export default function MerchantAdviserPage() {
  const { me, locations } = useOwner();
  const [windowDays, setWindowDays] = useState<30 | 90>(30);
  const [report, reload] = useLoad<MerchantAdvice>(me?.role === "owner" ? `/api/merchant/adviser?window=${windowDays}` : null);
  if (!me) return null;
  const head = <PageHead eyebrow="Ergebnisse" title="Beratung" lead="Prüfbare Hinweise aus den bestätigten Vorgängen deines Betriebs. Jede Änderung bleibt deine Entscheidung." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur Inhaber:innen können diese Hinweise sehen.</Notice></div>;
  const r = report.state === "ok" ? report.data : null;
  return (
    <div className="ow-page">
      {head}
      {locations.length > 1 && <Notice>{ALL_LOCATIONS_NOTE}</Notice>}
      <PeriodBar id="adviser-window" value={windowDays} onChange={setWindowDays} meta={r ? `${day(r.from)} bis ${day(r.asOf)}` : undefined} />
      {report.state === "error" && <ErrorNotice message={report.message} onRetry={reload} />}
      {report.state === "loading" && <LoadingBlock rows={3} />}
      {r && <>
        <div className="ow-notice ow-notice--ok"><span><strong>Nach festen Regeln</strong></span><span>Diese Hinweise folgen festen, sichtbaren Regeln und beruhen nur auf deinen bestätigten Vorgängen.</span></div>
        <dl className="ow-metrics" aria-label="Beobachtete Kennzahlen">
          <Metric label="Aktive Karten" value={r.metrics.currentActiveCards} /><Metric label="Bestätigte Kassenvorgänge" value={r.metrics.qualifyingCheckouts} /><Metric label="Wiederkehrende Karten" value={r.metrics.repeatCards} /><Metric label="Einlösungen" value={r.metrics.redemptions} />
        </dl>
        <section aria-labelledby="advice-heading" className="ow-stack"><h2 id="advice-heading" style={{ fontSize: 17 }}>Prüfpunkte</h2>
          {r.recommendations.map(item => (
            <article className="ow-card ow-stack" key={item.id}>
              <h3 style={{ fontSize: 17 }}>{item.title}</h3>
              <dl className="ow-dl">{item.observed.map(observation => [<dt key={`${observation.label}-t`}>{observation.label}</dt>, <dd key={`${observation.label}-d`}>{observation.value}</dd>])}</dl>
              <div><h4 className="ow-label">Warum dieser Hinweis?</h4><p>{item.reasoning}</p></div>
              <div><h4 className="ow-label">Was fehlt?</h4><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{item.missingInformation.map(value => <li key={value}>{value}</li>)}</ul></div>
              <div className="ow-readonly"><h4 className="ow-label">Nächster Schritt zur Prüfung</h4><p>{item.nextAction}</p></div>
            </article>
          ))}
        </section>
        <Notice><div><strong>Datengrenzen</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{r.limitations.map(value => <li key={value}>{value}</li>)}</ul><p style={{ marginTop: 6 }}><Link className="ow-link" href="/merchant/analytics">Zählregeln in der Auswertung ansehen</Link> · <Link className="ow-link" href="/merchant/program">Programm manuell öffnen</Link></p></div></Notice>
      </>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="ow-metric"><dt>{label}</dt><dd><span className="ow-metric-value">{value}</span></dd></div>;
}
