"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { imageToDataUrl, postJson } from "@/components/client-api";
import { setupReviewValidation } from "./program-setup-validation";
import { BrowserCardPreview } from "./card-preview";
import { useDirtyGuard, useOwner } from "./owner-context";
import { Notice, OwnerIcon } from "./owner-ui";
import { confirmSentence, earningSentence, euro, MAX_POINTS_PER_CURRENCY_UNIT, minimumSpendMinor, MIN_SPEND_LABEL, NO_MIN_SPEND_LABEL, parseWholeNumber, purchaseExample, unitDative, type EarningMode, type ProgramKind } from "./program-helpers";

type Preset = { id: string; label: string; type: ProgramKind; mode: EarningMode; rate: number; reward: string; cost: number };
// Editable starting points only. They are examples, not approved or recommended commercial programmes.
const PRESETS: Preset[] = [
  { id: "cafe", label: "Café", type: "stamp", mode: "manual", rate: 1, reward: "Kaffee aufs Haus", cost: 8 },
  { id: "food", label: "Gastronomie", type: "points", mode: "purchase", rate: 1, reward: "Dessert aufs Haus", cost: 100 },
  { id: "barber", label: "Barber & Friseur", type: "stamp", mode: "manual", rate: 1, reward: "Haarschnitt gratis", cost: 10 },
  { id: "beauty", label: "Beauty", type: "points", mode: "purchase", rate: 1, reward: "Pflegeprodukt gratis", cost: 150 },
  { id: "other", label: "Sonstiges", type: "stamp", mode: "manual", rate: 1, reward: "", cost: 0 },
];
const SWATCHES = ["#1F4A3A", "#2F6B58", "#A8492C", "#2B4A66", "#6B3A6F", "#23282B"];
const STEPS = ["Geschäft", "Sammeln", "Prämie", "Karte & prüfen"] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

function draftRules(type: ProgramKind, mode: EarningMode, rate: number, reward: string, cost: number) {
  const target = reward.trim() && cost > 0 ? ` Ab ${cost} ${unitDative(type)} gibt es: ${reward.trim()}.` : "";
  if (type === "stamp") return `Pro bestätigtem Besuch vergibt das Team Stempel an der Kasse.${target}`;
  return mode === "purchase" ? `Pro 1 € Einkaufswert gibt es ${rate} ${rate === 1 ? "Punkt" : "Punkte"}, abgerundet. Das Team bestätigt jede Buchung an der Kasse.${target}` : `Das Team vergibt Punkte an der Kasse.${target}`;
}

export function ProgramSetup() {
  const router = useRouter();
  const owner = useOwner();
  const logoHidden = owner.hiddenSurfaces.includes("cardLogo");
  const walletsHidden = owner.hiddenSurfaces.includes("walletPreviews");
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState({
    businessName: "", locationName: "", city: "", country: "DE" as "DE" | "MA", locale: "de" as "de" | "fr", contactEmail: "", preset: "",
    type: "stamp" as ProgramKind, mode: "manual" as EarningMode, rate: "1", rewardName: "", cost: "", rules: "", rulesEdited: false,
    programName: "", brandColor: "#1F4A3A", logo: null as File | null, date: new Date().toISOString().slice(0, 10), latitude: "", longitude: "",
  });
  const [amount, setAmount] = useState("");
  const set = (patch: Partial<typeof f>) => setF(current => ({ ...current, ...patch }));
  const touched = Boolean(f.businessName || f.locationName || f.city || f.rewardName || f.cost);
  useDirtyGuard("program-setup", touched && !busy);

  const currency = f.country === "DE" ? "EUR" : "MAD";
  const rate = Number(f.rate);
  const cost = parseWholeNumber(f.cost);
  const effectiveMode: EarningMode = f.type === "stamp" ? "manual" : f.mode;
  const rateValid = effectiveMode !== "purchase" || (Number.isInteger(rate) && rate >= 1 && rate <= MAX_POINTS_PER_CURRENCY_UNIT);
  const rulesText = f.rulesEdited ? f.rules : draftRules(f.type, effectiveMode, rateValid ? rate : 1, f.rewardName, cost ?? 0);
  const programName = f.programName || (f.businessName.trim() ? `${f.businessName.trim()} Treuekarte` : "Treueprogramm");
  const reviewValidation = setupReviewValidation({ programName, date: f.date, latitude: f.latitude, longitude: f.longitude });

  const problems: Array<Record<string, string>> = [
    { businessName: f.businessName.trim().length < 2 ? "Bitte den Geschäftsnamen eingeben." : "", locationName: f.locationName.trim().length < 2 ? "Bitte den Standort benennen." : "", city: f.city.trim().length < 2 ? "Bitte die Stadt eingeben." : "", contactEmail: f.contactEmail && !/^\S+@\S+\.\S+$/.test(f.contactEmail) ? "Bitte eine gültige E-Mail-Adresse eingeben." : "" },
    { rate: rateValid ? "" : `Bitte eine ganze Zahl von 1 bis ${MAX_POINTS_PER_CURRENCY_UNIT} eingeben.`, rules: rulesText.trim().length < 10 ? "Der Regeltext braucht mindestens 10 Zeichen." : "" },
    { rewardName: f.rewardName.trim().length < 2 ? "Bitte die Prämie benennen." : "", cost: cost === null ? "Bitte eine ganze Zahl größer 0 eingeben." : "" },
    { brandColor: HEX.test(f.brandColor) ? "" : "Bitte einen Farbwert wie #1F4A3A eingeben.", ...reviewValidation.problems },
  ];
  const stepProblems = Object.entries(problems[step]).filter(([, message]) => message);

  useEffect(() => { heading.current?.focus(); }, [step]);

  function applyPreset(preset: Preset) {
    setF(current => ({ ...current, preset: preset.id, type: preset.type, mode: preset.mode, rate: String(preset.rate), rewardName: preset.reward, cost: preset.cost ? String(preset.cost) : "", rulesEdited: false }));
  }
  function next() {
    setTried(true);
    if (stepProblems.length) { const first = document.getElementById(`su-${stepProblems[0][0]}`); first?.focus(); return; }
    setTried(false); setStep(value => Math.min(3, value + 1));
  }

  async function submit() {
    setTried(true);
    if (problems.some(group => Object.values(group).some(Boolean))) {
      const failing = problems.findIndex(group => Object.values(group).some(Boolean));
      setStep(failing);
      const [field] = Object.entries(problems[failing]).find(([, message]) => message)!;
      requestAnimationFrame(() => {
        const input = document.getElementById(`su-${field}`);
        const settings = input?.closest("details");
        if (settings) settings.open = true;
        input?.focus();
      });
      return;
    }
    setBusy(true); setError("");
    try {
      const logoData = f.logo ? await imageToDataUrl(f.logo) : undefined;
      await postJson<{ programSlug: string }>("/api/merchant/onboard", {
        businessName: f.businessName.trim(), city: f.city.trim(), country: f.country, timezone: f.country === "DE" ? "Europe/Berlin" : "Africa/Casablanca", locale: f.locale, currency,
        programName: programName.trim(), programType: f.type, earningMode: effectiveMode, pointsPerCurrencyUnit: f.type === "points" && effectiveMode === "purchase" ? rate : 1,
        rulesText: rulesText.trim(), rewardTitle: f.rewardName.trim(), rewardCost: cost,
        locationName: f.locationName.trim(), ...(f.contactEmail.trim() ? { contactEmail: f.contactEmail.trim() } : {}),
        brandColor: f.brandColor, effectiveDate: f.date, logoData,
        ...reviewValidation.coordinates,
      });
      await owner.refresh();
      router.replace("/merchant");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Das Programm konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  const example = f.type === "points" && effectiveMode === "purchase" && rateValid ? purchaseExample(amount, rate) : null;
  const minSpend = f.type === "points" && effectiveMode === "purchase" && cost !== null && rateValid ? minimumSpendMinor(cost, rate) : null;
  const err = (key: string) => tried ? problems[step][key] : "";
  const summary = [
    ["Regel", earningSentence(f.type, effectiveMode, rate, currency)],
    ["Wer bestätigt", confirmSentence(f.type, effectiveMode)],
    ["Prämie", cost !== null ? `${cost} ${f.type === "stamp" ? "Stempel" : "Punkte"} → ${f.rewardName.trim()}` : "–"],
    ["Karte", `${f.businessName.trim()} · ${f.locationName.trim()}`],
  ];

  return (
    <div className="ow-page" style={{ maxWidth: 920 }}>
      <header className="ow-pagehead"><div><p className="ow-eyebrow">Erste Einrichtung</p><h1 ref={heading} tabIndex={-1}>Dein Treueprogramm einrichten</h1><p>Vier kurze Schritte. Nichts wird gespeichert, bis du am Ende bestätigst.</p></div></header>
      <ol className="ow-stepper" aria-label="Fortschritt">
        {STEPS.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} data-done={index < step}><span className="ow-stepper-n">{index < step ? <OwnerIcon name="check" size={14} /> : index + 1}</span>{label}</li>)}
      </ol>
      <div className="ow-two" style={{ gridTemplateColumns: step === 3 ? "minmax(0,1.3fr) minmax(0,1fr)" : "minmax(0,1.5fr) minmax(0,1fr)" }}>
        <form className="ow-card ow-stack" style={{ gap: 20 }} onSubmit={event => { event.preventDefault(); if (step < 3) next(); else void submit(); }} noValidate>
          {step === 0 && <>
            <div><h2>Dein Geschäft</h2><p className="ow-muted" style={{ fontSize: 14 }}>Name und Standort stehen auf der Kundenkarte.</p></div>
            <Field id="su-businessName" label="Geschäftsname" error={err("businessName")}><input id="su-businessName" className="ow-input" value={f.businessName} maxLength={120} autoComplete="organization" onChange={event => set({ businessName: event.target.value })} aria-invalid={Boolean(err("businessName"))} placeholder="z. B. Café am Platz" /></Field>
            <div className="ow-grid-2">
              <Field id="su-locationName" label="Standort" error={err("locationName")}><input id="su-locationName" className="ow-input" value={f.locationName} maxLength={120} onChange={event => set({ locationName: event.target.value })} aria-invalid={Boolean(err("locationName"))} placeholder="z. B. Kassel Mitte" /></Field>
              <Field id="su-city" label="Stadt" error={err("city")}><input id="su-city" className="ow-input" value={f.city} maxLength={120} autoComplete="address-level2" onChange={event => set({ city: event.target.value })} aria-invalid={Boolean(err("city"))} /></Field>
            </div>
            <div className="ow-grid-2">
              <Field id="su-country" label="Land"><select id="su-country" className="ow-select" value={f.country} onChange={event => set({ country: event.target.value as "DE" | "MA" })}><option value="DE">Deutschland (EUR)</option><option value="MA">Marokko (MAD)</option></select></Field>
              <Field id="su-locale" label="Sprache der Karte"><select id="su-locale" className="ow-select" value={f.locale} onChange={event => set({ locale: event.target.value as "de" | "fr" })}><option value="de">Deutsch</option><option value="fr">Französisch</option></select></Field>
            </div>
            <Field id="su-contactEmail" label="Kontakt-E-Mail (optional)" error={err("contactEmail")}><input id="su-contactEmail" className="ow-input" type="email" value={f.contactEmail} onChange={event => set({ contactEmail: event.target.value })} aria-invalid={Boolean(err("contactEmail"))} /></Field>
            <fieldset className="ow-group"><legend>Branche (optional)</legend>
              <div className="ow-swatches" role="group" aria-label="Branche">{PRESETS.map(preset => <button key={preset.id} type="button" className="ow-btn ow-btn--secondary ow-btn--sm" aria-pressed={f.preset === preset.id} onClick={() => applyPreset(preset)} style={f.preset === preset.id ? { borderColor: "var(--ow-accent)", background: "var(--ow-accent-soft)" } : undefined}>{preset.label}</button>)}</div>
              <span className="ow-hint">Füllt die nächsten Schritte mit einem Beispiel vor. Alles bleibt änderbar. Das ist ein Vorschlag, kein geprüftes oder empfohlenes Angebot.</span>
            </fieldset>
          </>}
          {step === 1 && <>
            <div><h2>Wie sammeln Kunden?</h2><p className="ow-muted" style={{ fontSize: 14 }}>Wähle, wie eine Gutschrift entsteht. Wer sie bestätigt, steht darunter.</p></div>
            <div className="ow-radio-cards" role="radiogroup" aria-label="Sammelart">
              {([["stamp", "manual", "Stempel", "Dein Team vergibt an der Kasse Stempel, meist einen pro Besuch."], ["points", "purchase", "Punkte nach Einkaufswert", "Das Team gibt den Betrag ein, das System rechnet und rundet ab."], ["points", "manual", "Punkte manuell", "Das Team gibt die Punktmenge direkt ein."]] as const).map(([type, mode, title, text]) => (
                <label key={title} className="ow-radio-card"><input type="radio" name="su-earn" checked={f.type === type && effectiveMode === mode} onChange={() => set({ type, mode })} /><div><strong>{title}</strong><span>{text}</span></div></label>
              ))}
            </div>
            {f.type === "points" && effectiveMode === "purchase" && <Field id="su-rate" label={`Punkte pro 1 ${currency === "EUR" ? "€" : currency}`} error={err("rate")}><input id="su-rate" className="ow-input" inputMode="numeric" style={{ maxWidth: 200 }} value={f.rate} onChange={event => set({ rate: event.target.value.replace(/[^0-9]/g, "") })} aria-invalid={Boolean(err("rate"))} /></Field>}
            <div className="ow-readonly"><strong style={{ display: "block", marginBottom: 2 }}>Wer bestätigt?</strong>{confirmSentence(f.type, effectiveMode)}</div>
            <Field id="su-rules" label="Regeltext für Kunden" error={err("rules")} hint="Vorschlag aus deiner Auswahl. Du kannst ihn frei ändern.">
              <textarea id="su-rules" className="ow-textarea" value={rulesText} maxLength={3000} onChange={event => set({ rules: event.target.value, rulesEdited: true })} aria-invalid={Boolean(err("rules"))} />
            </Field>
          </>}
          {step === 2 && <>
            <div><h2>Deine erste Prämie</h2><p className="ow-muted" style={{ fontSize: 14 }}>Name, dann Preis. Weitere Prämien und Bedingungen kannst du danach ergänzen.</p></div>
            <Field id="su-rewardName" label="Name der Prämie" error={err("rewardName")}><input id="su-rewardName" className="ow-input" value={f.rewardName} maxLength={180} onChange={event => set({ rewardName: event.target.value })} aria-invalid={Boolean(err("rewardName"))} placeholder="z. B. Kaffee aufs Haus" /></Field>
            <Field id="su-cost" label={`Preis in ${unitDative(f.type)}`} error={err("cost")} hint={f.preset && f.preset !== "other" ? "Beispielwert aus der Branchenauswahl. Bitte prüfe ihn für dein Geschäft." : undefined}><input id="su-cost" className="ow-input" inputMode="numeric" style={{ maxWidth: 200 }} value={f.cost} onChange={event => set({ cost: event.target.value.replace(/[^0-9]/g, "") })} aria-invalid={Boolean(err("cost"))} /></Field>
            <div className="ow-readonly" role="status" aria-live="polite">{minSpend !== null ? <>Mindestumsatz: <strong>{euro(minSpend, currency)}</strong>. {MIN_SPEND_LABEL}</> : `${NO_MIN_SPEND_LABEL}.`}</div>
          </>}
          {step === 3 && <>
            <div><h2>Karte gestalten und prüfen</h2><p className="ow-muted" style={{ fontSize: 14 }}>{logoHidden ? "Die Farbe lässt sich später im Kartenstudio ändern." : "Farbe und Logo lassen sich später im Kartenstudio ändern."}</p></div>
            <div className="ow-field"><span className="ow-label" id="su-color-l">Markenfarbe</span>
              <div className="ow-swatches" role="group" aria-labelledby="su-color-l">{SWATCHES.map(hex => <button key={hex} type="button" className="ow-swatch" style={{ backgroundColor: hex }} aria-label={`Farbe ${hex}`} aria-pressed={f.brandColor.toLowerCase() === hex.toLowerCase()} onClick={() => set({ brandColor: hex })} />)}</div>
              <input id="su-brandColor" className="ow-input" style={{ maxWidth: 200 }} value={f.brandColor} maxLength={7} spellCheck={false} onChange={event => set({ brandColor: event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}` })} aria-invalid={Boolean(err("brandColor"))} aria-label="Farbwert (Hex)" />
              {err("brandColor") && <span className="ow-error">{err("brandColor")}</span>}
            </div>
            {!logoHidden && <Field id="su-logo" label="Logo (optional)" hint="PNG, JPG oder WebP bis 2 MB."><input id="su-logo" className="ow-input" style={{ paddingBlock: 8 }} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => set({ logo: event.target.files?.[0] ?? null })} /></Field>}
            <Field id="su-programName" label="Programmname" error={err("programName")}><input id="su-programName" className="ow-input" value={f.programName || programName} maxLength={120} aria-invalid={Boolean(err("programName"))} onChange={event => set({ programName: event.target.value })} /></Field>
            <details><summary style={{ cursor: "pointer", minHeight: 32, fontWeight: 700 }}>Weitere Einstellungen</summary>
              <div className="ow-stack" style={{ marginTop: 12 }}>
                <Field id="su-date" label="Gültig ab" error={err("date")}><input id="su-date" className="ow-input" type="date" required aria-invalid={Boolean(err("date"))} value={f.date} onChange={event => set({ date: event.target.value })} style={{ maxWidth: 220 }} /></Field>
                {!walletsHidden && <>
                <div className="ow-grid-2"><Field id="su-latitude" label="Breitengrad (optional)" error={err("latitude")}><input id="su-latitude" className="ow-input" inputMode="decimal" aria-invalid={Boolean(err("latitude"))} value={f.latitude} onChange={event => set({ latitude: event.target.value })} /></Field><Field id="su-longitude" label="Längengrad (optional)" error={err("longitude")}><input id="su-longitude" className="ow-input" inputMode="decimal" aria-invalid={Boolean(err("longitude"))} value={f.longitude} onChange={event => set({ longitude: event.target.value })} /></Field></div>
                <span className="ow-hint">Nur die Position deines Geschäfts für Wallet-Hinweise. Es wird kein Kundenstandort gespeichert.</span>
                </>}
              </div>
            </details>
            <div className="ow-card ow-card--flat" style={{ background: "var(--ow-surface-2)" }}>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>Zusammenfassung</h3>
              <dl className="ow-dl">{summary.map(([k, v]) => [<dt key={`${k}-t`}>{k}</dt>, <dd key={`${k}-d`}>{v}</dd>])}</dl>
              <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 14 }} className="ow-muted">
                <li>Das Programm startet mit dem Speichern (gültig ab {f.date}). Kunden können sich dann anmelden.</li>
                <li>Papierstempel werden nicht automatisch übernommen. Dein Team prüft und bestätigt jede Übertragung einzeln.</li>
              </ul>
            </div>
            {error && <Notice tone="danger" role="alert">{error} Deine Eingaben sind noch da.</Notice>}
          </>}
          <div className="ow-row" style={{ justifyContent: "space-between" }}>
            <button type="button" className="ow-btn ow-btn--ghost" onClick={() => { setTried(false); setStep(value => Math.max(0, value - 1)); }} disabled={step === 0 || busy}>Zurück</button>
            {step < 3 ? <button type="submit" className="ow-btn ow-btn--primary">Weiter</button> : <button type="submit" className="ow-btn ow-btn--primary" disabled={busy} aria-busy={busy}>{busy ? "Speichern …" : "Programm starten"}</button>}
          </div>
        </form>
        <aside className="ow-stack" aria-label="Vorschau und Beispiel">
          <div className="ow-card ow-stack"><h2 style={{ fontSize: 16 }}>So sieht die Karte aus</h2>
            <BrowserCardPreview businessName={f.businessName.trim()} locationName={f.locationName.trim()} brandColor={HEX.test(f.brandColor) ? f.brandColor : "#1F4A3A"} programType={f.type} rewardTitle={f.rewardName.trim()} rewardCost={cost ?? 8} balance={cost ? Math.min(2, cost - 1) : 2} />
            <p className="ow-hint">Vorschau mit Beispielstand.</p>
          </div>
          {step === 1 && example && (
            <div className="ow-card ow-stack"><h2 style={{ fontSize: 16 }}>Beispiel durchspielen</h2>
              <Field id="su-amount" label={`Einkaufswert in ${currency === "EUR" ? "€" : currency}`}><input id="su-amount" className="ow-input" inputMode="decimal" placeholder="z. B. 12,90" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
              <div role="status" aria-live="polite">{example.ok ? <p><strong>{euro(example.amountMinor, currency)}</strong> ergeben <strong>{example.points} Punkte</strong>.</p> : example.message ? <p className="ow-error">{example.message}</p> : <p className="ow-muted">Rechnet mit der Formel des Servers.</p>}</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return <div className="ow-field"><label htmlFor={id}>{label}</label>{children}{hint && !error && <span className="ow-hint">{hint}</span>}{error && <span className="ow-error" role="alert">{error}</span>}</div>;
}
