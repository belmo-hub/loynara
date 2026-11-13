"use client";

import type { MeResponse, PublicProgram } from "@/components/client-api";
import { Notice, PageHead, Skeleton } from "./owner-ui";
import { confirmSentence, earningSentence, unitName } from "./program-helpers";
import { useLoad } from "./use-load";

/** Programm for managers, read only. Owners get the Programm list (program-list.tsx). */
export function ProgramView({ me }: { me: MeResponse }) {
  const [program, reloadProgram] = useLoad<PublicProgram>(`/api/program/${encodeURIComponent(me.programSlug)}`);
  const head = <PageHead title="Programm" />;
  if (program.state === "error") return <div className="ow-page ow-column">{head}<Notice tone="danger" role="alert" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={reloadProgram}>Erneut laden</button>}>{program.message}</Notice></div>;
  if (program.state !== "ok") return <div className="ow-page ow-column">{head}<Skeleton height={260} /><Skeleton height={200} /></div>;
  const data = program.data;
  return (
    <div className="ow-page ow-column">
      {head}
      <Notice>Nur die Inhaberin oder der Inhaber kann Regeln und Prämien ändern.</Notice>
      <section className="ow-card ow-stack"><h2>So sammeln Kunden</h2><p>{earningSentence(data.programType, data.earningMode ?? "manual", data.pointsPerCurrencyUnit ?? 1, data.currency)}</p><p className="ow-muted">{confirmSentence(data.programType, data.earningMode ?? "manual", !(me.hiddenSurfaces ?? []).includes("nfc"))}</p></section>
      <section className="ow-card ow-stack"><h2>Aktive Prämien</h2><ul className="ow-feed">{data.rewards.map(reward => <li key={reward.id}><strong>{reward.title}</strong><span className="ow-num">{reward.cost} {unitName(data.programType, reward.cost)}</span></li>)}</ul></section>
    </div>
  );
}
