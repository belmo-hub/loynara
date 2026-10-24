"use client";

import { GuardedLink } from "./owner-shell";
import type { MeResponse, PublicProgram } from "@/components/client-api";
import { useOwner } from "./owner-context";
import { Notice, Skeleton } from "./owner-ui";
import { confirmSentence, earningSentence, unitName } from "./program-helpers";
import { RewardsCard } from "./program-rewards";
import { RuleCard } from "./program-rules";
import { HappyHourCard } from "./happy-hour-card";
import { ProgramWinbackCard } from "./winback-card";
import { ProgramExtrasCard } from "./program-extras";
import { TapPolicyCard } from "./tap-policy";
import { useLoad } from "./use-load";

export function ProgramView({ me }: { me: MeResponse }) {
  const owner = useOwner();
  const [program, reloadProgram] = useLoad<PublicProgram>(`/api/program/${encodeURIComponent(me.programSlug)}`);
  const isOwner = me.role === "owner";
  const head = <header className="ow-pagehead"><div><p className="ow-eyebrow">Treueprogramm</p><h1>Sammelregeln &amp; Prämien</h1><p>Wie Kunden sammeln, was sie bekommen und wer es bestätigt.</p></div>{isOwner && <GuardedLink className="ow-btn ow-btn--secondary" href="/merchant/program/card">Kundenkarte gestalten</GuardedLink>}</header>;
  if (program.state === "error") return <div className="ow-page">{head}<Notice tone="danger" role="alert" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={reloadProgram}>Erneut laden</button>}>{program.message}</Notice></div>;
  if (program.state !== "ok") return <div className="ow-page">{head}<Skeleton height={260} /><Skeleton height={200} /></div>;
  const data = program.data;
  return (
    <div className="ow-page">
      {head}
      {isOwner ? (
        <>
          <RuleCard me={me} program={data} onSaved={reloadProgram} />
          <RewardsCard me={me} program={data} onChanged={() => { reloadProgram(); }} />
          <ProgramExtrasCard me={owner.me ?? me} />
          <HappyHourCard me={owner.me ?? me} earningMode={data.earningMode} />
          <ProgramWinbackCard slug={me.programSlug} />
          {!owner.hiddenSurfaces.includes("nfc") && <TapPolicyCard me={owner.me ?? me} />}
        </>
      ) : (
        <>
          <Notice>Nur Inhaber:innen können Regeln und Prämien ändern.</Notice>
          <section className="ow-card ow-stack"><h2>So sammeln Kunden</h2><p>{earningSentence(data.programType, data.earningMode ?? "manual", data.pointsPerCurrencyUnit ?? 1, data.currency)}</p><p className="ow-muted">{confirmSentence(data.programType, data.earningMode ?? "manual")}</p></section>
          <section className="ow-card ow-stack"><h2>Aktive Prämien</h2><ul className="ow-feed">{data.rewards.map(reward => <li key={reward.id}><span><strong>{reward.title}</strong>{reward.termsText && <span className="ow-muted"> · {reward.termsText}</span>}</span><span className="ow-num">{reward.cost} {unitName(data.programType)}</span></li>)}</ul></section>
        </>
      )}
    </div>
  );
}
