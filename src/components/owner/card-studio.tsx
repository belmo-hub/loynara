"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { imageToDataUrl, postJson, type MeResponse, type PublicProgram } from "@/components/client-api";
import { HEX_COLOR as HEX, readableInk } from "./color";
import { useDirtyGuard, useOwner } from "./owner-context";
import { MoreInfo, OwnerIcon, SaveBar, type SaveState } from "./owner-ui";
import { SurfacePreview, type LogoWallet, type Surface } from "./wallet-previews";
import { WalletReadiness } from "./wallet-readiness";
import { brandingSaveFeedback } from "./branding-save-feedback";
import { SHORT_NAME } from "./program-helpers";

/** logoWallet: what the pass does with the saved logo on the saved colour (server-side processing, lib/wallet/logo). */
export type Brand = { businessName: string; locationName: string; brandColor: string; logoData: string | null; logoWallet?: LogoWallet | null };
const SWATCHES: Array<{ name: string; hex: string }> = [
  { name: "Waldgrün", hex: "#1F4A3A" }, { name: "Salbei", hex: "#2F6B58" }, { name: "Terrakotta", hex: "#A8492C" },
  { name: "Nachtblau", hex: "#2B4A66" }, { name: "Pflaume", hex: "#6B3A6F" }, { name: "Graphit", hex: "#23282B" }, { name: "Senf", hex: "#C99A2E" },
];
const SURFACES: Array<{ id: Surface; label: string }> = [{ id: "browser", label: "Browserkarte" }, { id: "apple", label: "Apple Wallet" }, { id: "google", label: "Google Wallet" }];
type Demo = "new" | "close" | "ready";
const DEMOS: Array<{ id: Demo; label: string }> = [{ id: "new", label: "Neue Karte" }, { id: "close", label: "Kurz vor Prämie" }, { id: "ready", label: "Prämie verfügbar" }];

// The programme's name joins the two names here (W42). It is saved with the card page, without a review: a name is not a
// rule. The server still writes a rule version for it.
type Draft = Brand & { programName: string };

export function CardStudio({ me, program, initial, onSaved }: { me: MeResponse; program: PublicProgram; initial: Brand; onSaved: (brand: Brand) => void }) {
  const owner = useOwner();
  const hidden = me.hiddenSurfaces ?? [];
  const walletsHidden = hidden.includes("walletPreviews");
  const logoHidden = hidden.includes("cardLogo");
  const surfaces = walletsHidden ? SURFACES.filter(item => item.id === "browser") : SURFACES;
  const [saved, setSaved] = useState<Draft>(() => ({ ...initial, programName: program.programName }));
  const [draft, setDraft] = useState<Draft>(saved);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const [errorLabel, setErrorLabel] = useState("");
  const [logoError, setLogoError] = useState("");
  const [surface, setSurface] = useState<Surface>("browser");
  const [demo, setDemo] = useState<Demo>("close");
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const [savedVersion, setSavedVersion] = useState(0);
  const saving = useRef(false);
  const revision = useRef(0);
  const logoRevision = useRef(0);

  const colorValid = HEX.test(draft.brandColor);
  const nameValid = [draft.businessName, draft.locationName, draft.programName].every(name => name.trim().length >= 2);
  const programShort = draft.programName.trim().length < 2; // named with the setup's own words
  // The save bar's „Bitte Eingaben prüfen.“ needs the field to say what is wrong.
  const businessShort = draft.businessName.trim().length < 2, locationShort = draft.locationName.trim().length < 2;
  const changed = draft.businessName !== saved.businessName || draft.locationName !== saved.locationName || draft.programName !== saved.programName || draft.brandColor.toLowerCase() !== saved.brandColor.toLowerCase() || draft.logoData !== saved.logoData;
  const shownState: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("card-studio", changed);

  const cost = Math.max(1, program.rewards[0]?.cost ?? program.rewardCost);
  const balance = demo === "new" ? 0 : demo === "close" ? Math.max(0, cost - 1) : cost;
  // The server's verdict holds only for the saved logo on the saved colour; a new pick or colour falls back to its shape.
  const savedLogo = draft.logoData === saved.logoData && draft.brandColor.toLowerCase() === saved.brandColor.toLowerCase();
  const previewData = useMemo(() => ({
    businessName: draft.businessName.trim(), locationName: draft.locationName.trim(), brandColor: colorValid ? draft.brandColor : saved.brandColor,
    programType: program.programType, rewardTitle: program.rewards[0]?.title ?? program.rewardTitle, rewardCost: cost, balance, programName: draft.programName.trim(), logoData: draft.logoData, logoWallet: savedLogo ? saved.logoWallet : undefined,
  }), [draft, colorValid, saved.brandColor, saved.logoWallet, savedLogo, program, cost, balance]);

  function edit(patch: Partial<Draft>) { revision.current++; setDraft(current => ({ ...current, ...patch })); if (state === "saved" || state === "error") { setState("clean"); setError(""); } }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    const selectedRevision = ++logoRevision.current;
    setLogoError("");
    try {
      const logoData = await imageToDataUrl(file);
      if (selectedRevision === logoRevision.current) edit({ logoData });
    } catch (cause) {
      if (selectedRevision === logoRevision.current) setLogoError(cause instanceof Error ? cause.message : "Das Logo konnte nicht gelesen werden.");
    }
  }

  async function save() {
    if (saving.current || !colorValid || !nameValid) return;
    saving.current = true;
    const submittedRevision = revision.current;
    setState("saving"); setError(""); setErrorLabel("");
    try {
      // logoData: omitted = keep, null = remove, string = replace. Only send the image when it changed.
      const logoChanged = draft.logoData !== saved.logoData;
      const result = await postJson<Brand>("/api/merchant/program/brand", { programSlug: me.programSlug, businessName: draft.businessName.trim(), locationName: draft.locationName.trim(), brandColor: draft.brandColor, ...(logoChanged ? { logoData: draft.logoData } : {}) });
      const programName = draft.programName.trim();
      if (draft.programName !== saved.programName) await postJson("/api/merchant/program/update", { programSlug: me.programSlug, name: programName });
      const next = { ...result, programName };
      setSaved(next);
      // Only the submitted revision was acknowledged; keep edits made during I/O.
      setDraft(current => revision.current === submittedRevision ? next : current); setState("saved"); onSaved(result); setSavedVersion(value => value + 1);
      owner.announce(revision.current === submittedRevision ? "Kundenkarte gespeichert." : "Der eingereichte Stand wurde gespeichert. Neuere Änderungen sind noch ungespeichert.");
      void owner.refresh();
    } catch (cause) {
      const feedback = brandingSaveFeedback(cause);
      setState("error"); setError(feedback.message); setErrorLabel(feedback.label); owner.announce(feedback.label);
    } finally { saving.current = false; }
  }
  function discard() { logoRevision.current++; revision.current++; setDraft(saved); setState("clean"); setError(""); setLogoError(""); }

  return (
    <div className="ow-stack" style={{ gap: 0 }}>
      <div className="ow-mobile-switch ow-seg" role="group" aria-label="Ansicht">
        <button type="button" aria-pressed={pane === "edit"} onClick={() => setPane("edit")}><OwnerIcon name="pencil" size={16} /> Bearbeiten</button>
        <button type="button" aria-pressed={pane === "preview"} onClick={() => setPane("preview")}><OwnerIcon name="eye" size={16} /> Vorschau</button>
      </div>
      <div className="ow-studio" data-pane={pane}>
        <div className="ow-studio-controls ow-card">
          <fieldset className="ow-group">
            <legend>Namen</legend>
            <div className="ow-field"><label htmlFor="cs-name">Geschäftsname</label><input id="cs-name" className="ow-input" value={draft.businessName} maxLength={180} onChange={event => edit({ businessName: event.target.value })} aria-invalid={businessShort} aria-describedby={businessShort ? "cs-name-err cs-name-hint" : "cs-name-hint"} />{businessShort && <span id="cs-name-err" className="ow-error">{SHORT_NAME}</span>}<span id="cs-name-hint" className="ow-hint">Gilt für alle deine Standorte.</span></div>
            <div className="ow-field"><label htmlFor="cs-loc">Standortname</label><input id="cs-loc" className="ow-input" value={draft.locationName} maxLength={180} onChange={event => edit({ locationName: event.target.value })} aria-invalid={locationShort} aria-describedby={locationShort ? "cs-loc-err" : undefined} />{locationShort && <span id="cs-loc-err" className="ow-error">{SHORT_NAME}</span>}<span className="ow-hint">Nur für diesen Standort.</span></div>
            <div className="ow-field"><label htmlFor="cs-program">Programmname</label><input id="cs-program" className="ow-input" value={draft.programName} maxLength={180} onChange={event => edit({ programName: event.target.value })} aria-invalid={programShort} aria-describedby={programShort ? "cs-program-err cs-program-hint" : "cs-program-hint"} />
              {programShort && <span id="cs-program-err" className="ow-error">Bitte einen Programmnamen mit 2 bis 180 Zeichen eingeben.</span>}<span id="cs-program-hint" className="ow-hint">Steht auf der Wallet-Karte.</span></div>
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
              {colorValid && readableInk(draft.brandColor) === "#000000" && <span className="ow-hint">{walletsHidden ? "Die Browserkarte wählt automatisch dunkle Schrift." : "Browserkarte und Wallet-Karten wählen automatisch dunkle Schrift."}</span>}
            </div>
            {!logoHidden && (
            <div className="ow-field">
              <span className="ow-label">Logo</span>
              <div className="ow-logo-row">
                {draft.logoData && <Image unoptimized className="ow-logo-thumb" src={draft.logoData} width={112} height={35} alt="Ausgewähltes Logo" style={{ backgroundColor: draft.brandColor }} />}
                <label htmlFor="cs-logo" className="ow-btn ow-btn--secondary ow-filebtn">{draft.logoData ? "Anderes Logo wählen" : "Logo wählen"}<input id="cs-logo" className="ow-sr" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void pickLogo(event.target.files?.[0])} /></label>
                {draft.logoData && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => { logoRevision.current++; setLogoError(""); edit({ logoData: null }); }}>Logo entfernen</button>}
              </div>
              <span className="ow-hint">PNG, JPG oder WebP bis 2 MB. Wir schneiden dein Logo nicht zu, ob rund, eckig oder breit.</span>
              {logoError && <span className="ow-error" role="alert">{logoError}</span>}
              {savedLogo && saved.logoWallet?.faint && <span className="ow-hint">Dein Logo ist auf dieser Farbe schwer zu sehen. Wähle eine andere Farbe oder eine andere Version deines Logos. Bis dahin zeigt Apple Wallet statt des Logos deinen Geschäftsnamen und Google Wallet deinen Anfangsbuchstaben.</span>}
              {savedLogo && !saved.logoWallet?.faint && saved.logoWallet?.upscaled && <span className="ow-hint">Dein Logo ist sehr klein und kann auf der Karte unscharf wirken.</span>}
            </div>
            )}
          </fieldset>
          {!walletsHidden && <fieldset className="ow-group">
            <legend>Apple &amp; Google Wallet</legend>
            <WalletReadiness programSlug={me.programSlug} version={savedVersion} />
            <p className="ow-hint">Wallet-Karten zeigen eine Kopie aus Loynara und aktualisieren sich nach jeder Buchung. Was zählt, entscheidet immer die Kasse.</p>
          </fieldset>}
        </div>

        <div className="ow-studio-preview">
          {surfaces.length > 1 && <div className="ow-seg" role="tablist" aria-label="Darstellung">
            {surfaces.map(item => <button key={item.id} type="button" role="tab" aria-selected={surface === item.id} onClick={() => setSurface(item.id)}>{item.label}</button>)}
          </div>}
          <div className="ow-stage" role="tabpanel" aria-label={`Vorschau ${SURFACES.find(item => item.id === surface)?.label}`}><SurfacePreview surface={surface} data={previewData} /></div>
          <div className="ow-seg" role="group" aria-label="Beispielzustand">
            {DEMOS.map(item => <button key={item.id} type="button" aria-pressed={demo === item.id} onClick={() => setDemo(item.id)}>{item.label}</button>)}
          </div>
          <MoreInfo><p>Wallet-Vorschauen sind Entwürfe. Darstellung auf dem Gerät kann abweichen; Logo und Farben werden vor der Wallet-Freigabe gesondert geprüft und übernommen.</p></MoreInfo>
        </div>
      </div>
      <SaveBar state={shownState} errorLabel={errorLabel} onSave={() => void save()} onDiscard={discard} canSave={colorValid && nameValid && changed} saveLabel="Kundenkarte speichern" detail={shownState === "error" ? `${error} Deine Änderungen sind noch da.` : shownState === "dirty" && !(colorValid && nameValid) ? "Bitte Eingaben prüfen." : undefined} />
    </div>
  );
}
