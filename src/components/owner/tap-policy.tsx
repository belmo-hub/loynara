"use client";

import { useState } from "react";
import { postJson, type MeResponse } from "@/components/client-api";
import { useDirtyGuard } from "./owner-context";
import { SaveBar, type SaveState } from "./owner-ui";

type Mode = "disabled" | "automatic_fixed" | "staff_confirmed";
const MODES: Array<{ id: Mode; label: string; text: string }> = [
  { id: "disabled", label: "Aus", text: "Nur QR-Scan oder Kartencode an der Kasse." },
  { id: "staff_confirmed", label: "Mit Bestätigung", text: "Ein NFC-Tag öffnet die Karte, das Team bestätigt die Vergabe." },
  { id: "automatic_fixed", label: "Automatisch", text: "Ein Tap vergibt automatisch die feste Menge, mit Wartezeit zwischen zwei Taps." },
];

/** NFC policy for stamp programmes. A physical tag still needs separate, secure provisioning. */
export function TapPolicyCard({ me }: { me: MeResponse }) {
  const initial: Mode = me.tapMode ?? "disabled";
  const [saved, setSaved] = useState<{ mode: Mode; cooldown: string }>({ mode: initial, cooldown: me.tapCooldownSeconds ? String(me.tapCooldownSeconds) : "" });
  const [mode, setMode] = useState<Mode>(saved.mode);
  const [cooldown, setCooldown] = useState(saved.cooldown);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const stamp = me.programType === "stamp";
  const needsCooldown = mode !== "disabled";
  const cooldownNumber = Number(cooldown);
  const cooldownValid = !needsCooldown || (/^\d+$/.test(cooldown) && cooldownNumber >= 1);
  const changed = mode !== saved.mode || (needsCooldown && cooldown !== saved.cooldown);
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("tap-policy", changed);

  async function save() {
    if (!me.programId) return;
    setState("saving"); setError("");
    try {
      await postJson("/api/merchant/tap", { action: "policy", programId: me.programId, mode, cooldownSeconds: mode === "disabled" ? null : cooldownNumber });
      setSaved({ mode, cooldown: mode === "disabled" ? "" : cooldown }); setState("saved");
    } catch (cause) { setState("error"); setError(cause instanceof Error ? cause.message : "Die NFC-Regel konnte nicht gespeichert werden."); }
  }

  return (
    <section className="ow-card ow-stack" aria-labelledby="tap-title">
      <div><h2 id="tap-title">NFC-Tap (optional)</h2><p className="ow-muted" style={{ fontSize: 14, marginTop: 2 }}>{stamp ? "Für feste Stempelvergabe. Ein NFC-Tag muss separat mit eigenen Schlüsseln eingerichtet werden; diese Einstellung aktiviert noch keinen Tag. QR an der Kasse bleibt immer verfügbar." : "NFC-Tap ist nur für Stempelprogramme verfügbar, denn ein Tag kennt keinen Einkaufswert."}</p></div>
      <fieldset className="ow-group" disabled={!stamp}>
        <legend className="ow-sr">Vergabe nach NFC-Berührung</legend>
        <div className="ow-radio-cards">
          {MODES.map(item => <label key={item.id} className="ow-radio-card"><input type="radio" name="tap-mode" checked={mode === item.id} onChange={() => { setMode(item.id); if (state === "saved" || state === "error") setState("clean"); }} /><div><strong>{item.label}</strong><span>{item.text}</span></div></label>)}
        </div>
        {needsCooldown && <div className="ow-field"><label htmlFor="tap-cooldown">Wartezeit zwischen zwei Taps (Sekunden)</label><input id="tap-cooldown" className="ow-input" inputMode="numeric" style={{ maxWidth: 200 }} value={cooldown} onChange={event => setCooldown(event.target.value.replace(/[^0-9]/g, ""))} aria-invalid={!cooldownValid} /></div>}
      </fieldset>
      {stamp && <SaveBar state={shown} onSave={() => void save()} onDiscard={() => { setMode(saved.mode); setCooldown(saved.cooldown); setState("clean"); }} canSave={changed && cooldownValid} saveLabel="NFC-Regel speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : undefined} />}
    </section>
  );
}
