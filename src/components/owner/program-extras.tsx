"use client";

import { useState } from "react";
import { ChevronDown, Hourglass, Plus, X } from "lucide-react";
import type { MeResponse, PublicProgram } from "@/components/client-api";
import { CardLinePreview, NumberStepper } from "./owner-ui";
import { CARD_NEWS_MAX, CHALLENGE_VISITS, challengeBonusRange, cardNewsProblem, LEVEL_PERK_MAX, levelPerkProblem, REVIEW_URL_MAX, reviewUrlValid } from "@/lib/card-extras";
import { POINTS_EXPIRY_MONTHS } from "@/lib/points-expiry-rules";
import { parsePurchaseAmountMinor } from "@/lib/points";
import { AVERAGE_VISIT_SPEND_MAX_MINOR, SPEND_COPY } from "@/lib/spend-copy";
import { unitWord } from "@/lib/units";
import { longDay, QUESTIONS, type Question } from "./program-helpers";
import { Choices, Control, FieldError, QuestionForm, rangeError, SwitchRow, useQuestion, useReview, wholeIn } from "./question-form";
import { datedToast, ExpiryWaiting, LinePreview, OtherWaiting, SEES_TODAY } from "./program-rule-changes";
import { When } from "./program-reward";
import { expiryChangeLine } from "@/lib/change-lines";
import { bonusRange } from "./winback-card";

const EXTRAS = "/api/merchant/program/extras";
const TEXT_PROBLEM = (max: number) => ({ TOO_LONG: `Höchstens ${max} Zeichen.`, LINK: "Bitte ohne Links oder Webadressen.", CONTROL: "Bitte in einer Zeile, ohne Zeilenumbruch." });
const units = (me: MeResponse) => me.programType === "stamp" ? { one: "Stempel", many: "Stempel" } : { one: "Punkt", many: "Punkte" };

/** The extras rows' questions (Wegweiser 08, 10–13, 15, 16). Each posts only its own fields to the extras API (N-3). */
export function ExtrasQuestion({ me, question, program }: { me: MeResponse; question: Question; program: PublicProgram | null }) {
  if (question === "welcome-bonus") return <WelcomeBonus me={me} />;
  if (question === "challenge") return program && <Challenge me={me} program={program} />;
  if (question === "levels") return <Levels me={me} />;
  if (question === "news") return program && <News me={me} program={program} />;
  if (question === "review-link") return <ReviewLink me={me} />;
  if (question === "average-spend") return program && <AverageSpend me={me} program={program} />;
  if (question === "points-expiry") return program && <PointsExpiry me={me} program={program} />;
  return null;
}

/** 08: stamps pick one of four rows; points type their bonus on the full-size stepper. */
function WelcomeBonus({ me }: { me: MeResponse }) {
  const stamp = me.programType === "stamp", max = stamp ? 3 : 50, unit = units(me);
  const saved = String(me.welcomeBonus ?? 0);
  const [value, setValue] = useState(saved);
  const q = useQuestion("welcome-bonus", value !== saved, { "welcome-bonus": wholeIn(value, 0, max) ? "" : rangeError(0, max) });
  const error = q.error("welcome-bonus");
  return (
    <QuestionForm title={`Startbonus: wie viele ${unit.many} extra?`} lead={`Mit der ersten Buchung, einmal pro Karte. Höchstens ${max} ${unit.many}.`} busy={q.busy} failed={q.failed}
      onSubmit={() => void q.save(EXTRAS, { programId: me.programId, welcomeBonus: Number(value) })}>
      {stamp
        ? <Choices name="welcome-bonus" label="Startbonus" value={value} saved={saved} onChange={setValue}
          options={[{ value: "0", label: "Aus", sub: "Kein Startbonus", icon: X }, ...[1, 2, 3].map(n => ({ value: String(n), label: `+${n} Stempel`, icon: Plus }))]} />
        : <div className="ow-qnumber" data-typed>{/* 0 to 50 in fives, as PR 2's points: the number looks like the field it is, so other values are typed */}
          <label htmlFor="welcome-bonus" className="ow-sr">Startbonus</label>
          <NumberStepper id="welcome-bonus" value={value} onChange={next => setValue(next && String(Math.min(Number(next), max)))} min={0} max={max} stepSize={5} unit={unit} bonus offAtZero invalid={Boolean(error)} describedBy={error ? "welcome-bonus-hint" : undefined} />
          <FieldError id="welcome-bonus-hint">{error}</FieldError>
        </div>}
    </QuestionForm>
  );
}

/** 10: a change to a running challenge starts with the next month (ENG-065), so the page says which terms hold now. */
function Challenge({ me, program }: { me: MeResponse; program: PublicProgram }) {
  const unit = units(me), next = me.challengeNext, current = me.challengeVisits ?? null;
  const latest = next ? next.visits : current; // what the card will show from the next month on
  const saved = { on: latest !== null, visits: String(latest ?? 4), bonus: String((next?.bonus ?? me.challengeBonus) || 1) };
  const [draft, setDraft] = useState(saved);
  const range = challengeBonusRange(me.programType, Math.min(...program.rewards.map(reward => reward.cost)));
  const q = useQuestion("challenge", JSON.stringify(draft) !== JSON.stringify(saved), draft.on ? {
    "challenge-visits": wholeIn(draft.visits, CHALLENGE_VISITS.min, CHALLENGE_VISITS.max) ? "" : rangeError(CHALLENGE_VISITS.min, CHALLENGE_VISITS.max),
    "challenge-bonus": range.max < 1 ? "Der Punkte-Bonus braucht eine Prämie ab 4 Punkten." : wholeIn(draft.bonus, range.min, range.max) ? "" : rangeError(range.min, range.max),
  } : {});
  const edit = (patch: Partial<typeof draft>) => setDraft(value => ({ ...value, ...patch }));
  const date = (iso: string) => `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}.`;
  return (
    <QuestionForm title="Monats-Challenge" lead="Bonus für viele Buchungen in einem Monat." busy={q.busy} failed={q.failed}
      onSubmit={() => void q.save(EXTRAS, { programId: me.programId, challengeVisits: draft.on ? Number(draft.visits) : null, ...(draft.on ? { challengeBonus: Number(draft.bonus) } : {}) })}>
      <SwitchRow label="Monats-Challenge" sub="Zählt jeden Kalendermonat neu" checked={draft.on} onChange={on => edit({ on })} />
      {draft.on && <>
        <Control id="challenge-visits" label="Buchungen im Monat" hint={`${CHALLENGE_VISITS.min} bis ${CHALLENGE_VISITS.max}`} error={q.error("challenge-visits")}>
          <NumberStepper id="challenge-visits" value={draft.visits} onChange={visits => edit({ visits })} min={CHALLENGE_VISITS.min} max={CHALLENGE_VISITS.max} unit={{ one: "Buchung", many: "Buchungen" }} invalid={Boolean(q.error("challenge-visits"))} describedBy="challenge-visits-hint" />
        </Control>
        <Control id="challenge-bonus" label="Bonus" hint={me.programType === "stamp" ? "1 bis 3 Stempel" : `${bonusRange(range.max)}: höchstens ein Viertel deiner günstigsten Prämie.`} error={q.error("challenge-bonus")}>
          <NumberStepper id="challenge-bonus" value={draft.bonus} onChange={bonus => edit({ bonus })} min={range.min} max={Math.max(range.min, range.max)} unit={unit} bonus invalid={Boolean(q.error("challenge-bonus"))} describedBy="challenge-bonus-hint" />
        </Control>
      </>}
      {next ? <p className="ow-hint">Diesen Monat gilt noch: {me.challengeVisits}-mal, +{me.challengeBonus} {unitWord(me.challengeBonus ?? 0, me.programType)}. Gilt ab {date(next.from)}: {next.visits ? `${next.visits}-mal, +${next.bonus} ${unitWord(next.bonus ?? 0, me.programType)}` : "aus"}.</p>
        : current !== null && <p className="ow-hint">Änderungen an der laufenden Challenge gelten ab dem 1. des nächsten Monats; dieser Monat bleibt, wie die Karte es zeigt.</p>}
    </QuestionForm>
  );
}

const PERKS = [["Bronze", "levelBronzePerk"], ["Silber", "levelSilverPerk"], ["Gold", "levelGoldPerk"]] as const;
type Perk = (typeof PERKS)[number][1];

/** 11: the thresholds on steppers; the perks (not drawn) stay today's fields behind „Vorteile pro Level“. */
function Levels({ me }: { me: MeResponse }) {
  const saved = { on: me.levelsEnabled ?? false, silver: String(me.levelSilverVisits ?? ""), gold: String(me.levelGoldVisits ?? ""), levelBronzePerk: me.levelBronzePerk ?? "", levelSilverPerk: me.levelSilverPerk ?? "", levelGoldPerk: me.levelGoldPerk ?? "" };
  const [draft, setDraft] = useState(saved);
  const [open, setOpen] = useState(false);
  const perk = (key: Perk) => { const problem = levelPerkProblem(draft[key].trim()); return problem ? TEXT_PROBLEM(LEVEL_PERK_MAX)[problem] : ""; };
  // No default thresholds (Product): switching levels on needs both.
  const q = useQuestion("levels", JSON.stringify(draft) !== JSON.stringify(saved), draft.on ? {
    "level-silver": wholeIn(draft.silver, 2, 50) ? "" : rangeError(2, 50),
    "level-gold": !wholeIn(draft.gold, 3, 90) ? rangeError(3, 90) : Number(draft.gold) <= Number(draft.silver) ? "Gold braucht mehr Buchungstage als Silber." : "",
    ...Object.fromEntries(PERKS.map(([, key]) => [key, perk(key)])),
  } : {});
  const edit = (patch: Partial<typeof draft>) => setDraft(value => ({ ...value, ...patch }));
  const day = { one: "Buchungstag", many: "Buchungstage" };
  const perksShown = open || PERKS.some(([, key]) => perk(key)); // a perk that needs fixing stays in view
  return (
    <QuestionForm title="Kundenlevel" busy={q.busy} failed={q.failed}
      onSubmit={() => void q.save(EXTRAS, { programId: me.programId, levelsEnabled: draft.on, ...(draft.on ? { levelSilverVisits: Number(draft.silver), levelGoldVisits: Number(draft.gold), ...Object.fromEntries(PERKS.map(([, key]) => [key, draft[key].trim()])) } : {}) })}>
      <SwitchRow label="Kundenlevel" sub="Bronze, Silber, Gold nach Buchungstagen" checked={draft.on} onChange={on => edit({ on })} />
      {draft.on && <>
        <Control id="level-silver" label="Silber ab" error={q.error("level-silver")}>
          <NumberStepper id="level-silver" value={draft.silver} onChange={silver => edit({ silver })} min={2} max={50} unit={day} invalid={Boolean(q.error("level-silver"))} describedBy="level-silver-hint" />
        </Control>
        <Control id="level-gold" label="Gold ab" hint="Gezählt werden Tage mit bestätigter Buchung in den letzten 90 Tagen." error={q.error("level-gold")}>
          <NumberStepper id="level-gold" value={draft.gold} onChange={gold => edit({ gold })} min={3} max={90} unit={day} invalid={Boolean(q.error("level-gold"))} describedBy="level-gold-hint" />
        </Control>
        <button type="button" className="ow-qlink" aria-expanded={perksShown} aria-controls="level-perks" onClick={() => setOpen(!perksShown)}>Vorteile pro Level<ChevronDown size={18} aria-hidden="true" /></button>
        {perksShown && <div id="level-perks" className="ow-qpanel ow-stack">
          <p className="ow-hint">Der Vorteil ist ein Text, den dein Team an der Kasse sieht und einlöst; gebucht wird nichts. Er muss echt sein und eingehalten werden, nie auf Tabak, Presse, Bücher, Lotto oder Handyguthaben.</p>
          {PERKS.map(([name, key]) => <div key={key} className="ow-field">
            <label htmlFor={key}>Vorteil {name} (optional)</label>
            <input id={key} className="ow-input" value={draft[key]} maxLength={LEVEL_PERK_MAX} placeholder={name === "Gold" ? "z. B. Getränk aufs Haus" : undefined} onChange={event => edit({ [key]: event.target.value })}
              aria-invalid={Boolean(q.error(key))} aria-describedby={q.error(key) ? `${key}-error` : undefined} />
            <FieldError id={`${key}-error`}>{q.error(key)}</FieldError>
          </div>)}
        </div>}
      </>}
    </QuestionForm>
  );
}

/** 12: one line of news, as the card shows it; „Neuigkeit entfernen“ empties it at once. */
function News({ me, program }: { me: MeResponse; program: PublicProgram }) {
  const saved = me.cardNews ?? "";
  const [text, setText] = useState(saved);
  const problem = cardNewsProblem(text.trim());
  const q = useQuestion("card-news", text !== saved, { "card-news": problem ? TEXT_PROBLEM(CARD_NEWS_MAX)[problem] : "" });
  const error = q.error("card-news"), shown = problem ? "" : text.trim(); // the card never shows a line the save refuses (18)
  return (
    <QuestionForm title="Was sollen Kunden auf der Karte lesen?" busy={q.busy} failed={q.failed} onSubmit={() => void q.save(EXTRAS, { programId: me.programId, cardNews: text.trim() })}>
      <div className="ow-field ow-qpanel">
        <label htmlFor="card-news">Neuigkeit</label>
        {/* The card shows one line: a line break typed or pasted becomes a space. */}
        <textarea id="card-news" className="ow-textarea" rows={3} value={text} maxLength={CARD_NEWS_MAX} onChange={event => setText(event.target.value.replace(/\s*\n\s*/g, " "))}
          aria-invalid={Boolean(error)} aria-describedby={error ? "card-news-error card-news-hint" : "card-news-hint"} />
        <FieldError id="card-news-error">{error}</FieldError>
        <p className="ow-qcount"><span id="card-news-hint">Nur Text, keine Links</span><span>{Array.from(text).length}/{CARD_NEWS_MAX}</span></p>
      </div>
      {shown && <div className="ow-qpanel"><CardLinePreview label="So steht es auf der Karte" shop={program.businessName} brandColor={program.brandColor}>{shown}</CardLinePreview></div>}
      {saved && <button type="button" className="ow-qlink" data-danger onClick={() => void q.save(EXTRAS, { programId: me.programId, cardNews: "" }, "Neuigkeit entfernt")}>Neuigkeit entfernen</button>}
    </QuestionForm>
  );
}

/** 13: an empty field takes the link off the card. */
function ReviewLink({ me }: { me: MeResponse }) {
  const saved = me.reviewUrl ?? "";
  const [url, setUrl] = useState(saved);
  const q = useQuestion("review-url", url !== saved, { "review-url": !url.trim() || reviewUrlValid(url.trim()) ? "" : "Bitte einen https-Link von g.page, google.com/maps oder search.google.com/local/writereview." });
  const error = q.error("review-url");
  return (
    <QuestionForm title="Wo können Kunden dich bewerten?" busy={q.busy} failed={q.failed} onSubmit={() => void q.save(EXTRAS, { programId: me.programId, reviewUrl: url.trim() })}>
      <div className="ow-field ow-qpanel">
        <label htmlFor="review-url">Link zur Google-Bewertung</label>
        <input id="review-url" className="ow-input" type="url" inputMode="url" autoComplete="off" spellCheck={false} value={url} maxLength={REVIEW_URL_MAX} placeholder="https://g.page/r/…/review" onChange={event => setUrl(event.target.value)}
          aria-invalid={Boolean(error)} aria-describedby={error ? "review-url-error review-url-hint" : "review-url-hint"} />
        <FieldError id="review-url-error">{error}</FieldError>
        <p id="review-url-hint" className="ow-hint">Den Link findest du in deinem Google-Unternehmensprofil.</p>
        <p className="ow-hint">Ab der dritten bestätigten Buchung zeigt die Karte den Link. Für eine Bewertung gibt es keine Prämie.</p>
      </div>
    </QuestionForm>
  );
}

/** 15: stamps and hand-entered points carry no amount, so the owner's average stands in for the results; empty clears it. */
function AverageSpend({ me, program }: { me: MeResponse; program: PublicProgram }) {
  const stored = me.averageVisitSpendMinor;
  const saved = stored ? `${Math.floor(stored / 100)},${String(stored % 100).padStart(2, "0")}` : "";
  const [text, setText] = useState(saved);
  let minor: number | null | undefined = null; // undefined: not an amount the results can use
  if (text.trim()) { try { minor = parsePurchaseAmountMinor(text); } catch { minor = undefined; } if (minor && minor > AVERAGE_VISIT_SPEND_MAX_MINOR) minor = undefined; }
  const q = useQuestion("average-spend", text !== saved, { "average-spend": minor === undefined ? SPEND_COPY.averageError : "" });
  const error = q.error("average-spend");
  return (
    <QuestionForm title="Wie hoch ist ein Bon bei dir im Schnitt?" busy={q.busy} failed={q.failed} onSubmit={() => void q.save(EXTRAS, { programId: me.programId, averageVisitSpendMinor: minor })}>
      <div className="ow-field ow-qpanel">
        <label htmlFor="average-spend">{SPEND_COPY.averageLabel}</label>
        <span className="ow-qmoney">
          <input id="average-spend" className="ow-input" inputMode="decimal" autoComplete="off" value={text} placeholder="12,50" onChange={event => setText(event.target.value.replace(/[^0-9,.]/g, ""))}
            aria-invalid={Boolean(error)} aria-describedby={error ? "average-spend-error average-spend-hint" : "average-spend-hint"} />
          <span aria-hidden="true">{program.currency === "EUR" ? "€" : program.currency}</span>
        </span>
        <FieldError id="average-spend-error">{error}</FieldError>
        <p id="average-spend-hint" className="ow-hint">{SPEND_COPY.averageHint}</p>
      </div>
    </QuestionForm>
  );
}

/**
 * 16 (points shops): the only periods the schema allows. Switching on or shortening waits four weeks (ENG-100 60/61):
 * points from before the date never expire. Switching off or lengthening applies at once. A waiting change shows on 57.
 */
function PointsExpiry({ me, program }: { me: MeResponse; program: PublicProgram }) {
  const waiting = program.pendingExpiry, inForce = waiting ? waiting.before : me.pointsExpiryMonths ?? null;
  const saved = String(inForce ?? "");
  const [value, setValue] = useState(saved);
  const step = useReview();
  const q = useQuestion("points-expiry", value !== saved);
  const months = value ? Number(value) : null, notice = program.noticeOn ?? "";
  const stricter = months !== null && (inForce === null || months < inForce);
  const save = () => void q.save(EXTRAS, { programId: me.programId, pointsExpiryMonths: months }, stricter ? datedToast(notice) : undefined);
  if (waiting) return <ExpiryWaiting slug={me.programSlug} program={program} expiry={waiting} label={QUESTIONS["points-expiry"]} />;
  if (program.pending) return <OtherWaiting title="Wann verfallen Punkte?" what="eine Regeländerung" until={program.pending.effectiveOn} current={{ label: QUESTIONS["points-expiry"], value: inForce ? `Nach ${inForce} Monaten` : "Nie" }} />;
  // 61: the stricter period, confirmed with its date; a shortening can't be taken back (Legal (a)).
  if (step.step && stricter && months !== null) return (
    <QuestionForm title={inForce === null ? `Punkte verfallen nach ${months} Monaten` : `Punkte verfallen nach ${months} statt ${inForce} Monaten`}
      back={{ label: QUESTIONS["points-expiry"], onClick: step.back }} busy={q.busy} failed={q.failed} onSubmit={save}>
      <When title={`Gilt ab ${longDay(notice)}`}>Alle Punkte davor verfallen nie.{inForce !== null && " Das kannst du nicht zurücknehmen."} {SEES_TODAY}</When>
      <LinePreview program={program} line={expiryChangeLine(notice, months)} />
    </QuestionForm>
  );
  return (
    <QuestionForm title="Wann verfallen Punkte?" busy={q.busy} failed={q.failed} action={stricter ? "Weiter" : "Speichern"}
      onSubmit={() => { if (value === saved) q.leave(); else if (stricter) step.open(); else save(); }}>
      <Choices name="points-expiry" label="Punkte verfallen" value={value} saved={saved} onChange={setValue}
        options={[{ value: "", label: "Nie", icon: X }, ...POINTS_EXPIRY_MONTHS.map(months => ({ value: String(months), label: `Nach ${months} Monaten`, icon: Hourglass }))]} />
      {stricter && <p className="ow-hint" data-later>Punkte, die ab dem {longDay(notice)} dazukommen, verfallen nach {months} Monaten. Alle Punkte davor verfallen nie.</p>}
      {/* The card warns EXPIRY_REMINDER_DAYS (30) days ahead. */}
      {value && <p className="ow-hint">30 Tage vor dem Verfall sehen Kunden einen Hinweis auf ihrer Karte.</p>}
    </QuestionForm>
  );
}
