"use client";

import { useState } from "react";
import { postJson, type MeResponse } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "./owner-context";
import { SaveBar, type SaveState } from "./owner-ui";
import { HAPPY_HOUR_MAX_WINDOWS, happyHourProblem, happyHourSentence, type HappyHourWindow } from "@/lib/happy-hour";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
type Draft = { enabled: boolean; windows: HappyHourWindow[] };
const fromMe = (me: MeResponse): Draft => ({ enabled: me.happyHourEnabled ?? false, windows: me.happyHourWindows ?? [] });
const PROBLEM = { COUNT: `Höchstens ${HAPPY_HOUR_MAX_WINDOWS} Zeitfenster.`, SHAPE: "Wähle für jedes Zeitfenster mindestens einen Wochentag.", TIME: "Bitte Beginn und Ende angeben.", MIDNIGHT: "Das Ende muss nach dem Beginn liegen. Über Mitternacht geht noch nicht: teile das Fenster auf zwei Tage auf." };

/** Automatic double points at quiet times (points programmes with purchase amounts). The server checks every value again. */
export function HappyHourCard({ me, earningMode }: { me: MeResponse; earningMode?: string }) {
  const owner = useOwner();
  const [saved, setSaved] = useState<Draft>(() => fromMe(me));
  const [draft, setDraft] = useState<Draft>(saved);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const problem = happyHourProblem(draft.windows) ?? (draft.enabled && draft.windows.length === 0 ? "SHAPE" : null);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("happy-hour", changed);
  if (me.programType !== "points") return null;

  function edit(next: Draft) { setDraft(next); if (state === "saved" || state === "error") setState("clean"); }
  const setWindow = (index: number, patch: Partial<HappyHourWindow>) => edit({ ...draft, windows: draft.windows.map((w, i) => i === index ? { ...w, ...patch } : w) });
  const toggleDay = (index: number, day: number) => { const w = draft.windows[index]; setWindow(index, { days: w.days.includes(day) ? w.days.filter(d => d !== day) : [...w.days, day].sort() }); };

  async function save() {
    if (!me.programId) return;
    setState("saving"); setError("");
    try {
      await postJson("/api/merchant/program/happy-hour", { programId: me.programId, happyHourEnabled: draft.enabled, happyHourWindows: draft.windows });
      setSaved(draft); setState("saved"); void owner.refresh();
    } catch (cause) { setState("error"); setError(cause instanceof Error ? cause.message : "Die Einstellungen konnten nicht gespeichert werden."); }
  }

  return (
    <section className="ow-card ow-stack" aria-labelledby="happy-title">
      <div className="ow-card-head" style={{ marginBottom: 0 }}><div><h2 id="happy-title">Happy Hour</h2><p>Zu ruhigen Zeiten bekommen Gäste automatisch doppelte Punkte, nach Uhrzeit in {me.locationName}.</p></div></div>
      <label><input type="checkbox" role="switch" checked={draft.enabled} onChange={event => edit({ ...draft, enabled: event.target.checked })} /> Happy Hour ist {draft.enabled ? "an" : "aus"}</label>
      <p className="ow-hint">Gilt nur, wenn Punkte nach dem Einkaufsbetrag vergeben werden{earningMode === "purchase" ? "" : " (bei euch derzeit nicht der Fall)"}, und nicht für Buchungen, die offline erfasst und später übertragen wurden.</p>
      {draft.windows.map((w, index) => (
        <fieldset key={index} className="ow-stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>Zeitfenster {index + 1}</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {DAYS.map((name, d) => <label key={name}><input type="checkbox" checked={w.days.includes(d + 1)} onChange={() => toggleDay(index, d + 1)} /> {name}</label>)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <label>von <input className="ow-input" type="time" value={w.start} onChange={event => setWindow(index, { start: event.target.value })} /></label>
            <label>bis <input className="ow-input" type="time" value={w.end} onChange={event => setWindow(index, { end: event.target.value })} /></label>
            <button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={() => edit({ ...draft, windows: draft.windows.filter((_, i) => i !== index) })}>Entfernen</button>
          </div>
          {happyHourProblem([w]) === null && <p className="ow-hint">{happyHourSentence(w)}</p>}
        </fieldset>
      ))}
      {draft.windows.length < HAPPY_HOUR_MAX_WINDOWS && <div><button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={() => edit({ ...draft, windows: [...draft.windows, { days: [1, 2, 3, 4, 5], start: "14:00", end: "17:00" }] })}>Zeitfenster hinzufügen</button></div>}
      {problem && <p className="ow-error">{PROBLEM[problem]}</p>}
      <SaveBar state={shown} onSave={() => void save()} onDiscard={() => { setDraft(saved); setState("clean"); }} canSave={changed && !problem} saveLabel="Speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : undefined} />
    </section>
  );
}
