"use client";

import Link from "next/link";
import { useState } from "react";
import { BackToActions } from "@/components/owner/actions-list";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, MoreInfo, Notice, PageHead } from "@/components/owner/owner-ui";
import { ALL_LOCATIONS_NOTE } from "@/components/owner/period-bar";
import { useLoad } from "@/components/owner/use-load";
import type { MerchantAdvice } from "@/lib/adviser";
import { keepUnits } from "@/lib/german-date";

/** Beratung (Design, 6 Nov; Legal 7 Nov „half“): the period, then each hint as what to do, one button and one fold; the
 *  Verkäufe line stays visible under the advice, how the hints come about sits in the page's fold. */
export default function MerchantAdviserPage() {
  const { me, locations } = useOwner();
  const [windowDays, setWindowDays] = useState<30 | 90>(30);
  const [report, reload] = useLoad<MerchantAdvice>(me?.role === "owner" ? `/api/merchant/adviser?window=${windowDays}` : null);
  if (!me) return null;
  const head = <PageHead back={<BackToActions />} title="Beratung" lead={locations.length > 1 ? ALL_LOCATIONS_NOTE : undefined} />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice>Nur die Inhaberin oder der Inhaber kann diese Hinweise sehen.</Notice></div>;
  const r = report.state === "ok" ? report.data : null;
  return (
    <div className="ow-page">
      {head}
      <div className="ow-seg" role="group" aria-label="Zeitraum">
        {([30, 90] as const).map(days => <button key={days} type="button" aria-pressed={windowDays === days} onClick={() => setWindowDays(days)}>{days} Tage</button>)}
      </div>
      {report.state === "error" && <ErrorNotice message={report.message} onRetry={reload} />}
      {report.state === "loading" && <LoadingBlock rows={3} />}
      {r && <>
        <section className="ow-stack ow-stack--tight" aria-label="Hinweise">
          {r.recommendations.map(item => (
            <article className="ow-qpanel ow-advice" key={item.id}>
              <h2>{keepUnits(item.title)}</h2>
              <p>{item.nextAction}</p>
              {item.link && <Link className="ow-btn ow-btn--secondary ow-btn--sm" href={item.link.href}>{item.link.label}</Link>}
              <MoreInfo>{[item.reasoning, ...item.missingInformation].map(line => <p key={line}>{keepUnits(line)}</p>)}</MoreInfo>
            </article>
          ))}
        </section>
        <p className="ow-hint">Erfasste Aktivität beweist keine zusätzlichen Verkäufe.</p>
        <MoreInfo summary="So entstehen die Hinweise">
          <p>Die Hinweise folgen festen Regeln und beruhen nur auf deinen bestätigten Buchungen im gewählten Zeitraum.</p>
          <p>Die Beratung ändert nichts an deinem Programm, deinen Prämien oder deinen Kosten.</p>
        </MoreInfo>
      </>}
    </div>
  );
}
