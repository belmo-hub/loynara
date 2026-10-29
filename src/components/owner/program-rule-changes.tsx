"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { PublicProgram } from "@/components/client-api";
import { cardDay, expiryChangeLine, ruleChangeLine, type ChangeLine } from "@/lib/change-lines";
import { CardLinePreview, Notice } from "./owner-ui";
import { When } from "./program-reward";
import { longDay } from "./program-helpers";
import { Choices, QuestionForm, useQuestion, useReview } from "./question-form";

const UPDATE = "/api/merchant/program/update";
export const SEES_TODAY = "Deine Kunden sehen die Änderung ab heute auf ihrer Karte.";
const SEES = "Deine Kunden sehen die Änderung auf ihrer Karte.";
export const datedToast = (iso: string) => `Gespeichert. Gilt ab ${longDay(iso)}.`;

type Rule = NonNullable<PublicProgram["pending"]>["old"];
/** Which item a waiting rule change belongs to: the earning mode, the rate, or the text (the rule or Weitere Regeln). */
export const ruleItem = (before: Rule, after: Rule) => before.earningMode !== after.earningMode ? "mode" : before.pointsPerCurrencyUnit !== after.pointsPerCurrencyUnit ? "rate" : "text";
const perEuro = (n: number) => `${n} ${n === 1 ? "Punkt" : "Punkten"} pro €`;
const modeName = (mode: string) => mode === "purchase" ? "Nach Einkaufswert" : "Manuell";

/** The list chips while a rule or expiry change waits (Design gaps §1, W45, W59). */
export function ruleChips(program: PublicProgram) {
  const pending = program.pending, expiry = program.pendingExpiry, item = pending && ruleItem(pending.old, pending);
  return {
    earning: pending && item === "mode" ? `Ab ${cardDay(pending.effectiveOn)}: ${modeName(pending.earningMode)}`
      : pending && item === "rate" ? `Ab ${cardDay(pending.effectiveOn)}: ${pending.pointsPerCurrencyUnit} ${pending.pointsPerCurrencyUnit === 1 ? "Punkt" : "Punkte"} pro €` : undefined,
    rule: pending && item === "text" ? `Ab ${cardDay(pending.effectiveOn)}: neue Regel` : undefined,
    expiry: expiry ? `Ab ${cardDay(expiry.effectiveOn)}: nach ${expiry.months} Monaten` : undefined,
  };
}

/** „So steht es auf der Karte“ with a change's line; a long new rule ends in „Neue Regel lesen“ as on the card. */
export const LinePreview = ({ program, line }: { program: PublicProgram; line: ChangeLine | string }) => {
  const { text, link } = typeof line === "string" ? { text: line, link: false } : line;
  return <div className="ow-qpanel"><CardLinePreview label="So steht es auf der Karte" shop={program.businessName} brandColor={program.brandColor}>{text}{link && <> <span className="ow-cardline-link">Neue Regel lesen</span></>}</CardLinePreview></div>;
};

/** W46: whether a change is worse for customers, with nothing preselected; „Schlechter“ shows its date and card line. */
export function WorseChoice({ value, onChange, lead, notice, until, line, program }: { value: string; onChange: (value: string) => void; lead?: string; notice: string; until: string; line: ChangeLine; program: PublicProgram }) {
  return <>
    <Choices name="rule-worse" label="Was bedeutet die Änderung für deine Kunden?" lead={lead} value={value} onChange={onChange} options={[
      { value: "better", label: "Besser oder gleich", sub: "Gilt ab dem Speichern", icon: ThumbsUp },
      { value: "worse", label: "Schlechter", sub: `Gilt nach vier Wochen, ab ${longDay(notice)}`, icon: ThumbsDown },
    ]} />
    {value === "worse" && <>
      <When title={`Gilt ab ${longDay(notice)}`}>{until} {SEES_TODAY}</When>
      <LinePreview program={program} line={line} />
    </>}
  </>;
}

/**
 * 57/58 for the rule and its earning (one waiting change at a time): what waits, with its date and card line, and only the
 * take-back, which applies at once.
 */
export function RuleWaiting({ slug, program, pending, label }: { slug: string; program: PublicProgram; pending: NonNullable<PublicProgram["pending"]>; /** The page's own name, for 58's back link. */ label: string }) {
  const step = useReview<"takeback">();
  const q = useQuestion("rule-takeback", false);
  const item = ruleItem(pending.old, pending), on = longDay(pending.effectiveOn), old = pending.old;
  if (step.step === "takeback") {
    const kept = item === "mode" ? (old.earningMode === "purchase" ? "Punkte gibt es weiter nach Einkaufswert" : "Punkte vergibst du weiter manuell")
      : item === "rate" ? `Es bleibt bei ${perEuro(old.pointsPerCurrencyUnit)}` : old.rulesText.trim() ? "Es bleibt bei der bisherigen Regel" : "Es bleibt ohne weitere Regeln";
    return (
      <QuestionForm title="Änderung zurücknehmen?" back={{ label, onClick: step.back }} busy={q.busy} failed={q.failed} action="Zurücknehmen" cancel={step.back}
        onSubmit={() => q.save(UPDATE, { programSlug: slug, takeBack: true }, "Änderung zurückgenommen")}>
        <When title={kept} undo>Die Änderung entfällt sofort, auch der Hinweis auf den Karten deiner Kunden.</When>
      </QuestionForm>
    );
  }
  const heading = item === "mode" ? `${modeName(pending.earningMode)} statt ${modeName(old.earningMode).toLowerCase()}`
    : item === "rate" ? `Punkte pro €: ${pending.pointsPerCurrencyUnit} statt ${old.pointsPerCurrencyUnit}` : `Neue Regel ab ${on}`;
  const until = item === "rate" ? `Bis dahin bleibt es bei ${perEuro(old.pointsPerCurrencyUnit)}.` : item === "mode" ? "Bis dahin bleibt es bei der bisherigen Regel, auch an der Kasse." : old.rulesText.trim() ? "Bis dahin gilt die bisherige Regel." : "Bis dahin gibt es keine weiteren Regeln.";
  return (
    <QuestionForm title={heading} busy={false} failed="" tone="secondary" action="Änderung zurücknehmen" onSubmit={() => step.open("takeback")}>
      <When title={`Gespeichert, gilt ab ${on}`}>{until} {SEES}</When>
      {item === "text" && <div className="ow-qpanel ow-qcmp" data-new><p>Neu</p><p>{pending.rulesText || "Keine weiteren Regeln"}</p></div>}
      <LinePreview program={program} line={ruleChangeLine(pending.effectiveOn, old, pending)} />
      <p className="ow-hint">Eine neue Änderung geht erst, wenn diese gilt oder du sie zurücknimmst.</p>
    </QuestionForm>
  );
}

/** 57/58 for the expiry: a waiting switch-on can be taken back; a waiting shortening can't (Legal (a), W59). */
export function ExpiryWaiting({ slug, program, expiry, label }: { slug: string; program: PublicProgram; expiry: NonNullable<PublicProgram["pendingExpiry"]>; label: string }) {
  const step = useReview<"takeback">();
  const q = useQuestion("expiry-takeback", false);
  const on = longDay(expiry.effectiveOn), shorter = expiry.before !== null;
  if (step.step === "takeback" && !shorter) return (
    <QuestionForm title="Änderung zurücknehmen?" back={{ label, onClick: step.back }} busy={q.busy} failed={q.failed} action="Zurücknehmen" cancel={step.back}
      onSubmit={() => q.save(UPDATE, { programSlug: slug, takeBack: true }, "Änderung zurückgenommen")}>
      <When title="Punkte verfallen weiter nie" undo>Die Änderung entfällt sofort, auch der Hinweis auf den Karten deiner Kunden.</When>
    </QuestionForm>
  );
  const body = <>
    <When title={`Gespeichert, gilt ab ${on}`}>Alle Punkte davor verfallen nie. {SEES}</When>
    <LinePreview program={program} line={expiryChangeLine(expiry.effectiveOn, expiry.months)} />
  </>;
  const title = shorter ? `Punkte verfallen nach ${expiry.months} statt ${expiry.before} Monaten` : `Punkte verfallen nach ${expiry.months} Monaten`;
  // A shortening has nothing to press (W59): the list is one tap back.
  if (shorter) return (
    <QuestionForm title={title} busy={false} failed="" action="" onSubmit={q.leave}>
      {body}
      <p className="ow-hint">Diese Änderung kannst du nicht zurücknehmen. Punkte, die deine Kunden bis zum {on} sammeln, verfallen nie. Eine neue Änderung geht ab dem {on}.</p>
    </QuestionForm>
  );
  return (
    <QuestionForm title={title} busy={false} failed="" tone="secondary" action="Änderung zurücknehmen" onSubmit={() => step.open("takeback")}>
      {body}
      <p className="ow-hint">Eine neue Änderung geht erst, wenn diese gilt oder du sie zurücknimmst.</p>
    </QuestionForm>
  );
}

/**
 * The rule and the expiry share one dated version chain on the server, so while one waits the other takes no change either
 * (CHANGE_PENDING). The page says so before anything is entered. Draft wording for Marketing.
 */
export function OtherWaiting({ title, what, until, final, current }: { title: string; /** „der Sammelregel“, „beim Punkteverfall“ */ what: string; until: string; /** A shortening can't be taken back. */ final?: boolean;
  /** What is set today, shown read-only above the notice (Design). */ current: { label: string; value: string } }) {
  const q = useQuestion("other-waiting", false);
  return (
    <QuestionForm title={title} busy={false} failed="" action="" onSubmit={q.leave}>
      <div className="ow-prog-row"><span className="ow-prog-main"><span className="ow-prog-text"><strong>{current.label}</strong><small>{current.value}</small></span></span></div>
      <Notice tone="warn">Gerade wartet eine Änderung {what} auf ihr Datum, den {longDay(until)}. Ändern kannst du das hier {final ? "ab diesem Tag" : "ab diesem Tag oder wenn du sie zurücknimmst"}.</Notice>
    </QuestionForm>
  );
}
