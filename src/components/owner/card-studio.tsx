"use client";

import Image from "next/image";
import { GuardedLink } from "./owner-shell";
import { useMemo, useRef, useState } from "react";
import { imageToDataUrl, postJson, type MeResponse, type PublicProgram } from "@/components/client-api";
import { HEX_COLOR as HEX, readableInk, whiteContrast } from "./color";
import { useDirtyGuard, useOwner } from "./owner-context";
import { Notice, OwnerIcon, SaveBar, type SaveState } from "./owner-ui";
import { SurfacePreview, type Surface } from "./wallet-previews";

export type Brand = { businessName: string; locationName: string; brandColor: string; logoData: string | null };
const SWATCHES: Array<{ name: string; hex: string }> = [
  { name: "Waldgrün", hex: "#1F4A3A" }, { name: "Salbei", hex: "#2F6B58" }, { name: "Terrakotta", hex: "#A8492C" },
  { name: "Nachtblau", hex: "#2B4A66" }, { name: "Pflaume", hex: "#6B3A6F" }, { name: "Graphit", hex: "#23282B" }, { name: "Senf", hex: "#C99A2E" },
];
const SURFACES: Array<{ id: Surface; label: string }> = [{ id: "browser", label: "Browserkarte" }, { id: "apple", label: "Apple Wallet" }, { id: "google", label: "Google Wallet" }];
type Demo = "new" | "close" | "ready";
const DEMOS: Array<{ id: Demo; label: string }> = [{ id: "new", label: "Neue Karte" }, { id: "close", label: "Kurz vor Prämie" }, { id: "ready", label: "Prämie verfügbar" }];

export function CardStudio({ me, program, initial, onSaved }: { me: MeResponse; program: PublicProgram; initial: Brand; onSaved: (brand: Brand) => void }) {
  const owner = useOwner();
  const [saved, setSaved] = useState<Brand>(initial);
  const [draft, setDraft] = useState<Brand>(initial);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const [logoError, setLogoError] = useState("");
  const [surface, setSurface] = useState<Surface>("browser");
  const [demo, setDemo] = useState<Demo>("close");
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const saving = useRef(false);

  const colorValid = HEX.test(draft.brandColor);
  const nameValid = draft.businessName.trim().length >= 2 && draft.locationName.trim().length >= 2;
  const changed = draft.businessName !== saved.businessName || draft.locationName !== saved.locationName || draft.brandColor.toLowerCase() !== saved.brandColor.toLowerCase() || draft.logoData !== saved.logoData;
  const shownState: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("card-studio", changed);

  const cost = Math.max(1, program.rewards[0]?.cost ?? program.rewardCost);
  const balance = demo === "new" ? 0 : demo === "close" ? Math.max(0, cost - 1) : cost;
  const previewData = useMemo(() => ({
    businessName: draft.businessName.trim(), locationName: draft.locationName.trim(), brandColor: colorValid ? draft.brandColor : saved.brandColor,
    programType: program.programType, rewardTitle: program.rewards[0]?.title ?? program.rewardTitle, rewardCost: cost, balance, programName: program.programName, logoData: draft.logoData,
  }), [draft, colorValid, saved.brandColor, program, cost, balance]);

  function edit(patch: Partial<Brand>) { setDraft(current => ({ ...current, ...patch })); if (state === "saved" || state === "error") { setState("clean"); setError(""); } }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setLogoError("");
    try { edit({ logoData: await imageToDataUrl(file) }); }
    catch (cause) { setLogoError(cause instanceof Error ? cause.message : "Das Logo konnte nicht gelesen werden."); }
  }

  async function save() {
    if (saving.current || !colorValid || !nameValid) return;
    saving.current = true; setState("saving"); setError("");
    try {
      // logoData: omitted = keep, null = remove, string = replace. Only send the image when it changed.
      const logoChanged = draft.logoData !== saved.logoData;
      const result = await postJson<Brand>("/api/merchant/program/brand", { programSlug: me.programSlug, businessName: draft.businessName.trim(), locationName: draft.locationName.trim(), brandColor: draft.brandColor, ...(logoChanged ? { logoData: draft.logoData } : {}) });
      setSaved(result); setDraft(result); setState("saved"); onSaved(result);
      owner.announce("Kundenkarte gespeichert.");
      void owner.refresh();
    } catch (cause) {
      setState("error"); setError(cause instanceof Error ? cause.message : "Die Kundenkarte konnte nicht gespeichert werden."); owner.announce("Speichern fehlgeschlagen.");
    } finally { saving.current = false; }
  }
  function discard() { setDraft(saved); setState("clean"); setError(""); setLogoError(""); }

  const appleContrast = whiteContrast(draft.brandColor);
  const logoIsPng = draft.logoData?.startsWith("data:image/png;base64,") ?? false;
  return (
    <div className="ow-stack" style={{ gap: 0 }}>
      <div className="ow-mobile-switch ow-seg" role="group" aria-label="Ansicht" style={{ marginBottom: 16 }}>
        <button type="button" aria-pressed={pane === "edit"} onClick={() => setPane("edit")}><OwnerIcon name="pencil" size={16} /> Bearbeiten</button>
        <button type="button" aria-pressed={pane === "preview"} onClick={() => setPane("preview")}><OwnerIcon name="eye" size={16} /> Vorschau</button>
      </div>
      <div className="ow-studio" data-pane={pane}>
        <div className="ow-studio-controls ow-card">
          <fieldset className="ow-group">
            <legend>Identität</legend>
            <div className="ow-field"><label htmlFor="cs-name">Geschäftsname</label><input id="cs-name" className="ow-input" value={draft.businessName} maxLength={180} onChange={event => edit({ businessName: event.target.value })} aria-invalid={draft.businessName.trim().length < 2} aria-describedby="cs-name-hint" /><span id="cs-name-hint" className="ow-hint">Gilt für alle deine Standorte.</span></div>
            <div className="ow-field"><label htmlFor="cs-loc">Standortname</label><input id="cs-loc" className="ow-input" value={draft.locationName} maxLength={180} onChange={event => edit({ locationName: event.target.value })} aria-invalid={draft.locationName.trim().length < 2} /><span className="ow-hint">Nur für diesen Standort.</span></div>
          </fieldset>
          <fieldset className="ow-group">
            <legend>Gestaltung</legend>
            <div className="ow-field">
              <span className="ow-label" id="cs-color-label">Markenfarbe</span>
              <div className="ow-swatches" role="group" aria-labelledby="cs-color-label">
                {SWATCHES.map(swatch => <button key={swatch.hex} type="button" className="ow-swatch" style={{ backgroundColor: swatch.hex }} aria-label={swatch.name} aria-pressed={draft.brandColor.toLowerCase() === swatch.hex.toLowerCase()} onClick={() => edit({ brandColor: swatch.hex })} />)}
              </div>
              <div className="ow-colorrow">
                <input type="color" aria-label="Farbe wählen" value={colorValid ? draft.brandColor : "#000000"} onChange={event => edit({ brandColor: event.target.value })} />
                <div className="ow-field"><label htmlFor="cs-hex" className="ow-hint">Farbwert (Hex)</label><input id="cs-hex" className="ow-input" value={draft.brandColor} maxLength={7} spellCheck={false} onChange={event => edit({ brandColor: event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}` })} aria-invalid={!colorValid} aria-describedby={colorValid ? undefined : "cs-hex-err"} /></div>
              </div>
              {!colorValid && <span id="cs-hex-err" className="ow-error">Bitte einen Farbwert wie #1F4A3A eingeben.</span>}
              {colorValid && appleContrast < 4.5 && <Notice tone="warn">Apple Wallet setzt weiße Schrift. Auf dieser Farbe ist sie schwer lesbar (Kontrast {appleContrast.toFixed(1).replace(".", ",")} : 1). Eine dunklere Farbe liest sich besser.</Notice>}
              {colorValid && appleContrast >= 4.5 && readableInk(draft.brandColor) === "#000000" && <span className="ow-hint">Browserkarte und Google Wallet wählen automatisch dunkle Schrift.</span>}
            </div>
            <div className="ow-field">
              <span className="ow-label">Logo</span>
              <div className="ow-logo-row">
                {draft.logoData && <Image unoptimized className="ow-logo-thumb" src={draft.logoData} width={56} height={56} alt="Ausgewähltes Logo" />}
                <label htmlFor="cs-logo" className="ow-btn ow-btn--secondary ow-filebtn">{draft.logoData ? "Anderes Logo wählen" : "Logo wählen"}<input id="cs-logo" className="ow-sr" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void pickLogo(event.target.files?.[0])} /></label>
                {draft.logoData && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => edit({ logoData: null })}>Logo entfernen</button>}
              </div>
              <span className="ow-hint">PNG, JPG oder WebP bis 2 MB.</span>
              {logoError && <span className="ow-error" role="alert">{logoError}</span>}
              {draft.logoData && <span className="ow-hint">Das Logo wird auf der Browserkarte und im Apple-Pass derzeit nicht angezeigt. Google Wallet nutzt nur PNG-Logos und nur, wenn die Bildfreigabe für Google eingerichtet ist{logoIsPng ? "" : ". Dieses Bild ist kein PNG"}.</span>}
            </div>
          </fieldset>
          <fieldset className="ow-group">
            <legend>Inhalt</legend>
            <div className="ow-readonly"><dl className="ow-dl"><dt>Programm</dt><dd>{program.programName}</dd><dt>Prämie</dt><dd>{program.rewardCost} {program.programType === "stamp" ? "Stempel" : "Punkte"} → {program.rewardTitle}</dd></dl></div>
            <p className="ow-hint">Programmname, Prämien und Regeln pflegst du unter <GuardedLink className="ow-link" href="/merchant/program">Sammelregeln &amp; Prämien</GuardedLink>.</p>
          </fieldset>
        </div>

        <div className="ow-studio-preview">
          <div className="ow-seg" role="tablist" aria-label="Darstellung">
            {SURFACES.map(item => <button key={item.id} type="button" role="tab" aria-selected={surface === item.id} onClick={() => setSurface(item.id)}>{item.label}</button>)}
          </div>
          <div className="ow-stage" role="tabpanel" aria-label={`Vorschau ${SURFACES.find(item => item.id === surface)?.label}`}><SurfacePreview surface={surface} data={previewData} /></div>
          <div className="ow-seg" role="group" aria-label="Beispielzustand">
            {DEMOS.map(item => <button key={item.id} type="button" aria-pressed={demo === item.id} onClick={() => setDemo(item.id)}>{item.label}</button>)}
          </div>
          <p className="ow-hint">Vorschau – Darstellung auf dem Gerät kann abweichen. Alle Ansichten nutzen denselben Entwurf.</p>
        </div>
      </div>
      <SaveBar state={shownState} onSave={() => void save()} onDiscard={discard} canSave={colorValid && nameValid && changed} saveLabel="Kundenkarte speichern" detail={shownState === "error" ? `${error} Deine Änderungen sind noch da.` : shownState === "dirty" && !(colorValid && nameValid) ? "Bitte Eingaben prüfen." : undefined} />
    </div>
  );
}
