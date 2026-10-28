"use client";

import { useState } from "react";
import { ReceiptText, Users } from "lucide-react";
import type { MeResponse, PublicProgram } from "@/components/client-api";
import { purchasePoints } from "@/lib/points";
import { CardLinePreview, nf, NumberStepper } from "./owner-ui";
import { earningSentence, euro, MAX_POINTS_PER_CURRENCY_UNIT, minimumSpendMinor, MIN_SPEND_LABEL, unitName, type EarningMode } from "./program-helpers";
import { Choices, Control, FieldError, QuestionForm, rangeError, useQuestion, useReview, wholeIn } from "./question-form";

const UPDATE = "/api/merchant/program/update";
const REVIEW_NOTE = "Gilt ab dem Speichern für neue Buchungen. Bestehende Kartenstände werden nicht neu berechnet.";
const EXAMPLE_MINOR = 1290; // „Einkauf 12,90 €“, the fixed example of screen 33

/** „Regeländerung prüfen“ (34, 35): the stored rule and the new one; saving writes a new rule version at once. */
const Compare = ({ before, after }: { before: string; after: string }) => <>
  <div className="ow-qpanel ow-qcmp"><p>Bisher</p><p>{before}</p></div>
  <div className="ow-qpanel ow-qcmp" data-new><p>Neu</p><p>{after}</p></div>
</>;

/** 14 and 35: the owner's rule text, as the sign-up page shows it, then its review. Rewards are listed live (W35). */
export function RuleQuestion({ me, program }: { me: MeResponse; program: PublicProgram }) {
  const saved = program.ownerRulesText ?? program.rulesText;
  const [text, setText] = useState(saved);
  const { review, open, back } = useReview();
  const short = text.trim().length < 10;
  const q = useQuestion("rule", text.trim() !== saved, { "rule-text": short ? "Der Regeltext braucht mindestens 10 Zeichen." : "" });
  const error = q.error("rule-text"), type = program.programType;
  if (review) return (
    <QuestionForm title="Regeländerung prüfen" back={{ label: "Regel auf der Karte", onClick: back }} busy={q.busy} failed={q.failed} action="Neue Regelversion speichern"
      onSubmit={() => void q.save(UPDATE, { programSlug: me.programSlug, rulesText: text.trim() })}>
      <Compare before={saved} after={text.trim()} />
      <p className="ow-hint">{REVIEW_NOTE}</p>
    </QuestionForm>
  );
  return (
    <QuestionForm title="Wie sammeln deine Kunden?" busy={false} failed="" action="Weiter" onSubmit={() => { if (text.trim() === saved) q.leave(); else if (q.check()) open(); }}>
      <div className="ow-field ow-qpanel">
        <label htmlFor="rule-text">Regel auf der Karte</label>
        <textarea id="rule-text" className="ow-textarea" rows={4} value={text} maxLength={3000} onChange={event => setText(event.target.value)}
          aria-invalid={Boolean(error)} aria-describedby={error ? "rule-text-error rule-text-hint" : "rule-text-hint"} />
        <FieldError id="rule-text-error">{error}</FieldError>
        <p id="rule-text-hint" className="ow-hint">Prämien stehen automatisch auf der Karte und bei der Anmeldung. Schreib sie hier nicht dazu, dann bleibt alles aktuell.</p>
      </div>
      {/* No preview of a rule the save refuses, as on the news (18). */}
      {!short && <div className="ow-qpanel">
        <CardLinePreview label="So steht es bei der Anmeldung" shop={program.businessName} brandColor={program.brandColor}>
          <span className="ow-qrule">{text.trim()}</span>
          {program.rewards.map(reward => <span key={reward.rewardId} className="ow-cardline-reward"><b>{reward.title}</b><span>{nf.format(reward.cost)} {unitName(type, reward.cost)}</span></span>)}
        </CardLinePreview>
      </div>}
    </QuestionForm>
  );
}

/** 33 and 34 (points shops): how points come about, with the till's arithmetic from the server's own functions. */
export function EarningQuestion({ me, program, nfc }: { me: MeResponse; program: PublicProgram; /** NFC is offered here. */ nfc: boolean }) {
  const saved = { mode: program.earningMode, rate: String(program.pointsPerCurrencyUnit) };
  const [draft, setDraft] = useState(saved);
  const { review, open, back } = useReview();
  const purchase = draft.mode === "purchase", rate = Number(draft.rate), max = MAX_POINTS_PER_CURRENCY_UNIT;
  const rateOk = wholeIn(draft.rate, 1, max);
  const changed = draft.mode !== saved.mode || (purchase && draft.rate !== saved.rate);
  const q = useQuestion("earning", changed, { "earning-rate": !purchase || rateOk ? "" : rangeError(1, max) });
  const sentence = (mode: EarningMode, perUnit: number) => earningSentence("points", mode, perUnit, program.currency);
  if (review) return (
    <QuestionForm title="Regeländerung prüfen" back={{ label: "So entstehen Punkte", onClick: back }} busy={q.busy} failed={q.failed} action="Neue Regelversion speichern"
      onSubmit={() => void q.save(UPDATE, { programSlug: me.programSlug, earningMode: draft.mode, ...(purchase ? { pointsPerCurrencyUnit: rate } : {}) })}>
      <Compare before={sentence(saved.mode, Number(saved.rate))} after={sentence(draft.mode, rate)} />
      <p className="ow-hint">{REVIEW_NOTE}</p>
    </QuestionForm>
  );
  const cheapest = [...program.rewards].sort((a, b) => a.cost - b.cost)[0];
  const spend = cheapest && rateOk ? minimumSpendMinor(cheapest.cost, rate) : null, points = rateOk ? purchasePoints(EXAMPLE_MINOR, rate) : 0;
  const error = q.error("earning-rate");
  return (
    <QuestionForm title="Wie entstehen Punkte?" busy={false} failed="" action="Weiter" onSubmit={() => { if (!changed) q.leave(); else if (q.check()) open(); }}>
      <Choices name="earning-mode" label="So entstehen Punkte" value={draft.mode} saved={saved.mode} onChange={mode => setDraft({ ...draft, mode: mode as EarningMode })} options={[
        { value: "purchase", label: "Nach Einkaufswert", sub: "Das Team gibt den Betrag ein, das System rechnet und rundet ab.", icon: ReceiptText },
        { value: "manual", label: "Manuell", sub: "Das Team gibt die Punktmenge direkt ein.", icon: Users },
      ]} />
      {purchase && <>
        <Control id="earning-rate" label={`Punkte pro 1 ${program.currency === "EUR" ? "€" : program.currency}`} hint={`1 bis ${max}`} error={error}>
          <NumberStepper id="earning-rate" value={draft.rate} onChange={value => setDraft({ ...draft, rate: value && String(Math.min(Number(value), max)) })} min={1} max={max}
            unit={{ one: "Punkt", many: "Punkte" }} invalid={Boolean(error)} describedBy="earning-rate-hint" />
        </Control>
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
