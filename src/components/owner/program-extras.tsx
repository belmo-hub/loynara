"use client";

import { useState } from "react";
import { postJson, type MeResponse } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "./owner-context";
import { SaveBar, type SaveState } from "./owner-ui";

type Draft = { welcomeBonus: string };
const fromMe = (me: MeResponse): Draft => ({ welcomeBonus: String(me.welcomeBonus ?? 0) });

/** Programme extras the owner sets outside the versioned earning rule. The server checks every value again. */
export function ProgramExtrasCard({ me }: { me: MeResponse }) {
  const owner = useOwner();
  const [saved, setSaved] = useState<Draft>(() => fromMe(me));
  const [draft, setDraft] = useState<Draft>(saved);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const stamp = me.programType === "stamp";
  const maxBonus = stamp ? 3 : 50;
  const bonus = Number(draft.welcomeBonus);
  const bonusValid = /^\d+$/.test(draft.welcomeBonus) && bonus <= maxBonus;
  const changed = draft.welcomeBonus !== saved.welcomeBonus;
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("program-extras", changed);

  function edit(patch: Partial<Draft>) { setDraft(current => ({ ...current, ...patch })); if (state === "saved" || state === "error") setState("clean"); }

  async function save() {
    if (!me.programId) return;
    setState("saving"); setError("");
    try {
      await postJson("/api/merchant/program/extras", { programId: me.programId, welcomeBonus: bonus });
      setSaved(draft); setState("saved"); void owner.refresh();
    } catch (cause) { setState("error"); setError(cause instanceof Error ? cause.message : "Die Einstellungen konnten nicht gespeichert werden."); }
  }

  return (
    <section className="ow-card ow-stack" aria-labelledby="extras-title">
      <div className="ow-card-head" style={{ marginBottom: 0 }}><div><h2 id="extras-title">Auf der Kundenkarte</h2><p>Kleine Extras für neue und wiederkommende Gäste.</p></div></div>
      <div className="ow-field">
        <label htmlFor="extras-bonus">Startbonus ({stamp ? "Stempel" : "Punkte"})</label>
        <input id="extras-bonus" className="ow-input" inputMode="numeric" style={{ maxWidth: 200 }} value={draft.welcomeBonus} onChange={event => edit({ welcomeBonus: event.target.value.replace(/[^0-9]/g, "") })} aria-invalid={!bonusValid} aria-describedby="extras-bonus-hint" />
        <span id="extras-bonus-hint" className="ow-hint">Wird einmal pro Karte zusammen mit dem ersten bestätigten Besuch gutgeschrieben. 0 bis {maxBonus}, 0 = aus.</span>
      </div>
      <SaveBar state={shown} onSave={() => void save()} onDiscard={() => { setDraft(saved); setState("clean"); }} canSave={changed && bonusValid} saveLabel="Speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : undefined} />
    </section>
  );
}
