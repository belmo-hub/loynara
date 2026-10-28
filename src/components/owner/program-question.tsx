"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import type { PublicProgram } from "@/components/client-api";
import { HappyHourCard } from "./happy-hour-card";
import { useOwner } from "./owner-context";
import { GuardedLink } from "./owner-shell";
import { ErrorNotice, LoadingBlock, Notice, Skeleton } from "./owner-ui";
import { ExtrasQuestion } from "./program-extras";
import { EXTRA_RULES, QUESTIONS, type Question } from "./program-helpers";
import { NewReward } from "./program-new-reward";
import { RewardsCard } from "./program-rewards";
import { EarningQuestion, RuleQuestion } from "./program-rules";
import { useBackToList } from "./question-form";
import { TapPolicyCard } from "./tap-policy";
import { useLoad } from "./use-load";
import { WinbackQuestion, type Winback } from "./winback-card";

const OWNER_ONLY = "Nur Inhaber:innen können Regeln und Prämien ändern.";
// Questions that need the programme read: rewards, the shop's colour, the currency or the stored rule.
const READS_PROGRAM = new Set<Question>(["rule", "earning", "winback", "challenge", "news", "average-spend"]);

/** A Programm row's own page for a setting without a question screen: back to the list, the row's name, its editor. */
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

export function ProgramQuestion({ question }: { question: Question }) {
  const { me, hiddenSurfaces } = useOwner();
  const done = useBackToList(), router = useRouter();
  const slug = me ? encodeURIComponent(me.programSlug) : "";
  const [program, reload] = useLoad<PublicProgram>(me && READS_PROGRAM.has(question) ? `/api/program/${slug}` : null);
  const [winback, reloadWinback] = useLoad<Winback>(me && question === "winback" ? `/api/merchant/program/winback?programSlug=${slug}` : null);
  // A row the list does not show this shop (an old link) leads back to the list.
  const offered = !me || (["earning", "points-expiry", "happy-hour"].includes(question) ? me.programType === "points" : question !== "average-spend" || me.programType === "stamp" || me.earningMode === "manual");
  useEffect(() => { if (!offered) router.replace("/merchant/program"); }, [offered, router]);
  if (!me || !offered) return null;
  const title = question === "rule" && me.programType === "points" && me.earningMode === "purchase" ? EXTRA_RULES : QUESTIONS[question];
  if (me.role !== "owner") return <Frame title={title}><Notice tone="warn">{OWNER_ONLY}</Notice></Frame>;
  if (question === "happy-hour") return <Frame title={title} quiet><HappyHourCard me={me} earningMode={me.earningMode} onSaved={done} /></Frame>;
  // NFC stays on its page after saving: „Mit Bestätigung“ goes on to activating a plate there.
  if (question === "nfc") return <Frame title={title} quiet><TapPolicyCard me={me} /></Frame>;
  const failed = program.state === "error" ? program : winback.state === "error" ? winback : null;
  if (failed) return <Frame title={title}><ErrorNotice message={failed.message} onRetry={() => { reload(); reloadWinback(); }} /></Frame>;
  // The heading waits too: the question replaces the row's name, so it would jump once loaded.
  if (program.state === "loading" || winback.state === "loading") return <Frame><LoadingBlock /></Frame>;
  const data = program.state === "ok" ? program.data : null;
  if (question === "rule") return data && <RuleQuestion me={me} program={data} />;
  if (question === "earning") return data && <EarningQuestion me={me} program={data} nfc={!hiddenSurfaces.includes("nfc")} />;
  if (question === "winback") return data && winback.state === "ok" && <WinbackQuestion me={me} program={data} initial={winback.data} reminders={!hiddenSurfaces.includes("walletMessages")} />;
  return <ExtrasQuestion me={me} question={question} program={data} />;
}

/** A reward row's page (today's rewards card with that reward's form open), or „Prämie hinzufügen“ (reward "new"): three steps. */
export function RewardQuestion({ reward }: { reward: string }) {
  const { me } = useOwner();
  const done = useBackToList();
  const [program, reload] = useLoad<PublicProgram>(me ? `/api/program/${encodeURIComponent(me.programSlug)}` : null);
  if (!me) return null;
  if (me.role !== "owner") return <Frame title="Prämien"><Notice tone="warn">{OWNER_ONLY}</Notice></Frame>;
  if (program.state === "error") return <Frame title="Prämien"><ErrorNotice message={program.message} onRetry={reload} /></Frame>;
  if (program.state !== "ok") return <Frame><LoadingBlock /></Frame>;
  if (reward === "new") return <NewReward slug={me.programSlug} program={program.data} onSaved={rewardId => done(`/merchant/program/rewards/${rewardId}`)} />;
  const title = program.data.rewards.find(item => item.rewardId === reward)?.title ?? "Prämien";
  return <Frame title={title}><RewardsCard me={me} program={program.data} onChanged={reload} open={reward} onSaved={() => done()} /></Frame>;
}
