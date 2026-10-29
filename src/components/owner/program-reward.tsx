"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Gift, PenLine, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import type { PublicProgram } from "@/components/client-api";
import { rewardChangeLine } from "@/lib/change-lines";
import { CardLinePreview, NumberStepper } from "./owner-ui";
import { longDay, unitDative, unitName } from "./program-helpers";
import { Choices, FieldError, QuestionForm, useQuestion, useReview, type Choice } from "./question-form";

const REWARDS = "/api/merchant/program/rewards";
const TITLE_MAX = 180, COST_MAX = 100_000; // the server's limits for a reward's name and threshold
const SEES_TODAY = "Deine Kunden sehen die Änderung ab heute auf ihrer Karte.";
const SEES = "Deine Kunden sehen die Änderung auf ihrer Karte.";

type Reward = PublicProgram["rewards"][number];

/** What each save posts (S1a's strict schema). „Schlechter“ alone sends worse: true: anything else applies a name at once. */
export const rewardBody = {
  price: (programSlug: string, rewardId: string, cost: number) => ({ programSlug, action: "price", rewardId, cost }),
  rename: (programSlug: string, rewardId: string, title: string, choice: "better" | "worse") => ({ programSlug, action: "rename", rewardId, title, worse: choice === "worse" }),
  archive: (programSlug: string, rewardId: string) => ({ programSlug, action: "archive", rewardId }),
  takeBack: (programSlug: string, rewardId: string) => ({ programSlug, action: "takeBack", rewardId }),
};
type Step = "other" | "raise" | "name" | "rename" | "archive" | "takeback";

/** ENG-100: the date box of a change that waits four weeks, or of a take-back (undo icon). */
export const When = ({ title, undo, children }: { title: string; undo?: boolean; children: ReactNode }) => (
  <div className="ow-when" data-undo={undo || undefined}>
    {undo ? <RotateCcw size={22} aria-hidden="true" /> : <CalendarClock size={22} aria-hidden="true" />}
    <div><b>{title}</b><p>{children}</p></div>
  </div>
);

/**
 * A reward's own page (ENG-099 Wegweiser 03, ENG-100 26–30, 46–49, 57/58). A lower cost or a better name applies at once;
 * a higher cost, a worse name and an archive take effect four weeks on (the server dates them), shown with their date. While
 * one waits, the page shows it and offers only to take it back (one pending change per reward).
 */
export function RewardPage({ program, reward, slug }: { program: PublicProgram; reward: Reward; slug: string }) {
  const type = program.programType, points = type === "points", unit = (n: number) => unitName(type, n);
  const amount = (n: number) => `${n} ${n === 1 ? unit(1) : unitDative(type)}`; // „bei 10 Stempeln“, „bei 1 Stempel“
  const notice = program.noticeOn ?? "", day = longDay(notice);
  const step = useReview<Step>();
  const span = points ? 10 : 2;
  const options = [reward.cost - span, reward.cost, reward.cost + span].filter(n => n >= 1 && n <= COST_MAX);
  const [pick, setPick] = useState(String(reward.cost)), [custom, setCustom] = useState(String(reward.cost));
  const [title, setTitle] = useState(reward.title), [worse, setWorse] = useState("");
  const cost = pick === "other" ? Number(custom) || 0 : Number(pick), name = title.trim();
  const named = name !== reward.title, priced = cost !== reward.cost;
  const nameProblem = !name ? "Bitte die Prämie benennen." : name.length < 2 ? "Der Name braucht mindestens 2 Zeichen." : "";
  const costProblem = cost >= 1 && cost <= COST_MAX ? "" : "Bitte eine ganze Zahl größer 0 eingeben.";
  const q = useQuestion("program-reward", priced || named, step.step === "name" ? { "reward-name": nameProblem } : step.step === "other" ? { "reward-cost": costProblem } : {});
  const back = { label: reward.title, onClick: step.back };
  const preview = (line: string) => (
    <div className="ow-qpanel"><CardLinePreview label="So steht es auf der Karte" shop={program.businessName} brandColor={program.brandColor}>{line}</CardLinePreview></div>
  );
  const price = () => q.save(REWARDS, rewardBody.price(slug, reward.rewardId, cost), cost > reward.cost ? `Gespeichert. Gilt ab ${day}.` : undefined);
  const raiseHint = <p className="ow-hint" data-later>{points ? "Mehr Punkte" : "Mehr Stempel"} gelten erst nach vier Wochen, ab {day}.</p>;

  // 57: a change waits. Its heading and date box, the card line, and only the take-back.
  const waiting = reward.endsOn ? { endsOn: reward.endsOn } : reward.pending;
  if (waiting && step.step !== "takeback") {
    const ending = "endsOn" in waiting, on = longDay(ending ? waiting.endsOn : waiting.effectiveOn);
    const heading = ending ? `${reward.title} wird am ${on} archiviert` : waiting.cost !== reward.cost ? `${reward.title}: ${waiting.cost} statt ${reward.cost} ${unit(waiting.cost)}` : `„${waiting.title}“ statt „${reward.title}“`;
    const until = ending ? `Bis dahin können Kunden die Prämie noch einlösen. Sie sehen die Änderung auf ihrer Karte.`
      : waiting.title !== reward.title ? `Bis dahin bleibt es bei „${reward.title}“, auch an der Kasse. ${SEES}` : `Bis dahin bleibt es bei ${amount(reward.cost)}. ${SEES}`;
    return (
      <QuestionForm title={heading} busy={false} failed="" tone="secondary" action={ending ? "Archivieren zurücknehmen" : "Änderung zurücknehmen"} onSubmit={() => step.open("takeback")}>
        <When title={`Gespeichert, gilt ab ${on}`}>{until}</When>
        {preview(rewardChangeLine(type, reward, waiting))}
        <p className="ow-hint">Eine neue Änderung geht erst, wenn diese gilt oder du sie zurücknimmst.</p>
      </QuestionForm>
    );
  }
  // 58: taking it back applies at once.
  if (waiting && step.step === "takeback") {
    const kept = "endsOn" in waiting ? "Die Prämie bleibt" : waiting.title !== reward.title ? `Es bleibt bei „${reward.title}“` : `Es bleibt bei ${amount(reward.cost)}`;
    return (
      <QuestionForm title="Änderung zurücknehmen?" back={back} busy={q.busy} failed={q.failed} action="Zurücknehmen" cancel={step.back}
        onSubmit={() => q.save(REWARDS, rewardBody.takeBack(slug, reward.rewardId), "Änderung zurückgenommen")}>
        <When title={kept} undo>Die Änderung entfällt sofort, auch der Hinweis auf den Karten deiner Kunden.</When>
      </QuestionForm>
    );
  }

  // 28: a higher cost, confirmed with its date.
  if (step.step === "raise") return (
    <QuestionForm title={`${reward.title}: ${cost} statt ${reward.cost} ${unit(cost)}`} back={back} busy={q.busy} failed={q.failed} onSubmit={price}>
      <When title={`Gilt ab ${day}`}>Bis dahin bleibt es bei {amount(reward.cost)}. {SEES_TODAY}</When>
      {preview(rewardChangeLine(type, reward, { effectiveOn: notice, title: reward.title, cost }))}
    </QuestionForm>
  );
  // 30: the archive is dated too; the reward stays redeemable until then.
  if (step.step === "archive") return (
    <QuestionForm title={`${reward.title} archivieren?`} back={back} busy={q.busy} failed={q.failed} action="Archivieren" tone="danger" cancel={step.back}
      onSubmit={() => q.save(REWARDS, rewardBody.archive(slug, reward.rewardId), `${reward.title} wird am ${day} archiviert.`)}>
      <When title={`Gilt ab ${day}`}>Bis dahin können Kunden die Prämie noch einlösen. Sie sehen die Änderung ab heute auf ihrer Karte.</When>
      {preview(rewardChangeLine(type, reward, { endsOn: notice }))}
    </QuestionForm>
  );
  // 46: the new name.
  if (step.step === "name") return (
    <QuestionForm title="Wie heißt die Prämie?" back={back} busy={false} failed="" action="Weiter" onSubmit={() => { if (!named) q.leave(); else if (q.check()) step.open("rename"); }}>
      <div className="ow-field ow-qpanel">
        <label htmlFor="reward-name">Name der Prämie</label>
        <input id="reward-name" className="ow-input" value={title} maxLength={TITLE_MAX} autoComplete="off" onChange={event => setTitle(event.target.value)}
          aria-invalid={Boolean(q.error("reward-name"))} aria-describedby="reward-name-hint" />
        <FieldError id="reward-name-error">{q.error("reward-name")}</FieldError>
        <p className="ow-qcount"><span id="reward-name-hint">So steht es auf der Karte und an der Kasse. Was Kunden wissen müssen, gehört in den Namen, z.&nbsp;B. „Gratisgetränk 0,3&nbsp;l“.</span><span>{title.length}/{TITLE_MAX}</span></p>
      </div>
    </QuestionForm>
  );
  // 47/48: the owner says whether the new name is worse for customers; nothing is preselected.
  if (step.step === "rename") {
    const choices: Choice[] = [
      { value: "better", label: "Besser oder gleich", sub: "Gilt ab dem Speichern", icon: ThumbsUp },
      { value: "worse", label: "Schlechter", sub: `Gilt nach vier Wochen, ab ${day}`, icon: ThumbsDown },
    ];
    return (
      <QuestionForm title="Passt das so?" back={{ label: "Name ändern", onClick: step.back }} busy={q.busy} failed={q.failed} disabled={!worse}
        onSubmit={() => worse && q.save(REWARDS, rewardBody.rename(slug, reward.rewardId, name, worse as "better" | "worse"), worse === "worse" ? `Gespeichert. Gilt ab ${day}.` : undefined)}>
        <div className="ow-qpanel ow-qcmp"><p>Bisher</p><p>{reward.title}</p></div>
        <div className="ow-qpanel ow-qcmp" data-new><p>Neu</p><p>{name}</p></div>
        <Choices name="reward-worse" label="Was bedeutet die Änderung für deine Kunden?" lead="Schlechter heißt: Die Prämie wird kleiner oder eingeschränkt." options={choices} value={worse} onChange={setWorse} />
        {worse === "worse" && <>
          <When title={`Gilt ab ${day}`}>Bis dahin bleibt es bei „{reward.title}“, auch an der Kasse. {SEES_TODAY}</When>
          {preview(rewardChangeLine(type, reward, { effectiveOn: notice, title: name, cost: reward.cost }))}
        </>}
      </QuestionForm>
    );
  }
  // 04: any other number.
  if (step.step === "other") {
    const higher = !costProblem && cost > reward.cost;
    return (
      <QuestionForm title={`${reward.title}: ab wie vielen ${unitDative(type)}?`} back={back} busy={q.busy} failed={q.failed} action={higher ? "Weiter" : "Speichern"}
        onSubmit={() => { if (!q.check()) return; if (!priced) q.leave(); else if (higher) step.open("raise"); else void price(); }}>
        <div className="ow-qnumber" data-typed={points || undefined}>
          <label htmlFor="reward-cost" className="ow-sr">Einlösbar ab</label>
          <NumberStepper id="reward-cost" value={custom} onChange={value => setCustom(value && String(Math.min(Number(value), COST_MAX)))} min={1} max={COST_MAX} stepSize={points ? 10 : 1}
            unit={{ one: unit(1), many: unit(2) }} invalid={Boolean(q.error("reward-cost"))} describedBy="reward-cost-hint" />
          <FieldError id="reward-cost-error">{q.error("reward-cost")}</FieldError>
          <p id="reward-cost-hint" className="ow-hint">Einlösbar ab {costProblem ? "…" : amount(cost)}.</p>
        </div>
        {higher && raiseHint}
      </QuestionForm>
    );
  }

  // 03: the cost as a few choices; a lower one saves at once (26), a higher one leads to its date (27 → 28).
  const live = program.rewards.filter(item => !item.endsOn).length;
  const choices: Choice[] = [
    ...options.map(n => ({ value: String(n), label: `${n} ${unit(n)}`, sub: n < reward.cost ? "Schneller zur Prämie" : n > reward.cost ? "Länger sammeln" : "Wie bisher", icon: n < reward.cost ? ArrowDown : n > reward.cost ? ArrowUp : Gift })),
    { value: "other", label: "Andere Zahl", icon: PenLine },
  ];
  return (
    <QuestionForm title={`${reward.title}: ab wie vielen ${unitDative(type)}?`} busy={q.busy} failed={q.failed} action={pick !== "other" && cost > reward.cost ? "Weiter" : "Speichern"}
      onSubmit={() => { if (pick === "other") step.open("other"); else if (!priced) q.leave(); else if (cost > reward.cost) step.open("raise"); else void price(); }}>
      <Choices name="reward-cost" label={`Einlösbar ab wie vielen ${unitDative(type)}?`} options={choices} value={pick} saved={String(reward.cost)} onChange={setPick} />
      {pick !== "other" && cost < reward.cost && <p className="ow-hint">Gilt ab dem Speichern für alle Karten.</p>}
      {pick !== "other" && cost > reward.cost && raiseHint}
      {!priced && pick !== "other" && <div className="ow-row" style={{ justifyContent: "space-between" }}>
        <button type="button" className="ow-qlink" onClick={() => step.open("name")}>Name ändern</button>
        {/* One reward must stay that is not ending (LAST_ACTIVE_REWARD). */}
        {live > 1 && <button type="button" className="ow-qlink" data-danger onClick={() => step.open("archive")}>Prämie archivieren</button>}
      </div>}
    </QuestionForm>
  );
}
