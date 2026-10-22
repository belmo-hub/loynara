"use client";

import { useState } from "react";
import { postJson } from "@/components/client-api";
import { useDirtyGuard } from "./owner-context";
import { SaveBar, type SaveState } from "./owner-ui";
import { WINBACK_DAYS, winbackRule, winbackText } from "@/lib/wallet-message-rules";

export type Winback = { enabled: boolean; days: number; bonus: number; bonusMax: number; type: "stamp" | "points" };
type Draft = { enabled: boolean; days: string; bonus: string };
const fromSaved = (w: Winback): Draft => ({ enabled: w.enabled, days: String(w.days), bonus: String(w.bonus) });

/** „Kunden zurückholen“ (ENG-044): the owner picks N and the bonus; the text is fixed. The server checks every value again. */
export function WinbackCard({ slug, initial }: { slug: string; initial: Winback }) {
  const [saved, setSaved] = useState<Draft>(() => fromSaved(initial));
  const [draft, setDraft] = useState<Draft>(saved);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const days = Number(draft.days), bonus = Number(draft.bonus);
  const daysValid = /^\d+$/.test(draft.days) && days >= WINBACK_DAYS.min && days <= WINBACK_DAYS.max;
  const bonusValid = /^\d+$/.test(draft.bonus) && bonus <= initial.bonusMax;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("winback", changed);
  const edit = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); if (state === "saved" || state === "error") setState("clean"); };

  async function save() {
    setState("saving"); setError("");
    try {
      await postJson("/api/merchant/wallet-messages", { programSlug: slug, winback: { enabled: draft.enabled, days, bonus } });
      setSaved(draft); setState("saved");
    } catch (cause) { setState("error"); setError(cause instanceof Error ? cause.message : "Die Einstellungen konnten nicht gespeichert werden."); }
  }

  return (
    <section className="ow-card ow-stack" aria-labelledby="winback-title">
      <h2 id="winback-title">Kunden zurückholen</h2>
      <label><input type="checkbox" role="switch" checked={draft.enabled} onChange={event => edit({ enabled: event.target.checked })} /> Eingeschaltet</label>
      <div className="ow-field">
        <label htmlFor="winback-days">Erinnerung nach … Tagen ohne Besuch ({WINBACK_DAYS.min}–{WINBACK_DAYS.max})</label>
        <input id="winback-days" className="ow-input" inputMode="numeric" style={{ maxWidth: 120 }} value={draft.days} aria-invalid={!daysValid} onChange={event => edit({ days: event.target.value.replace(/[^0-9]/g, "") })} />
      </div>
      {initial.type === "stamp"
        ? <fieldset className="ow-stack" style={{ border: 0, padding: 0, margin: 0 }}><legend>Bonus</legend>
          <label><input type="radio" name="winback-bonus" checked={bonus === 0} onChange={() => edit({ bonus: "0" })} /> Kein Bonus</label>
          <label><input type="radio" name="winback-bonus" checked={bonus === 1} onChange={() => edit({ bonus: "1" })} /> +1 Stempel</label>
        </fieldset>
        : <div className="ow-field">
          <label htmlFor="winback-bonus">Bonus in Punkten (0 = kein Bonus)</label>
          <input id="winback-bonus" className="ow-input" inputMode="numeric" style={{ maxWidth: 120 }} value={draft.bonus} aria-invalid={!bonusValid} aria-describedby="winback-bonus-hint" onChange={event => edit({ bonus: event.target.value.replace(/[^0-9]/g, "") })} />
          <p id="winback-bonus-hint" className="ow-hint">1 bis {initial.bonusMax} Punkte: höchstens ein Viertel deiner günstigsten Prämie.</p>
        </div>}
      <p className="ow-hint">Wer {daysValid ? days : "[N]"} Tage nicht da war und in den 14 Tagen danach wiederkommt, bekommt den Bonus; er wird beim Bestätigen des Besuchs mitgebucht. Kundinnen und Kunden mit Wallet-Nachrichten bekommen dazu einmal eine Erinnerung, montags bis samstags zwischen 10 und 18 Uhr.</p>
      <div className="ow-card" role="group" aria-label="Vorschau der Erinnerung"><p>{winbackText(initial.type, bonusValid ? bonus : 0, "[Datum]")}</p></div>
      {bonusValid && bonus > 0 && <p className="ow-hint">Steht auf der Karte: {winbackRule(initial.type, daysValid ? days : WINBACK_DAYS.default, bonus)}</p>}
      <SaveBar state={shown} onSave={() => void save()} onDiscard={() => { setDraft(saved); setState("clean"); }} canSave={changed && daysValid && bonusValid} saveLabel="Speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : undefined} />
    </section>
  );
}
