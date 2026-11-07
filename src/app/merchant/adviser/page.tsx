"use client";

import Link from "next/link";
import { useState } from "react";
import { BackToActions } from "@/components/owner/actions-list";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, Notice, PageHead } from "@/components/owner/owner-ui";
import { ALL_LOCATIONS_NOTE, PeriodBar } from "@/components/owner/period-bar";
import { useLoad } from "@/components/owner/use-load";
import type { MerchantAdvice } from "@/lib/adviser";
import { germanDate } from "@/lib/german-date";


export default function MerchantAdviserPage() {
  const { me, locations } = useOwner();
  const [windowDays, setWindowDays] = useState<30 | 90>(30);
  const [report, reload] = useLoad<MerchantAdvice>(me?.role === "owner" ? `/api/merchant/adviser?window=${windowDays}` : null);
  if (!me) return null;
  const head = <PageHead back={<BackToActions />} title="Beratung" lead="Hinweise aus deinen bestätigten Buchungen. Was du änderst, entscheidest du." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur die Inhaberin oder der Inhaber kann diese Hinweise sehen.</Notice></div>;
  const r = report.state === "ok" ? report.data : null;
  return (
    <div className="ow-page">
      {head}
      {locations.length > 1 && <Notice>{ALL_LOCATIONS_NOTE}</Notice>}
      <PeriodBar id="adviser-window" value={windowDays} onChange={setWindowDays} meta={r ? `${germanDate(r.from)} bis ${germanDate(r.asOf)}` : undefined} />
      {report.state === "error" && <ErrorNotice message={report.message} onRetry={reload} />}
      {report.state === "loading" && <LoadingBlock rows={3} />}
      {r && <>
        <Notice><div><strong>Nach festen Regeln</strong><p>Die Hinweise folgen festen Regeln und beruhen nur auf deinen bestätigten Buchungen.</p></div></Notice>
        <dl className="ow-metrics" aria-label="Beobachtete Kennzahlen">
          <Metric label="Aktive Karten" value={r.metrics.currentActiveCards} /><Metric label="Bestätigte Buchungen" value={r.metrics.qualifyingCheckouts} /><Metric label="Wiederkehrende Karten" value={r.metrics.repeatCards} /><Metric label="Einlösungen" value={r.metrics.redemptions} />
        </dl>
        <section aria-labelledby="advice-heading" className="ow-stack ow-stack--tight"><h2 id="advice-heading" className="ow-section-head">Prüfpunkte</h2>
          {r.recommendations.map(item => (
            <article className="ow-card ow-stack" key={item.id}>
              <h3>{item.title}</h3>
              <dl className="ow-dl">{item.observed.map(observation => [<dt key={`${observation.label}-t`}>{observation.label}</dt>, <dd key={`${observation.label}-d`}>{observation.value}</dd>])}</dl>
              <div><h4 className="ow-label">Warum dieser Hinweis?</h4><p>{item.reasoning}</p></div>
              <div><h4 className="ow-label">Was fehlt?</h4><ul>{item.missingInformation.map(value => <li key={value}>{value}</li>)}</ul></div>
              <div className="ow-readonly"><h4 className="ow-label">Nächster Schritt zur Prüfung</h4><p>{item.nextAction}</p>{item.link && <p><Link className="ow-btn ow-btn--secondary ow-btn--sm" href={item.link.href}>{item.link.label}</Link></p>}</div>
            </article>
          ))}
        </section>
        <Notice><div><strong>Datengrenzen</strong><ul>{r.limitations.map(value => <li key={value}>{value}</li>)}</ul><p><Link className="ow-link" href="/merchant/analytics">Zählregeln in den Ergebnissen ansehen</Link> · <Link className="ow-link" href="/merchant/program">Programm manuell öffnen</Link></p></div></Notice>
      </>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="ow-metric"><dt>{label}</dt><dd><span className="ow-metric-value">{value}</span></dd></div>;
}
