"use client";

import Link from "next/link";
import { ErrorNotice, LoadingBlock, Notice } from "./owner-ui";
import { useLoad } from "./use-load";
import type { MerchantSpend, SpendFigures } from "@/lib/merchant-analytics";
import { formatMinor, SPEND_COPY as C } from "@/lib/spend-copy";

/** ENG-070: "Spent by your Loynara customers", last 30 local days and since start. Owner-only, like the API. */
export function SpendCard({ multiLocation }: { multiLocation: boolean }) {
  const [spend, reload] = useLoad<MerchantSpend>("/api/merchant/spend");
  const s = spend.state === "ok" ? spend.data : null;
  const money = (minor: number) => formatMinor(minor, s?.currency ?? "EUR");
  const unpriced = s ? s.overall.total.unpricedVisits > 0 : false;
  return (
    <section className="ow-card ow-stack" aria-labelledby="an-spend">
      <div className="ow-card-head" style={{ marginBottom: 0 }}><div><h2 id="an-spend">{C.title}</h2><p>{C.lead}</p></div></div>
      {spend.state === "error" && <ErrorNotice message={spend.message} onRetry={reload} />}
      {spend.state === "loading" && <LoadingBlock rows={1} height={64} />}
      {s && (s.overall.total.visits === 0 ? <p className="ow-muted">{C.empty}</p> : <>
        {/* auto: one column on a phone, so a five-digit total never overflows its tile */}
        <div className="ow-metrics ow-metrics--auto">
          <Figure label={C.recent} note={C.recentNote} figures={s.overall.recent} money={money} />
          <Figure label={C.total} figures={s.overall.total} money={money} />
        </div>
        {s.overall.recent.newCardMinor !== null && s.overall.recent.spentMinor > 0 && <p className="ow-hint">{C.recent}: {C.newAndReturning(money(s.overall.recent.newCardMinor), money(s.overall.recent.returningCardMinor ?? 0))}</p>}
        {multiLocation && <><h3 style={{ fontSize: "var(--text-16)" }}>{C.perLocation}</h3><ul className="ow-feed">
          {s.locations.map(row => <li key={row.locationId}><span><strong>{row.name}</strong><span className="ow-muted"> · {C.recent}: {C.visits(row.recent.visits)}</span></span><span className="ow-num">{value(row.recent, money)} · {C.total}: {value(row.total, money)}</span></li>)}
        </ul></>}
        {s.overall.total.estimatedMinor > 0 && <p className="ow-hint">{C.estimateNote}</p>}
        {unpriced && <Notice actions={<Link className="ow-link" href="/merchant/program">{C.missingAverageLink}</Link>}>{C.missingAverage}</Notice>}
      </>)}
      <details className="ow-muted"><summary>{C.howWeCountTitle}</summary><p style={{ marginTop: 6, maxWidth: "80ch" }}>{C.howWeCount}</p></details>
    </section>
  );
}

/** Money when any visit is priced, else the visit count alone (no average entered yet). */
function amount(f: SpendFigures, money: (minor: number) => string) {
  return f.averagePerVisitMinor === null ? C.visits(f.visits) : money(f.spentMinor);
}
const estimateMark = (f: SpendFigures) => f.estimatedMinor === 0 ? "" : f.realMinor === 0 ? C.estimated : C.partlyEstimated;
const value = (f: SpendFigures, money: (minor: number) => string) => `${amount(f, money)}${estimateMark(f) ? ` (${estimateMark(f)})` : ""}`;

function Figure({ label, note, figures, money }: { label: string; note?: string; figures: SpendFigures; money: (minor: number) => string }) {
  return <div className="ow-metric"><h3 style={{ fontSize: "var(--text-14)", color: "var(--color-ink-muted)" }}>{label}</h3><strong className="ow-metric-value">{amount(figures, money)}</strong>{estimateMark(figures) && <p className="ow-metric-note"><strong>{estimateMark(figures)}</strong></p>}
    {/* Without any priced visit the figure itself is the visit count, so the note does not repeat it. */}
    {(figures.averagePerVisitMinor !== null || note) && <p className="ow-metric-note">{[figures.averagePerVisitMinor !== null && `${C.visits(figures.visits)} · ${C.average(money(figures.averagePerVisitMinor))}`, note].filter(Boolean).join(". ")}</p>}</div>;
}
