"use client";

import { useState } from "react";
import { apiJson, postJson, type MeResponse, type PublicProgram } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "./owner-context";
import { Notice, OwnerDialog, SaveBar, type SaveState } from "./owner-ui";
import { confirmSentence, earningSentence, euro, MAX_POINTS_PER_CURRENCY_UNIT, minimumSpendMinor, MIN_SPEND_LABEL, NO_MIN_SPEND_LABEL, purchaseExample, unitName, type EarningMode, type ProgramKind } from "./program-helpers";

type Draft = { name: string; type: ProgramKind; mode: EarningMode; rate: string; rulesText: string };
const fromProgram = (program: PublicProgram): Draft => ({ name: program.programName, type: program.programType, mode: program.earningMode ?? "manual", rate: String(program.pointsPerCurrencyUnit ?? 1), rulesText: program.rulesText });

export function RuleCard({ me, program, onSaved }: { me: MeResponse; program: PublicProgram; onSaved: (program: PublicProgram) => void }) {
  const owner = useOwner();
  const [baseline, setBaseline] = useState<Draft>(() => fromProgram(program));
  const [draft, setDraft] = useState<Draft>(baseline);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [amount, setAmount] = useState("");
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const typeLocked = Boolean(me.stats && me.stats.awards + me.stats.redemptions > 0);

  const rate = Number(draft.rate);
  const rateValid = draft.type !== "points" || draft.mode !== "purchase" || (Number.isInteger(rate) && rate >= 1 && rate <= MAX_POINTS_PER_CURRENCY_UNIT);
  const mode: EarningMode = draft.type === "stamp" ? "manual" : draft.mode;
  const nameValid = draft.name.trim().length >= 2;
  const rulesValid = draft.rulesText.trim().length >= 10;
  const valid = nameValid && rulesValid && rateValid;
  const changed = draft.name !== baseline.name || draft.type !== baseline.type || mode !== baseline.mode || (mode === "purchase" && draft.rate !== baseline.rate) || draft.rulesText !== baseline.rulesText;
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("program-rules", changed);

  const currency = program.currency;
  const cheapest = [...program.rewards].sort((a, b) => a.cost - b.cost)[0];
  const example = draft.type === "points" && mode === "purchase" ? purchaseExample(amount, rate) : null;
  const minSpend = draft.type === "points" && mode === "purchase" && cheapest && rateValid ? minimumSpendMinor(cheapest.cost, rate) : null;

  function edit(patch: Partial<Draft>) { setDraft(current => ({ ...current, ...patch })); setJustSaved(false); if (state === "saved" || state === "error") { setState("clean"); setError(""); } }

  const changes: Array<{ label: string; from: string; to: string }> = [];
  if (draft.name !== baseline.name) changes.push({ label: "Programmname", from: baseline.name, to: draft.name.trim() });
  if (draft.type !== baseline.type) changes.push({ label: "Programmart", from: baseline.type === "stamp" ? "Stempelkarte" : "Punktekarte", to: draft.type === "stamp" ? "Stempelkarte" : "Punktekarte" });
  if (mode !== baseline.mode || (mode === "purchase" && draft.rate !== baseline.rate) || draft.type !== baseline.type) {
    const before = earningSentence(baseline.type, baseline.mode, Number(baseline.rate), currency);
    const after = earningSentence(draft.type, mode, rate, currency);
    if (before !== after) changes.push({ label: "So wird gesammelt", from: before, to: after });
  }
  if (draft.rulesText !== baseline.rulesText) changes.push({ label: "Regeltext für Kunden", from: "Bisheriger Text", to: "Neuer Text" });

  async function save() {
    setReviewing(false); setState("saving"); setError("");
    try {
      await postJson("/api/merchant/program/update", { programSlug: me.programSlug, name: draft.name.trim(), programType: draft.type, earningMode: mode, pointsPerCurrencyUnit: draft.type === "points" && mode === "purchase" ? rate : (program.pointsPerCurrencyUnit ?? 1), rulesText: draft.rulesText.trim() });
      const updated = await apiJson<PublicProgram>(`/api/program/${encodeURIComponent(me.programSlug)}`);
      const next = fromProgram(updated);
      setBaseline(next); setDraft(next); setState("saved"); setEditing(false); setJustSaved(true); onSaved(updated);
      owner.announce("Neue Regelversion gespeichert."); void owner.refresh();
    } catch (cause) {
      setState("error"); setError(cause instanceof Error ? cause.message : "Die Regel konnte nicht gespeichert werden."); owner.announce("Speichern fehlgeschlagen.");
    }
  }

  return (
    <section className="ow-card ow-stack" aria-labelledby="rule-title" style={{ gap: 20 }}>
      <div className="ow-card-head" style={{ marginBottom: 0 }}>
        <div><h2 id="rule-title">So sammeln Kunden</h2><p>{earningSentence(baseline.type, baseline.mode, Number(baseline.rate), currency)}</p></div>
        <span className="ow-chip ow-chip--ok"><span className="ow-dot" aria-hidden="true" />Aktiv</span>
      </div>
      <div className="ow-readonly"><strong style={{ display: "block", marginBottom: 2 }}>Wer bestätigt?</strong>{confirmSentence(baseline.type, baseline.mode)}</div>
      {!editing && (
        <div className="ow-stack" style={{ gap: 12 }}>
          <div><span className="ow-label">Regeltext für Kunden</span><p className="ow-muted" style={{ marginTop: 2 }}>{baseline.rulesText.length > 280 ? `${baseline.rulesText.slice(0, 280)} …` : baseline.rulesText}</p></div>
          {justSaved && <div role="status"><Notice tone="ok">Neue Regelversion gespeichert. Sie gilt für neue Buchungen.</Notice></div>}
          <div><button type="button" className="ow-btn ow-btn--secondary" onClick={() => { setEditing(true); setJustSaved(false); }}>Regel ändern</button></div>
        </div>
      )}
      {editing && <>
      <div className="ow-two" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)" }}>
        <div className="ow-stack">
          <div className="ow-field"><label htmlFor="rule-name">Programmname</label><input id="rule-name" className="ow-input" value={draft.name} maxLength={180} onChange={event => edit({ name: event.target.value })} aria-invalid={!nameValid} /></div>
          <fieldset className="ow-group">
            <legend>Programmart</legend>
            <div className="ow-radio-cards ow-radio-cards--row">
              {(["stamp", "points"] as const).map(type => (
                <label key={type} className="ow-radio-card"><input type="radio" name="rule-type" checked={draft.type === type} disabled={typeLocked && draft.type !== type} onChange={() => edit({ type, mode: type === "stamp" ? "manual" : draft.mode })} /><div><strong>{type === "stamp" ? "Stempelkarte" : "Punktekarte"}</strong><span>{type === "stamp" ? "Ganze Stempel, vergeben an der Kasse." : "Punkte nach Betrag oder manuell."}</span></div></label>
              ))}
            </div>
            {typeLocked && <span className="ow-hint">Die Programmart lässt sich nach den ersten Buchungen nicht mehr ändern.</span>}
          </fieldset>
          {draft.type === "points" && (
            <fieldset className="ow-group">
              <legend>So entstehen Punkte</legend>
              <div className="ow-radio-cards ow-radio-cards--row">
                <label className="ow-radio-card"><input type="radio" name="rule-mode" checked={mode === "purchase"} onChange={() => edit({ mode: "purchase" })} /><div><strong>Nach Einkaufswert</strong><span>Das Team gibt den Betrag ein, das System rechnet und rundet ab.</span></div></label>
                <label className="ow-radio-card"><input type="radio" name="rule-mode" checked={mode === "manual"} onChange={() => edit({ mode: "manual" })} /><div><strong>Manuell</strong><span>Das Team gibt die Punktmenge direkt ein.</span></div></label>
              </div>
              {mode === "purchase" && <div className="ow-field"><label htmlFor="rule-rate">Punkte pro 1 {currency === "EUR" ? "€" : currency}</label><input id="rule-rate" className="ow-input" inputMode="numeric" value={draft.rate} onChange={event => edit({ rate: event.target.value.replace(/[^0-9]/g, "") })} aria-invalid={!rateValid} /><span className="ow-hint">Ganze Zahl von 1 bis {MAX_POINTS_PER_CURRENCY_UNIT}.</span></div>}
            </fieldset>
          )}
          <div className="ow-field"><label htmlFor="rule-text">Regeltext für Kunden</label><textarea id="rule-text" className="ow-textarea" value={draft.rulesText} maxLength={3000} onChange={event => edit({ rulesText: event.target.value })} aria-invalid={!rulesValid} aria-describedby="rule-text-hint" /><span id="rule-text-hint" className="ow-hint">Wird Kunden bei der Anmeldung und auf der Karte gezeigt. Mindestens 10 Zeichen.</span></div>
        </div>

        <aside className="ow-card ow-card--flat ow-stack" aria-labelledby="ex-title" style={{ background: "var(--color-fill)", alignSelf: "start" }}>
          <div><h3 id="ex-title" style={{ fontSize: 16 }}>Beispiel durchspielen</h3><p className="ow-hint">Rechnet mit derselben Formel wie der Server.</p></div>
          {example ? (
            <>
              <div className="ow-field"><label htmlFor="ex-amount">Einkaufswert in {currency === "EUR" ? "€" : currency}</label><input id="ex-amount" className="ow-input" inputMode="decimal" placeholder="z. B. 12,90" value={amount} onChange={event => setAmount(event.target.value)} aria-describedby="ex-result" /></div>
              <div id="ex-result" role="status" aria-live="polite">
                {example.ok ? <p><strong className="ow-num">{euro(example.amountMinor, currency)}</strong> ergeben <strong className="ow-num">{example.points} {unitName("points", example.points)}</strong>.</p> : example.message ? <p className="ow-error">{example.message}</p> : <p className="ow-muted">Gib einen Betrag ein, um das Ergebnis zu sehen.</p>}
              </div>
            </>
          ) : draft.type === "stamp" ? (
            <p>Dein Team vergibt an der Kasse Stempel, meist einen pro Besuch. {cheapest ? `Nach ${cheapest.cost} Stempeln ist „${cheapest.title}“ erreichbar.` : ""}</p>
          ) : (
            <p>Dein Team gibt die Punkte direkt ein. {cheapest ? `Ab ${cheapest.cost} Punkten ist „${cheapest.title}“ erreichbar.` : ""}</p>
          )}
          <p className="ow-hint">{minSpend !== null && cheapest ? <>Günstigste Prämie „{cheapest.title}“: mindestens <strong>{euro(minSpend, currency)}</strong> Einkaufswert. {MIN_SPEND_LABEL}</> : NO_MIN_SPEND_LABEL + ". " + (draft.type === "stamp" || mode === "manual" ? "Die Menge legt das Team bei der Vergabe fest." : "")}</p>
        </aside>
      </div>
      {shown === "dirty" && <Notice tone="info">Die Änderung gilt ab dem Speichern als neue Regelversion für neue Buchungen. Bestehende Kartenstände werden nicht neu berechnet.</Notice>}
      <SaveBar state={shown} onSave={() => setReviewing(true)} onDiscard={() => { setDraft(baseline); setState("clean"); setError(""); setEditing(false); }} alwaysDiscard discardLabel={changed ? "Verwerfen" : "Schließen"} canSave={valid && changed} saveLabel="Änderungen prüfen" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : shown === "dirty" && !valid ? "Bitte Eingaben prüfen." : undefined} />
      </>}
      {reviewing && (
        <OwnerDialog title="Regeländerung prüfen" onClose={() => setReviewing(false)} actions={<><button type="button" className="ow-btn ow-btn--secondary" onClick={() => setReviewing(false)} data-autofocus>Zurück</button><button type="button" className="ow-btn ow-btn--primary" onClick={() => void save()}>Neue Regelversion speichern</button></>}>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>{changes.map(change => <li key={change.label}><strong>{change.label}:</strong> {change.from} → {change.to}</li>)}</ul>
          <p>Gilt ab dem Speichern für neue Buchungen. Bestehende Kartenstände werden nicht neu berechnet.</p>
        </OwnerDialog>
      )}
    </section>
  );
}
