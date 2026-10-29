"use client";

import { useRef, useState } from "react";
import { ReceiptText, Users } from "lucide-react";
import type { MeResponse, PublicProgram } from "@/components/client-api";
import { EXCLUDED_GOODS } from "@/lib/card-extras";
import { purchasePoints, purchaseRuleSentence } from "@/lib/points";
import { CardLinePreview, nf, NumberStepper } from "./owner-ui";
import { earningSentence, euro, EXTRA_RULES, longDay, EXTRA_RULES_HINT, EXTRA_RULES_LABEL, MAX_POINTS_PER_CURRENCY_UNIT, minimumSpendMinor, MIN_SPEND_LABEL, QUESTIONS, RULE_PLACEHOLDER, ruleKind, SHORT_RULE, unitName, type EarningMode, type RuleKind } from "./program-helpers";
import { Choices, Control, FieldError, QuestionForm, rangeError, useQuestion, useReview, wholeIn } from "./question-form";
import { datedToast, LinePreview, OtherWaiting, RuleWaiting, SEES_TODAY, WorseChoice } from "./program-rule-changes";
import { When } from "./program-reward";
import { ruleChangeLine } from "@/lib/change-lines";

const UPDATE = "/api/merchant/program/update";
const REVIEW_NOTE = "Gilt ab dem Speichern für neue Buchungen. Bestehende Kartenstände werden nicht neu berechnet.";
const EXAMPLE_MINOR = 1290; // „Einkauf 12,90 €“, the fixed example of screen 33
// Under 34's „Neu“ when manual points become points by purchase amount: the save empties the owner's text (W51).
const REPLACED_NOTE = "Der Satz oben ersetzt deine bisherige Regel. Was zusätzlich gilt, ergänzt du danach unter „Weitere Regeln“.";

/** The rules as the sign-up page shows them: by purchase amount the system's sentence opens and the owner's text adds to it. */
const shownText = (kind: RuleKind, program: PublicProgram, text: string) =>
  kind === "purchase" ? [purchaseRuleSentence(program.pointsPerCurrencyUnit, program.currency), text].filter(Boolean).join("\n\n") : text;

/** „Regeländerung prüfen“ (34, 35): the stored rule and the new one; saving writes a new rule version at once. */
const Compare = ({ before, after, none }: { before: string; after: string; /** What an empty side says. */ none?: string }) => <>
  <div className="ow-qpanel ow-qcmp"><p>Bisher</p><p className={before ? undefined : "ow-muted"}>{before || none}</p></div>
  <div className="ow-qpanel ow-qcmp" data-new><p>Neu</p><p className={after ? undefined : "ow-muted"}>{after || none}</p></div>
</>;

/**
 * 14 (the rule itself, W35) or 52 (by purchase amount: what adds to the system's sentence, W51), with the sign-up preview.
 * `former` (C2): the extra rules so far, offered to take into the rule while the field doesn't hold them yet.
 */
function RuleField({ kind, program, text, onChange, error, former = "" }: { kind: RuleKind; program: PublicProgram; text: string; onChange: (text: string) => void; error: string; former?: string }) {
  const extras = kind === "purchase", field = useRef<HTMLTextAreaElement>(null);
  function adopt() {
    onChange(text.trim() ? `${text.trimEnd()}\n${former}` : former);
    requestAnimationFrame(() => { const end = field.current?.value.length ?? 0; field.current?.focus(); field.current?.setSelectionRange(end, end); });
  }
  return <>
    <div className="ow-field ow-qpanel">
      <label htmlFor="rule-text">{extras ? EXTRA_RULES_LABEL : QUESTIONS.rule}</label>
      <textarea ref={field} id="rule-text" className="ow-textarea" rows={4} value={text} maxLength={3000} placeholder={RULE_PLACEHOLDER[kind]} onChange={event => onChange(event.target.value)}
        aria-invalid={Boolean(error)} aria-describedby={error ? "rule-text-error rule-text-hint" : "rule-text-hint"} />
      <FieldError id="rule-text-error">{error}</FieldError>
      {former && !text.includes(former) && <>
        <p id="rule-text-former" className="ow-hint ow-qformer">Bisher unter „Weitere Regeln“: <span>{former}</span></p>
        <button type="button" className="ow-qlink" aria-describedby="rule-text-former" onClick={adopt}>In die Regel übernehmen</button>
      </>}
      <p id="rule-text-hint" className="ow-hint">{extras ? EXTRA_RULES_HINT : "Prämien stehen automatisch auf der Karte und bei der Anmeldung. Schreib sie hier nicht dazu, dann bleibt alles aktuell."}</p>
    </div>
    {/* No preview of a rule the save refuses, as on the news (18). It ends with Legal's exclusions, as the sign-up page
        does (German pages). */}
    {(extras || text.trim().length >= 10) && <div className="ow-qpanel">
      <CardLinePreview label="So steht es bei der Anmeldung" shop={program.businessName} brandColor={program.brandColor} rules={program.locale !== "fr" ? EXCLUDED_GOODS : undefined}>
        <span className="ow-qrule">{shownText(kind, program, text.trim())}</span>
        {program.rewards.map(reward => <span key={reward.rewardId} className="ow-cardline-reward"><b>{reward.title}</b><span>{nf.format(reward.cost)} {unitName(program.programType, reward.cost)}</span></span>)}
      </CardLinePreview>
    </div>}
  </>;
}

/**
 * 14 or 52, then the review (35, 62): the owner says whether the new text is worse for customers (W46, nothing preselected);
 * „Schlechter“ waits four weeks with the card line (42–45). Extra rules may stay empty; the owner's own rule needs 10
 * characters. While a rule change waits, the page shows it with its take-back (57).
 */
export function RuleQuestion({ me, program }: { me: MeResponse; program: PublicProgram }) {
  const kind = ruleKind(program.programType, program.earningMode), extras = kind === "purchase";
  const saved = program.ownerRulesText ?? program.rulesText;
  const [text, setText] = useState(saved), [worse, setWorse] = useState("");
  const { step, open, back } = useReview();
  const q = useQuestion("rule", text.trim() !== saved, { "rule-text": !extras && text.trim().length < 10 ? SHORT_RULE : "" });
  const label = extras ? EXTRA_RULES : QUESTIONS.rule, notice = program.noticeOn ?? "";
  if (program.pending) return <RuleWaiting slug={me.programSlug} program={program} pending={program.pending} label={label} />;
  if (program.pendingExpiry) return <OtherWaiting title={extras ? "Gibt es weitere Regeln?" : "Wie sammeln deine Kunden?"} what="beim Punkteverfall" until={program.pendingExpiry.effectiveOn} final={program.pendingExpiry.before !== null} />;
  if (step) {
    const before = { earningMode: program.earningMode, pointsPerCurrencyUnit: program.pointsPerCurrencyUnit, rulesText: saved };
    return (
      <QuestionForm title="Regeländerung prüfen" back={{ label, onClick: back }} busy={q.busy} failed={q.failed} action="Neue Regelversion speichern" disabled={!worse}
        onSubmit={() => worse && q.save(UPDATE, { programSlug: me.programSlug, rulesText: text.trim(), worse: worse === "worse" }, worse === "worse" ? datedToast(notice) : undefined)}>
        <Compare before={saved} after={text.trim()} none={extras ? "Keine weiteren Regeln" : undefined} />
        <WorseChoice value={worse} onChange={setWorse} notice={notice} program={program} line={ruleChangeLine(notice, before, { ...before, rulesText: text.trim() })}
          until={saved.trim() ? "Bis dahin gilt die bisherige Regel." : "Bis dahin gibt es keine weiteren Regeln."} />
        {worse === "better" && <p className="ow-hint">{REVIEW_NOTE}</p>}
      </QuestionForm>
    );
  }
  return (
    <QuestionForm title={extras ? "Gibt es weitere Regeln?" : "Wie sammeln deine Kunden?"} busy={false} failed="" action="Weiter" onSubmit={() => { if (text.trim() === saved) q.leave(); else if (q.check()) open(); }}>
      <RuleField kind={kind} program={program} text={text} onChange={setText} error={q.error("rule-text")} />
    </QuestionForm>
  );
}

/**
 * 33 and 34 (points shops): how points come about, with the till's arithmetic from the server's own functions. A switch
 * of the earning rewrites the rules text in the same save (W51): to the purchase amount the sentence replaces the owner's
 * rule and the extras start empty; to manual the owner first writes the rule on 14, starting from the extras.
 */
export function EarningQuestion({ me, program, nfc }: { me: MeResponse; program: PublicProgram; /** NFC is offered here. */ nfc: boolean }) {
  const saved = { mode: program.earningMode, rate: String(program.pointsPerCurrencyUnit) }, savedText = program.ownerRulesText ?? "";
  const [draft, setDraft] = useState(saved);
  const [text, setText] = useState(""), [worse, setWorse] = useState(""); // C2's 14 starts empty; the extras so far are offered under the field
  const { step, open, back } = useReview<"rule" | "review">();
  const purchase = draft.mode === "purchase", rate = Number(draft.rate), max = MAX_POINTS_PER_CURRENCY_UNIT;
  const rateOk = wholeIn(draft.rate, 1, max);
  const changed = draft.mode !== saved.mode || (purchase && draft.rate !== saved.rate);
  const toPurchase = purchase && saved.mode === "manual", toManual = !purchase && saved.mode === "purchase";
  const q = useQuestion("earning", changed, step === "rule" ? { "rule-text": text.trim().length < 10 ? SHORT_RULE : "" } : { "earning-rate": !purchase || rateOk ? "" : rangeError(1, max) });
  const sentence = (mode: EarningMode, perUnit: number) => earningSentence("points", mode, perUnit, program.currency);
  // ENG-100: a lower rate waits four weeks by itself (37/38); a switch of mode asks whether it is worse (53/54).
  const notice = program.noticeOn ?? "", cut = purchase && !toPurchase && rateOk && rate < Number(saved.rate), switched = toPurchase || toManual;
  const before = { earningMode: saved.mode, pointsPerCurrencyUnit: Number(saved.rate), rulesText: savedText };
  const after = { earningMode: draft.mode, pointsPerCurrencyUnit: purchase ? rate : before.pointsPerCurrencyUnit, rulesText: toPurchase ? "" : toManual ? text.trim() : savedText };
  const dated = cut || worse === "worse";
  if (program.pending) return <RuleWaiting slug={me.programSlug} program={program} pending={program.pending} label={QUESTIONS.earning} />;
  if (program.pendingExpiry) return <OtherWaiting title="Wie entstehen Punkte?" what="beim Punkteverfall" until={program.pendingExpiry.effectiveOn} final={program.pendingExpiry.before !== null} />;
  if (step === "rule") return (
    <QuestionForm title="Wie sammeln deine Kunden?" back={{ label: QUESTIONS.earning, onClick: back }} busy={false} failed="" action="Weiter" onSubmit={() => { if (q.check()) open(); }}>
      <RuleField kind="manual" program={program} text={text} onChange={setText} error={q.error("rule-text")} former={savedText} />
    </QuestionForm>
  );
  const submit = () => void q.save(UPDATE, { programSlug: me.programSlug, earningMode: draft.mode, ...(purchase ? { pointsPerCurrencyUnit: rate } : {}), ...(toPurchase ? { rulesText: "" } : toManual ? { rulesText: text.trim() } : {}),
    ...(switched ? { worse: worse === "worse" } : {}) }, dated ? datedToast(notice) : undefined);
  // 38: a lower rate, confirmed with its date; no choice.
  if (step && cut) return (
    <QuestionForm title={`Punkte pro €: ${rate} statt ${saved.rate}`} back={{ label: QUESTIONS.earning, onClick: back }} busy={q.busy} failed={q.failed} action="Neue Regelversion speichern" onSubmit={submit}>
      <When title={`Gilt ab ${longDay(notice)}`}>Bis dahin bleibt es bei {saved.rate} {saved.rate === "1" ? "Punkt" : "Punkten"} pro €. {SEES_TODAY}</When>
      <LinePreview program={program} line={ruleChangeLine(notice, before, after)} />
    </QuestionForm>
  );
  if (step) return (
    <QuestionForm title="Regeländerung prüfen" back={{ label: toManual ? QUESTIONS.rule : QUESTIONS.earning, onClick: back }} busy={q.busy} failed={q.failed} action="Neue Regelversion speichern"
      disabled={switched && !worse} onSubmit={() => { if (!switched || worse) submit(); }}>
      {toPurchase ? <Compare before={savedText} after={sentence("purchase", rate)} />
        : toManual ? <Compare before={shownText("purchase", program, savedText)} after={text.trim()} />
        : <Compare before={sentence(saved.mode, Number(saved.rate))} after={sentence(draft.mode, rate)} />}
      {toPurchase && <p className="ow-hint">{REPLACED_NOTE}</p>}
      {switched && <WorseChoice value={worse} onChange={setWorse} notice={notice} program={program} line={ruleChangeLine(notice, before, after)}
        lead="Schlechter heißt: Für den gleichen Einkauf gibt es weniger Punkte." until="Bis dahin bleibt es bei der bisherigen Regel, auch an der Kasse." />}
      {(!switched || worse === "better") && <p className="ow-hint">{REVIEW_NOTE}</p>}
    </QuestionForm>
  );
  const cheapest = [...program.rewards].sort((a, b) => a.cost - b.cost)[0];
  const spend = cheapest && rateOk ? minimumSpendMinor(cheapest.cost, rate) : null, points = rateOk ? purchasePoints(EXAMPLE_MINOR, rate) : 0;
  const error = q.error("earning-rate");
  return (
    <QuestionForm title="Wie entstehen Punkte?" busy={false} failed="" action="Weiter" onSubmit={() => { if (!changed) q.leave(); else if (q.check()) open(toManual ? "rule" : "review"); }}>
      <Choices name="earning-mode" label="So entstehen Punkte" value={draft.mode} saved={saved.mode} onChange={mode => setDraft({ ...draft, mode: mode as EarningMode })} options={[
        { value: "purchase", label: "Nach Einkaufswert", sub: "Das Team gibt den Betrag ein, das System rechnet und rundet ab.", icon: ReceiptText },
        { value: "manual", label: "Manuell", sub: "Das Team gibt die Punktmenge direkt ein.", icon: Users },
      ]} />
      {purchase && <>
        <Control id="earning-rate" label={`Punkte pro 1 ${program.currency === "EUR" ? "€" : program.currency}`} hint={`1 bis ${max}`} error={error}>
          <NumberStepper id="earning-rate" value={draft.rate} onChange={value => setDraft({ ...draft, rate: value && String(Math.min(Number(value), max)) })} min={1} max={max}
            unit={{ one: "Punkt", many: "Punkte" }} invalid={Boolean(error)} describedBy="earning-rate-hint" />
        </Control>
        {cut && <p className="ow-hint" data-later>Weniger Punkte pro € gelten erst nach vier Wochen, ab {longDay(notice)}.</p>}
        {rateOk && <div className="ow-qpanel ow-qsum">
          <p className="ow-cardline-label">So rechnet die Kasse</p>
          <dl>
            <div><dt>Einkauf {euro(EXAMPLE_MINOR, program.currency)}</dt><dd>{nf.format(points)} {unitName("points", points)}</dd></div>
            {spend !== null && <div><dt>{cheapest.title} ab</dt><dd>{euro(spend, program.currency)} Einkauf</dd></div>}
          </dl>
          <p className="ow-hint">Abgerundet auf ganze Punkte. {MIN_SPEND_LABEL} Den Einkaufswert gibt das Team an der Kasse ein.{nfc && " Das NFC-Schild überträgt keinen Betrag."}</p>
        </div>}
      </>}
    </QuestionForm>
  );
}
