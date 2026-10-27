"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { ClientApiError, postJson, type PublicProgram } from "@/components/client-api";
import { useDirtyGuard } from "./owner-context";
import { GuardedLink } from "./owner-shell";
import { CardLinePreview, nf, Notice, NumberStepper, OwnerIcon } from "./owner-ui";
import { otherRewardsHint, parseWholeNumber, unitDative, unitName } from "./program-helpers";

const TITLE_MAX = 180, COST_MAX = 100_000; // the server's limits for a reward's name and threshold

/** „Prämie hinzufügen“ (ENG-099, screens 05–07): the name, the threshold, then the card preview and „Prämie speichern“. */
export function NewReward({ slug, program, onSaved }: { slug: string; program: PublicProgram; onSaved: (rewardId: string) => void }) {
  const type = program.programType;
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  // One above the highest threshold, so a tap on „Weiter“ never doubles an existing reward; the hint names them all.
  const [cost, setCost] = useState(() => { const top = Math.max(0, ...program.rewards.map(reward => reward.cost)); return top ? String(Math.min(top + 1, COST_MAX)) : ""; });
  const [terms, setTerms] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null), fail = useRef<HTMLDivElement>(null), shownStep = useRef(step);
  const name = title.trim(), amount = parseWholeNumber(cost);
  const reach = name.length < 2 ? 1 : amount === null ? 2 : 3; // the furthest step the input allows
  const problem = step === 1 && reach < 2 ? "Bitte die Prämie benennen." : step === 2 && reach < 3 ? "Bitte eine ganze Zahl größer 0 eingeben." : "";
  const field = step === 1 ? "new-reward-name" : "new-reward-cost";
  const shown = tried && problem;
  const hint = otherRewardsHint(type, program.rewards.map(reward => reward.cost));
  // While saving the guard is off: the reward is created either way and the list opens next.
  useDirtyGuard("program-new-reward", !busy && Boolean(name || terms.trim()));

  // Each step is an entry in this page's history, so Back and the phone's back gesture go one step back, input kept.
  useEffect(() => { window.history.replaceState({ ...window.history.state, rewardStep: 1 }, ""); }, []);
  useEffect(() => {
    const onPop = (event: PopStateEvent) => { setStep(Math.min(Number(event.state?.rewardStep) || 1, reach)); setTried(false); setError(""); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [reach]);
  useEffect(() => { if (shownStep.current !== step) { shownStep.current = step; heading.current?.focus(); } }, [step]);

  async function submit() {
    if (step < 3) {
      if (problem) { setTried(true); document.getElementById(field)?.focus(); return; }
      window.history.pushState({ rewardStep: step + 1 }, "");
      setStep(step + 1); setTried(false);
      return;
    }
    if (busy || amount === null) return;
    setBusy(true); setError("");
    try {
      const { rewardId } = await postJson<{ rewardId: string }>("/api/merchant/program/rewards", { programSlug: slug, action: "create", title: name, cost: amount, termsText: terms.trim() });
      onSaved(rewardId);
    } catch (cause) {
      // Server diagnostics stay off the page; a lost connection or a rate limit already says what to do (client-api).
      setError(cause instanceof ClientApiError && (cause.status === 0 || cause.status === 429) ? cause.message : "Die Prämie konnte nicht gespeichert werden.");
      setBusy(false);
      requestAnimationFrame(() => fail.current?.scrollIntoView({ block: "nearest" }));
    }
  }
  const fieldError = shown && <p id={`${field}-error`} className="ow-error ow-qerror" role="alert"><OwnerIcon name="alert" size={18} />{problem}</p>;

  return (
    <div className="ow-page ow-qpage">
      <header className="ow-pagehead"><div className="ow-qhead">
        {step === 1
          ? <GuardedLink href="/merchant/program" className="ow-back"><ChevronLeft size={20} aria-hidden="true" />Programm</GuardedLink>
          : <button type="button" className="ow-back" onClick={() => window.history.back()}><ChevronLeft size={20} aria-hidden="true" />Zurück</button>}
        <div id="new-reward-step" className="ow-qstep"><span className="ow-qbar" aria-hidden="true">{[1, 2, 3].map(n => <i key={n} data-on={n <= step || undefined} />)}</span>Schritt {step} von 3</div>
        <h1 ref={heading} tabIndex={-1} aria-describedby="new-reward-step">{step === 1 ? "Wie heißt die neue Prämie?" : step === 2 ? `${name}: ab wie vielen ${unitDative(type)}?` : "Passt das so?"}</h1>
      </div></header>
      <form className="ow-q" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
        {step === 1 && <div className="ow-field ow-qpanel">
          <label htmlFor="new-reward-name">Name der Prämie</label>
          <input id="new-reward-name" className="ow-input" value={title} maxLength={TITLE_MAX} enterKeyHint="next" autoComplete="off" onChange={event => setTitle(event.target.value)}
            aria-invalid={Boolean(shown)} aria-describedby={shown ? "new-reward-name-error new-reward-name-hint" : "new-reward-name-hint"} />
          {fieldError}
          <p className="ow-qcount"><span id="new-reward-name-hint">So steht es auf der Karte und an der Kasse.</span><span>{title.length}/{TITLE_MAX}</span></p>
        </div>}
        {step === 2 && <div className="ow-qnumber">
          <label htmlFor="new-reward-cost" className="ow-sr">Einlösbar ab</label>
          <NumberStepper id="new-reward-cost" value={cost} onChange={value => setCost(value && String(Math.min(Number(value), COST_MAX)))} min={1} max={COST_MAX}
            unit={{ one: unitName(type, 1), many: unitName(type) }} invalid={Boolean(shown)} describedBy={[shown && "new-reward-cost-error", hint && "new-reward-cost-hint"].filter(Boolean).join(" ") || undefined} />
          {fieldError}
          {hint && <p id="new-reward-cost-hint" className="ow-hint">{hint}</p>}
        </div>}
        {step === 3 && amount !== null && <>
          <div className="ow-qpanel">
            <CardLinePreview label="So steht es auf der Karte" shop={program.businessName} brandColor={program.brandColor}>
              {[...program.rewards, { rewardId: "", title: name, cost: amount }].map(reward => (
                <span key={reward.rewardId} className="ow-cardline-reward" data-new={!reward.rewardId || undefined}><b>{reward.title}</b><span>{nf.format(reward.cost)} {unitName(type, reward.cost)}</span></span>
              ))}
            </CardLinePreview>
          </div>
          <div className="ow-field ow-qpanel">
            <label htmlFor="new-reward-terms">Bedingungen (optional)</label>
            <textarea id="new-reward-terms" className="ow-textarea" rows={1} maxLength={3000} value={terms} onChange={event => setTerms(event.target.value)} placeholder="z. B. Nur am Wochenende" />
          </div>
          {error && <div ref={fail} className="ow-qfail"><Notice tone="danger" role="alert"><strong>Speichern fehlgeschlagen</strong>{error} Deine Eingaben sind noch da.</Notice></div>}
        </>}
        {/* Not disabled while saving: the button keeps the focus, and a second tap does nothing (`busy`). */}
        <div className="ow-qsave"><button type="submit" className="ow-btn ow-btn--primary" aria-busy={busy}>{step < 3 ? "Weiter" : busy ? "Speichern …" : "Prämie speichern"}</button></div>
      </form>
    </div>
  );
}
