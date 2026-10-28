"use client";

import { ChevronLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { PublicProgram } from "@/components/client-api";
import { HappyHourCard } from "./happy-hour-card";
import { useOwner } from "./owner-context";
import { GuardedLink } from "./owner-shell";
import { ErrorNotice, LoadingBlock, Notice, Skeleton } from "./owner-ui";
import { ProgramExtrasCard } from "./program-extras";
import { QUESTIONS, type Question } from "./program-helpers";
import { markSaved } from "./program-list";
import { RewardsCard } from "./program-rewards";
import { RuleCard } from "./program-rules";
import { TapPolicyCard } from "./tap-policy";
import { useLoad } from "./use-load";
import { ProgramWinbackCard } from "./winback-card";

const OWNER_ONLY = "Nur Inhaber:innen können Regeln und Prämien ändern.";

/** A Programm row's own page: back to the list, the row's name, then (until its question screen lands) today's editor. */
function Frame({ title, quiet, children }: { title?: string; /** The editor shows the same name as its own heading. */ quiet?: boolean; children: ReactNode }) {
  return (
    <div className="ow-page">
      <header className="ow-pagehead"><div>
        <GuardedLink href="/merchant/program" className="ow-back"><ChevronLeft size={20} aria-hidden="true" />Programm</GuardedLink>
        {title ? <h1 className={quiet ? "ow-sr" : undefined}>{title}</h1> : <Skeleton height={34} width={200} />}
      </div></header>
      {children}
    </div>
  );
}

/** After a save: fresh account values, then back on the list with this row outlined (Design rule 10). */
function useBackToList() {
  const owner = useOwner(), router = useRouter(), path = usePathname();
  return () => void owner.refresh().then(() => { markSaved(path); router.push("/merchant/program", { scroll: false }); });
}

export function ProgramQuestion({ question }: { question: Question }) {
  const { me } = useOwner();
  const done = useBackToList();
  const [program, reload] = useLoad<PublicProgram>(me && question === "rule" ? `/api/program/${encodeURIComponent(me.programSlug)}` : null);
  if (!me) return null;
  const title = QUESTIONS[question];
  if (me.role !== "owner") return <Frame title={title}><Notice tone="warn">{OWNER_ONLY}</Notice></Frame>;
  if (question === "rule") return <Frame title={title}>{program.state === "ok" ? <RuleCard me={me} program={program.data} onSaved={done} /> : program.state === "error" ? <ErrorNotice message={program.message} onRetry={reload} /> : <LoadingBlock />}</Frame>;
  if (question === "winback") return <Frame title={title}><ProgramWinbackCard slug={me.programSlug} /></Frame>;
  if (question === "happy-hour") return <Frame title={title} quiet><HappyHourCard me={me} earningMode={me.earningMode} onSaved={done} /></Frame>;
  // NFC stays on its page after saving: „Mit Bestätigung“ goes on to activating a plate there.
  if (question === "nfc") return <Frame title={title} quiet><TapPolicyCard me={me} /></Frame>;
  return <Frame title={title}><ProgramExtrasCard me={me} only={question} onSaved={done} /></Frame>;
}

/** A reward row's page, or „Prämie hinzufügen“ (reward "new"): today's rewards card with that form open. */
export function RewardQuestion({ reward }: { reward: string }) {
  const { me } = useOwner();
  const done = useBackToList();
  const [program, reload] = useLoad<PublicProgram>(me ? `/api/program/${encodeURIComponent(me.programSlug)}` : null);
  if (!me) return null;
  if (me.role !== "owner") return <Frame title="Prämien"><Notice tone="warn">{OWNER_ONLY}</Notice></Frame>;
  if (program.state === "error") return <Frame title="Prämien"><ErrorNotice message={program.message} onRetry={reload} /></Frame>;
  if (program.state !== "ok") return <Frame><LoadingBlock /></Frame>;
  const title = reward === "new" ? "Prämie hinzufügen" : program.data.rewards.find(item => item.rewardId === reward)?.title ?? "Prämien";
  return <Frame title={title}><RewardsCard me={me} program={program.data} onChanged={reload} open={reward} onSaved={done} /></Frame>;
}
