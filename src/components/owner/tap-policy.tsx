"use client";

import { useState } from "react";
import { postJson, type MeResponse } from "@/components/client-api";
import { useDirtyGuard } from "./owner-context";
import { SaveBar, type SaveState } from "./owner-ui";
import { useLoad } from "./use-load";
import { tapModesFor, type TapMode as Mode } from "./tap-modes";

const ALL_MODES: Array<{ id: Mode; label: string; text: string }> = [
  { id: "disabled", label: "Aus", text: "Nur QR-Scan oder Kartencode an der Kasse." },
  { id: "staff_confirmed", label: "Mit Bestätigung", text: "Ein NFC-Tag öffnet die Karte, das Team bestätigt die Vergabe." },
  { id: "automatic_fixed", label: "Automatisch", text: "Ein Tap vergibt automatisch die feste Menge, mit Wartezeit zwischen zwei Taps." },
];

type TagStatus = { capability: { available: boolean; reason?: string }; tags: Array<{ id: string; status: string; activatedAt: string | null; everTapped: boolean }> };

/** What is actually in place for this programme, so the setting never promises more than the shop can do today. */
function Readiness({ status, mode }: { status: TagStatus; mode: Mode }) {
  const active = status.tags.filter(tag => tag.status === "active");
  const provisioned = status.tags.filter(tag => tag.status === "provisioned");
  const line = active.length > 0
    ? `${active.length} aktive${active.length === 1 ? "s" : ""} NFC-Schild${active.length === 1 ? "" : "er"}${active.some(tag => tag.everTapped) ? ", bereits benutzt" : ", noch nicht berührt"}.`
    : provisioned.length > 0 ? "Ein Schild ist angelegt, aber noch nicht freigeschaltet." : "Noch kein NFC-Schild eingerichtet. Loynara richtet das Schild gemeinsam mit dir ein.";
  const note = active.length > 0 && mode === "disabled" ? "Berührungen werden ignoriert, solange NFC aus ist." : active.length === 0 && mode !== "disabled" ? "Kundinnen und Kunden können erst berühren, wenn ein aktives Schild vorhanden ist." : null;
  return <div className="ow-readonly" role="status"><strong>Bereitschaft</strong><br />{line}{note && <><br /><span className="ow-muted">{note}</span></>}</div>;
}

const AUTOMATIC_NOTE = "Im Pilotbetrieb nicht verfügbar.";

/** NFC policy for the programme. A physical tag still needs separate, secure provisioning. */
export function TapPolicyCard({ me }: { me: MeResponse }) {
  const initial: Mode = me.tapMode ?? "disabled";
  const [saved, setSaved] = useState<{ mode: Mode; cooldown: string }>({ mode: initial, cooldown: me.tapCooldownSeconds ? String(me.tapCooldownSeconds) : "" });
  const [mode, setMode] = useState<Mode>(saved.mode);
  const [cooldown, setCooldown] = useState(saved.cooldown);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const stamp = me.programType === "stamp";
  const [tagStatus, reloadTags] = useLoad<TagStatus>(me.programId ? `/api/merchant/tap?programId=${me.programId}` : null);
  // Pilot policy: automatic awards are offered only where the server allows them (never on production), and only for
  // fixed stamps: points are always entered by the team. A missing flag counts as "not allowed". The server enforces both.
  const automaticAllowed = me.tapAutomaticAllowed === true && stamp;
  const MODES = tapModesFor(ALL_MODES, saved.mode, automaticAllowed);
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
      setSaved({ mode, cooldown: mode === "disabled" ? "" : cooldown }); setState("saved"); reloadTags();
    } catch (cause) { setState("error"); setError(cause instanceof Error ? cause.message : "Die NFC-Regel konnte nicht gespeichert werden."); }
  }

  const label = MODES.find(item => item.id === saved.mode)?.label ?? "Aus";
  return (
    <section className="ow-card ow-card--flat" aria-labelledby="tap-title">
      <details open={saved.mode !== "disabled" || changed || undefined}>
        <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontWeight: 700 }}><span id="tap-title">NFC-Tap (optional)</span><span className="ow-chip">{label}</span></summary>
        <div className="ow-stack" style={{ marginTop: 12 }}>
          <p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Kundinnen und Kunden berühren das NFC-Schild am Tresen, {stamp ? "das Team bestätigt jeden Stempel an der Kasse" : "das Team trägt die Punkte an der Kasse ein und bestätigt sie"}. Das Schild richtet Loynara für dich ein. Der QR-Code an der Kasse bleibt immer eine Alternative.</p>
          {tagStatus.state === "ok" && <Readiness status={tagStatus.data} mode={saved.mode} />}
          <fieldset className="ow-group">
            <legend className="ow-sr">Vergabe nach NFC-Berührung</legend>
            <div className="ow-radio-cards">
              {MODES.map(item => <label key={item.id} className="ow-radio-card"><input type="radio" name="tap-mode" checked={mode === item.id} disabled={item.id === "automatic_fixed" && !automaticAllowed} onChange={() => { setMode(item.id); if (state === "saved" || state === "error") setState("clean"); }} /><div><strong>{item.label}</strong><span>{item.id === "automatic_fixed" && !automaticAllowed ? AUTOMATIC_NOTE : item.text}</span></div></label>)}
            </div>
            {needsCooldown && <div className="ow-field"><label htmlFor="tap-cooldown">Wartezeit zwischen zwei Taps (Sekunden)</label><input id="tap-cooldown" className="ow-input" inputMode="numeric" style={{ maxWidth: 200 }} value={cooldown} onChange={event => setCooldown(event.target.value.replace(/[^0-9]/g, ""))} aria-invalid={!cooldownValid} /></div>}
          </fieldset>
          <SaveBar state={shown} onSave={() => void save()} onDiscard={() => { setMode(saved.mode); setCooldown(saved.cooldown); setState("clean"); }} canSave={changed && cooldownValid} saveLabel="NFC-Regel speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : undefined} />
        </div>
      </details>
    </section>
  );
}
