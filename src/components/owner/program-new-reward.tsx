"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { ClientApiError, postJson, type PublicProgram } from "@/components/client-api";
import { useDirtyGuard } from "./owner-context";
import { GuardedLink } from "./owner-shell";
import { CardLinePreview, nf, Notice, NumberStepper, OwnerIcon } from "./owner-ui";
import { minimumSpendText, otherRewardsHint, parseWholeNumber, REWARD_NAME_MISSING, SHORT_NAME, unitDative, unitName, WHOLE_NUMBER } from "./program-helpers";

const TITLE_MAX = 180, COST_MAX = 100_000; // the server's limits for a reward's name and threshold

/** „Prämie hinzufügen“ (ENG-099, screens 05–07): the name, the threshold, then the card preview and „Prämie speichern“. */
export function NewReward({ slug, program, onSaved }: { slug: string; program: PublicProgram; onSaved: (rewardId: string) => void }) {
  const type = program.programType, points = type === "points";
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  // Above the highest threshold, so a tap on „Weiter“ never doubles a reward: stamps by one, points by ten on the tens
  // (250 → 260). Without a reward yet: 10 Stempel or 100 Punkte.
  const [cost, setCost] = useState(() => {
    const top = Math.max(0, ...program.rewards.map(reward => reward.cost));
    return String(Math.min(points ? (top ? Math.ceil((top + 10) / 10) * 10 : 100) : top ? top + 1 : 10, COST_MAX));
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null), fail = useRef<HTMLDivElement>(null), shownStep = useRef(step);
  const name = title.trim(), amount = parseWholeNumber(cost);
  const reach = name.length < 2 ? 1 : amount === null ? 2 : 3; // the furthest step the input allows
  // The server takes names from 2 characters on (rewards route).
  const problem = step === 1 && !name ? REWARD_NAME_MISSING : step === 1 && reach < 2 ? SHORT_NAME : step === 2 && reach < 3 ? WHOLE_NUMBER : "";
  const field = step === 1 ? "new-reward-name" : "new-reward-cost";
  const shown = tried && problem;
  const others = otherRewardsHint(type, program.rewards.map(reward => reward.cost));
  const spend = points && program.earningMode === "purchase" && amount !== null ? minimumSpendText(amount, program.pointsPerCurrencyUnit, program.currency) : null;
  // While saving the guard is off: the reward is created either way and the list opens next.
  useDirtyGuard("program-new-reward", !busy && Boolean(name));

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
      // Rewards carry no conditions any more (ENG-115): what customers must know goes into the name.
      const { rewardId } = await postJson<{ rewardId: string }>("/api/merchant/program/rewards", { programSlug: slug, action: "create", title: name, cost: amount });
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
        {/* No „Schritt n von 3“ line above the question (Design's finish review): the bar carries the step. */}
        <div id="new-reward-step" className="ow-qstep" role="img" aria-label={`Schritt ${step} von 3`}><span className="ow-qbar" aria-hidden="true">{[1, 2, 3].map(n => <i key={n} data-on={n <= step || undefined} />)}</span></div>
        <h1 ref={heading} tabIndex={-1} aria-describedby="new-reward-step">{step === 1 ? "Wie heißt die neue Prämie?" : step === 2 ? `${name}: ab wie vielen ${unitDative(type)}?` : "Passt das so?"}</h1>
      </div></header>
      <form className="ow-q" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
        {step === 1 && <div className="ow-field ow-qpanel">
          <label htmlFor="new-reward-name">Name der Prämie</label>
          <input id="new-reward-name" className="ow-input" value={title} maxLength={TITLE_MAX} enterKeyHint="next" autoComplete="off" onChange={event => setTitle(event.target.value)}
            aria-invalid={Boolean(shown)} aria-describedby={shown ? "new-reward-name-error new-reward-name-hint" : "new-reward-name-hint"} />
          {fieldError}
          <p className="ow-qcount"><span id="new-reward-name-hint">So steht es auf der Karte und an der Kasse. Was Kunden wissen müssen, gehört in den Namen, z.&nbsp;B. „Gratisgetränk 0,3&nbsp;l“.</span><span>{title.length}/{TITLE_MAX}</span></p>
        </div>}
        {/* Points move in tens, so their number looks like the field it is: other values are typed. */}
        {step === 2 && <div className="ow-qnumber" data-typed={points || undefined}>
          <label htmlFor="new-reward-cost" className="ow-sr">Einlösbar ab</label>
          <NumberStepper id="new-reward-cost" value={cost} onChange={value => setCost(value && String(Math.min(Number(value), COST_MAX)))} min={1} max={COST_MAX} stepSize={points ? 10 : 1}
            unit={{ one: unitName(type, 1), many: unitName(type) }} invalid={Boolean(shown)} describedBy={[shown && "new-reward-cost-error", (others || spend) && "new-reward-cost-hint"].filter(Boolean).join(" ") || undefined} />
          {fieldError}
          {(others || spend) && <p id="new-reward-cost-hint" className="ow-hint">{others}{others && spend && <br />}{spend}</p>}
        </div>}
        {step === 3 && amount !== null && <>
          <div className="ow-qpanel">
            <CardLinePreview label="So steht es auf der Karte" shop={program.businessName} brandColor={program.brandColor}>
              {[...program.rewards, { rewardId: "", title: name, cost: amount }].map(reward => (
                <span key={reward.rewardId} className="ow-cardline-reward" data-new={!reward.rewardId || undefined}><b>{reward.title}</b><span>{nf.format(reward.cost)} {unitName(type, reward.cost)}</span></span>
              ))}
            </CardLinePreview>
          </div>
          <p className="ow-hint">Gilt ab dem Speichern für alle Karten.</p>
          {error && <div ref={fail} className="ow-qfail"><Notice tone="danger" role="alert"><strong>Speichern fehlgeschlagen</strong>{error} Deine Eingaben sind noch da.</Notice></div>}
        </>}
        {/* Not disabled while saving: the button keeps the focus, and a second tap does nothing (`busy`). */}
        <div className="ow-qsave"><button type="submit" className="ow-btn ow-btn--primary" aria-busy={busy}>{step < 3 ? "Weiter" : busy ? "Speichern …" : "Prämie speichern"}</button></div>
      </form>
    </div>
  );
}
