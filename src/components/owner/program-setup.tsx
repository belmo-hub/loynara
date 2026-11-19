"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Coins, Gift, ReceiptText, ScrollText, Stamp, Store, Users } from "lucide-react";
import { ClientApiError, imageToDataUrl, postJson } from "@/components/client-api";
import { purchaseRuleSentence } from "@/lib/points";
import { withUnit } from "@/lib/units";
import { setupReviewValidation } from "./program-setup-validation";
import { useDirtyGuard, useOwner } from "./owner-context";
import { CardLinePreview, Notice, NumberStepper } from "./owner-ui";
import { quoteStart } from "./program-list";
import { Choices, Control, FieldError } from "./question-form";
import { confirmSentence, draftRules, euro, EXTRA_RULES_LABEL, MAX_POINTS_PER_CURRENCY_UNIT, minimumSpendMinor, MIN_SPEND_LABEL, noMinSpendNote, parseWholeNumber, purchaseExample, REWARD_NAME_MISSING, RULE_PLACEHOLDER, ruleKind, SETUP_EXTRA_RULES_HINT, SHORT_NAME, SHORT_RULE, unitDative, unitName, WHOLE_NUMBER, type EarningMode, type ProgramKind } from "./program-helpers";

type Preset = { id: string; label: string; type: ProgramKind; reward: string; cost: number };
// Editable starting points only. They are examples, not approved or recommended commercial programmes.
const PRESETS: Preset[] = [
  { id: "cafe", label: "Café", type: "stamp", reward: "Kaffee aufs Haus", cost: 8 },
  { id: "food", label: "Gastronomie", type: "points", reward: "Dessert aufs Haus", cost: 100 },
  { id: "barber", label: "Barber & Friseur", type: "stamp", reward: "Haarschnitt gratis", cost: 10 },
  { id: "beauty", label: "Beauty", type: "points", reward: "Pflegeprodukt gratis", cost: 150 },
  { id: "other", label: "Sonstiges", type: "stamp", reward: "", cost: 0 },
];
const SWATCHES = ["#1F4A3A", "#2F6B58", "#A8492C", "#2B4A66", "#6B3A6F", "#23282B"];
// Screens 19–22 (ENG-122f): one question per step, the bar under them carries the step (R19 FINAL).
const TITLES = ["Wie heißt dein Geschäft?", "Wie sammeln deine Kunden?", "Was gibt es als erste Prämie?", "Passt das so?"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const COST_MAX = 100_000; // the server's limit for a reward's threshold

export function ProgramSetup() {
  const router = useRouter();
  const owner = useOwner();
  const logoHidden = owner.hiddenSurfaces.includes("cardLogo");
  const walletsHidden = owner.hiddenSurfaces.includes("walletPreviews");
  const heading = useRef<HTMLHeadingElement>(null), fail = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A shop the operator created arrives with its name and place filled in; the owner confirms or changes them.
  const draft = owner.setupDraft;
  const [f, setF] = useState({
    businessName: draft?.businessName ?? "", locationName: draft?.locationName ?? "", city: draft?.city ?? "", country: (draft?.country === "MA" ? "MA" : "DE") as "DE" | "MA", locale: (draft?.locale === "fr" ? "fr" : "de") as "de" | "fr", contactEmail: "", preset: "",
    type: "stamp" as ProgramKind, mode: "manual" as EarningMode, rate: "1", rewardName: "", cost: "", rules: "", rulesEdited: false,
    programName: "", brandColor: "#1F4A3A", logoData: undefined as string | undefined, logoError: "", date: new Date().toISOString().slice(0, 10), latitude: "", longitude: "",
  });
  const [amount, setAmount] = useState("");
  const set = (patch: Partial<typeof f>) => setF(current => ({ ...current, ...patch }));
  // Checked when picked (ENG-135): a file the server would refuse says so here, not after the last step.
  // A later pick wins over a slower earlier read.
  const logoPick = useRef(0);
  const pickLogo = (file: File | undefined, pick = ++logoPick.current) => file ? imageToDataUrl(file).then(logoData => pick === logoPick.current && set({ logoData, logoError: "" }), (cause: Error) => pick === logoPick.current && set({ logoData: undefined, logoError: cause.message })) : set({ logoData: undefined, logoError: "" });
  const touched = f.businessName !== (draft?.businessName ?? "") || f.locationName !== (draft?.locationName ?? "") || f.city !== (draft?.city ?? "") || Boolean(f.rewardName || f.cost);
  useDirtyGuard("program-setup", touched && !busy);

  const currency = f.country === "DE" ? "EUR" : "MAD";
  const rate = Number(f.rate);
  const cost = parseWholeNumber(f.cost);
  const effectiveMode: EarningMode = f.type === "stamp" ? "manual" : f.mode;
  const rateValid = effectiveMode !== "purchase" || (Number.isInteger(rate) && rate >= 1 && rate <= MAX_POINTS_PER_CURRENCY_UNIT);
  const rulesText = f.rulesEdited ? f.rules : draftRules(f.type, effectiveMode);
  // By purchase amount the card states the earning itself, so the field holds optional extra rules (W51).
  const kind = ruleKind(f.type, effectiveMode), extras = kind === "purchase";
  const programName = f.programName || (f.businessName.trim() ? `${f.businessName.trim()} Treuekarte` : "Treueprogramm");
  const reviewValidation = setupReviewValidation({ programName, date: f.date, latitude: f.latitude, longitude: f.longitude });

  const problems: Array<Record<string, string>> = [
    { businessName: f.businessName.trim().length < 2 ? "Bitte den Geschäftsnamen eingeben." : "", locationName: f.locationName.trim().length < 2 ? "Bitte den Standort benennen." : "", city: f.city.trim().length < 2 ? "Bitte die Stadt eingeben." : "", contactEmail: f.contactEmail && !/^\S+@\S+\.\S+$/.test(f.contactEmail) ? "Bitte eine gültige E-Mail-Adresse eingeben." : "" },
    { rate: rateValid ? "" : `Gib eine ganze Zahl von 1 bis ${MAX_POINTS_PER_CURRENCY_UNIT} ein.`, rules: !extras && rulesText.trim().length < 10 ? SHORT_RULE : "" },
    { rewardName: !f.rewardName.trim() ? REWARD_NAME_MISSING : f.rewardName.trim().length < 2 ? SHORT_NAME : "", cost: cost === null ? WHOLE_NUMBER : "" },
    { brandColor: HEX.test(f.brandColor) ? "" : "Bitte einen Farbwert wie #1F4A3A eingeben.", logo: f.logoError, ...reviewValidation.problems },
  ];
  const stepProblems = Object.entries(problems[step]).filter(([, message]) => message);
  const firstProblem = problems.findIndex(group => Object.values(group).some(Boolean));
  const reach = firstProblem < 0 ? 3 : firstProblem; // the furthest step the input allows

  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { if (error) fail.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  // Each step is an entry in this page's history, so Back and the phone's back gesture go one step back with the input
  // kept, as in the new-reward steps.
  useEffect(() => { window.history.replaceState({ ...window.history.state, setupStep: 0 }, ""); }, []);
  useEffect(() => {
    const onPop = (event: PopStateEvent) => { setStep(Math.min(Number(event.state?.setupStep) || 0, reach)); setTried(false); setError(""); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [reach]);

  /** A field may sit in a closed „Weitere Einstellungen“: open it before the focus goes there. */
  function focusField(key: string) {
    const input = document.getElementById(`su-${key}`);
    const settings = input?.closest("details");
    if (settings) settings.open = true;
    input?.focus();
  }
  // Into points by purchase amount the text starts over as extra rules (W51); out of it the owner's text stays.
  const earn = (type: ProgramKind, mode: EarningMode) => set({ type, mode, ...(ruleKind(type, mode) === "purchase" ? { rules: "", rulesEdited: false } : {}) });
  // A preset names the reward; its example threshold only comes along where it was made for the same card type.
  function choose(id: string) {
    const preset = PRESETS.find(item => item.id === id)!;
    set({ preset: id, rewardName: preset.reward, ...(preset.cost && preset.type === f.type ? { cost: String(preset.cost) } : {}) });
    if (!preset.reward) requestAnimationFrame(() => document.getElementById("su-rewardName")?.focus());
  }
  function next() {
    setTried(true);
    if (stepProblems.length) { focusField(stepProblems[0][0]); return; }
    window.history.pushState({ setupStep: step + 1 }, "");
    // The threshold starts where a first reward starts on the Programm page: 10 Stempel or 100 Punkte.
    if (step === 1 && !f.cost) set({ cost: f.type === "points" ? "100" : "10" });
    setTried(false); setStep(step + 1);
  }

  async function submit() {
    setTried(true);
    if (problems.some(group => Object.values(group).some(Boolean))) {
      const failing = problems.findIndex(group => Object.values(group).some(Boolean));
      setStep(failing);
      const [field] = Object.entries(problems[failing]).find(([, message]) => message)!;
      requestAnimationFrame(() => focusField(field));
      return;
    }
    setBusy(true); setError("");
    try {
      await postJson<{ programSlug: string }>("/api/merchant/onboard", {
        businessName: f.businessName.trim(), city: f.city.trim(), country: f.country, timezone: draft && draft.country === f.country ? draft.timezone : f.country === "DE" ? "Europe/Berlin" : "Africa/Casablanca", locale: f.locale, currency,
        programName: programName.trim(), programType: f.type, earningMode: effectiveMode, pointsPerCurrencyUnit: f.type === "points" && effectiveMode === "purchase" ? rate : 1,
        rulesText: rulesText.trim(), rewardTitle: f.rewardName.trim(), rewardCost: cost,
        locationName: f.locationName.trim(), ...(f.contactEmail.trim() ? { contactEmail: f.contactEmail.trim() } : {}),
        brandColor: f.brandColor, effectiveDate: f.date, logoData: f.logoData,
        ...reviewValidation.coordinates,
      });
      if (!await owner.refresh()) throw new Error("Die Einrichtung konnte noch nicht geladen werden. Sie kann bereits gespeichert sein. Bitte prüfe den gespeicherten Stand, bevor du erneut startest.");
      router.replace("/merchant");
    } catch (cause) {
      const unconfirmed = cause instanceof ClientApiError && (cause.status === 0 || (cause.status >= 200 && cause.status < 300));
      setError(unconfirmed ? "Die Einrichtung wurde nicht bestätigt. Sie kann bereits gespeichert sein. Bitte prüfe den gespeicherten Stand, bevor du erneut startest." : cause instanceof Error ? cause.message : "Das Programm konnte nicht gespeichert werden.");
    }
    finally { setBusy(false); }
  }

  const example = f.type === "points" && effectiveMode === "purchase" && rateValid ? purchaseExample(amount, rate) : null;
  const minSpend = f.type === "points" && effectiveMode === "purchase" && cost !== null && rateValid ? minimumSpendMinor(cost, rate) : null;
  const err = (key: string) => tried ? problems[step][key] ?? "" : "";
  const invalid = (key: string) => ({ "aria-invalid": Boolean(err(key)), "aria-describedby": err(key) ? `su-${key}-error` : undefined });
  const reward = cost !== null ? `${withUnit(cost, f.type)} → ${f.rewardName.trim()}` : "–";
  // As the sign-up page shows the rules: by purchase amount the system's sentence opens and the owner's text adds to it.
  const shownRules = extras ? [purchaseRuleSentence(rate, currency), rulesText.trim()].filter(Boolean).join("\n\n") : rulesText.trim();
  const points = f.type === "points", sample = f.preset !== "other" && PRESETS.find(preset => preset.id === f.preset)?.type === f.type; // only then did the preset bring its value

  return (
    <div className="ow-page ow-qpage ow-qsetup">
      <header className="ow-pagehead"><div className="ow-qhead">
        {step > 0 && <button type="button" className="ow-back" onClick={() => window.history.back()}><ChevronLeft size={20} aria-hidden="true" />Schritt {step}</button>}
        {/* No „Schritt n von 4“ line above the question (Design's finish review): the bar carries the step. */}
        <div id="su-step" className="ow-qstep" role="img" aria-label={`Schritt ${step + 1} von 4`}><span className="ow-qbar" aria-hidden="true">{TITLES.map((title, index) => <i key={title} data-on={index <= step || undefined} />)}</span></div>
        <h1 ref={heading} tabIndex={-1} aria-describedby="su-step">{TITLES[step]}</h1>
        {step === 0 && <p>Vier kurze Schritte. Nichts wird gespeichert, bis du am Ende bestätigst.</p>}
      </div></header>
      <form className="ow-q" onSubmit={event => { event.preventDefault(); if (step < 3) next(); else void submit(); }} noValidate>
        {step === 0 && <>
          <Field panel id="su-businessName" label="Geschäftsname" error={err("businessName")}><input id="su-businessName" className="ow-input" value={f.businessName} maxLength={120} autoComplete="organization" onChange={event => set({ businessName: event.target.value })} {...invalid("businessName")} placeholder="z. B. Café am Platz" /></Field>
          <Field panel id="su-locationName" label="Standortname" error={err("locationName")}><input id="su-locationName" className="ow-input" value={f.locationName} maxLength={120} onChange={event => set({ locationName: event.target.value })} {...invalid("locationName")} placeholder="z. B. Kassel Mitte" /></Field>
          <Field panel id="su-city" label="Stadt" error={err("city")}><input id="su-city" className="ow-input" value={f.city} maxLength={120} autoComplete="address-level2" onChange={event => set({ city: event.target.value })} {...invalid("city")} /></Field>
          <p className="ow-hint">Name und Standort stehen auf der Kundenkarte.</p>
          <details className="ow-qpanel"><summary>Weitere Einstellungen</summary>
            <div className="ow-stack">
              <Field id="su-country" label="Land"><select id="su-country" className="ow-select" value={f.country} onChange={event => set({ country: event.target.value as "DE" | "MA" })}><option value="DE">Deutschland (EUR)</option><option value="MA">Marokko (MAD)</option></select></Field>
              <Field id="su-locale" label="Sprache der Karte"><select id="su-locale" className="ow-select" value={f.locale} onChange={event => set({ locale: event.target.value as "de" | "fr" })}><option value="de">Deutsch</option><option value="fr">Französisch</option></select></Field>
              <Field id="su-contactEmail" label="Kontakt-E-Mail (optional)" error={err("contactEmail")}><input id="su-contactEmail" className="ow-input" type="email" value={f.contactEmail} onChange={event => set({ contactEmail: event.target.value })} {...invalid("contactEmail")} /></Field>
            </div>
          </details>
        </>}
        {step === 1 && <>
          <Choices name="su-type" label="Sammelart" value={f.type} saved="" onChange={type => earn(type as ProgramKind, f.mode)} options={[
            { value: "stamp", label: "Stempelkarte", sub: "Ein Stempel pro Einkauf oder Produkt, bestätigt von deinem Team.", icon: Stamp },
            { value: "points", label: "Punktekarte", sub: "Punkte nach Einkaufswert oder von Hand. Gut bei unterschiedlich großen Einkäufen.", icon: Coins },
          ]} />
          {points && <>
            <h2 className="ow-qsub">So entstehen Punkte</h2>
            <Choices name="su-mode" label="So entstehen Punkte" value={f.mode} saved="" onChange={mode => earn("points", mode as EarningMode)} options={[
              { value: "purchase", label: "Nach Einkaufswert", sub: "Das Team gibt den Betrag ein, Loynara rechnet und rundet ab.", icon: ReceiptText },
              { value: "manual", label: "Manuell", sub: "Das Team gibt die Punktmenge direkt ein.", icon: Users },
            ]} />
          </>}
          {effectiveMode === "purchase" && <Control id="su-rate" label={`Punkte pro 1 ${currency === "EUR" ? "€" : currency}`} hint={`1 bis ${MAX_POINTS_PER_CURRENCY_UNIT}`} error={err("rate")}>
            <NumberStepper id="su-rate" value={f.rate} onChange={value => set({ rate: value && String(Math.min(Number(value), MAX_POINTS_PER_CURRENCY_UNIT)) })} min={1} max={MAX_POINTS_PER_CURRENCY_UNIT}
              unit={{ one: "Punkt", many: "Punkte" }} invalid={Boolean(err("rate"))} describedBy="su-rate-hint" />
          </Control>}
          {example && <>
            <h2 className="ow-qsub">Beispiel durchspielen</h2>
            <Field panel id="su-amount" label={`Einkaufswert in ${currency === "EUR" ? "€" : currency}`}><input id="su-amount" className="ow-input" inputMode="decimal" placeholder="z. B. 12,90" value={amount} onChange={event => setAmount(event.target.value)} />
              <div role="status" aria-live="polite">{example.ok ? <p><strong>{euro(example.amountMinor, currency)}</strong> ergeben <strong>{withUnit(example.points, "points")}</strong>.</p> : example.message ? <p className="ow-error">{example.message}</p> : <p className="ow-hint">Rechnet genau wie später die Kasse.</p>}</div>
            </Field>
          </>}
          <Field panel id="su-rules" label={extras ? EXTRA_RULES_LABEL : "Regeltext für Kunden"} error={err("rules")} hint={extras ? SETUP_EXTRA_RULES_HINT : "Vorschlag aus deiner Auswahl. Du kannst ihn frei ändern. Prämien stehen automatisch auf der Karte und bei der Anmeldung. Schreib sie hier nicht dazu, dann bleibt alles aktuell."}>
            <textarea id="su-rules" className="ow-textarea" rows={4} value={rulesText} maxLength={3000} placeholder={RULE_PLACEHOLDER[kind]} onChange={event => set({ rules: event.target.value, rulesEdited: true })} {...invalid("rules")} />
          </Field>
          <p className="ow-hint"><strong>Wer bestätigt?</strong> {confirmSentence(f.type, effectiveMode, !owner.hiddenSurfaces.includes("nfc"))}</p>
          <p className="ow-hint">Die Kartenart kannst du nach der Einrichtung nicht mehr ändern.</p>
        </>}
        {step === 2 && <>
          <Choices name="su-preset" label="Deine erste Prämie" value={f.preset} saved="" onChange={choose}
            options={PRESETS.map(preset => ({ value: preset.id, label: preset.reward || "Eigene Prämie", sub: preset.label, icon: Gift }))} />
          <Field panel id="su-rewardName" label="Name der Prämie" error={err("rewardName")}>
            {/* Typing makes it the owner's own reward, unless the text is a preset's again. */}
            <input id="su-rewardName" className="ow-input" value={f.rewardName} maxLength={180} onChange={event => set({ rewardName: event.target.value, preset: PRESETS.find(preset => preset.reward && preset.reward === event.target.value.trim())?.id ?? "other" })} {...invalid("rewardName")} placeholder="z. B. Kaffee aufs Haus" />
          </Field>
          <div className="ow-qpanel ow-qcontrol">
            {/* „Einlösbar ab“ takes the dative („8 Stempeln“, „150 Punkten“); the buttons say „10 Punkte weniger“. */}
            <div><label htmlFor="su-cost">Einlösbar ab</label><NumberStepper id="su-cost" value={f.cost} onChange={value => set({ cost: value && String(Math.min(Number(value), COST_MAX)) })} min={1} max={COST_MAX} stepSize={points ? 10 : 1}
              unit={{ one: unitName(f.type, 1), many: unitDative(f.type), step: unitName(f.type) }} invalid={Boolean(err("cost"))} describedBy={err("cost") ? "su-cost-error" : sample ? "su-cost-hint" : undefined} /></div>
            {err("cost") ? <FieldError id="su-cost-error">{err("cost")}</FieldError> : sample && <p id="su-cost-hint" className="ow-hint">Beispielwert aus der Branchenauswahl. Bitte prüfe ihn für dein Geschäft.</p>}
            {(minSpend !== null || noMinSpendNote(f.type)) && <p className="ow-hint" role="status" aria-live="polite">{minSpend !== null ? <>Mindestumsatz: <strong>{euro(minSpend, currency)}</strong>. {MIN_SPEND_LABEL}</> : `${noMinSpendNote(f.type)}.`}</p>}
          </div>
        </>}
        {step === 3 && <>
          <div className="ow-qpanel">
            <CardLinePreview label="So sieht deine Karte aus" shop={f.businessName.trim()} brandColor={HEX.test(f.brandColor) ? f.brandColor : undefined} rules={shownRules}>{reward}</CardLinePreview>
          </div>
          <ul className="ow-rows">
            {([[Store, "Geschäft", `${f.businessName.trim()} · ${f.locationName.trim()}`], [Gift, "Prämie", reward], [ScrollText, "Regel", quoteStart(shownRules)]] as const).map(([Icon, title, sub]) => (
              <li key={title}><div className="ow-prog-row"><span className="ow-prog-icon"><Icon size={22} aria-hidden="true" /></span><span className="ow-prog-main"><span className="ow-prog-text"><strong>{title}</strong><small>{sub}</small></span></span></div></li>
            ))}
          </ul>
          <details className="ow-qpanel"><summary>Weitere Einstellungen</summary>
            <div className="ow-stack">
              <p className="ow-hint">{logoHidden ? "Die Farbe lässt sich später im Kartenstudio ändern." : "Farbe und Logo lassen sich später im Kartenstudio ändern."}</p>
              <div className="ow-field"><span className="ow-label" id="su-color-l">Markenfarbe</span>
                <div className="ow-swatches" role="group" aria-labelledby="su-color-l">{SWATCHES.map(hex => <button key={hex} type="button" className="ow-swatch" style={{ backgroundColor: hex }} aria-label={`Farbe ${hex}`} aria-pressed={f.brandColor.toLowerCase() === hex.toLowerCase()} onClick={() => set({ brandColor: hex })} />)}</div>
                <input id="su-brandColor" className="ow-input ow-field--narrow" value={f.brandColor} maxLength={7} spellCheck={false} onChange={event => set({ brandColor: event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}` })} {...invalid("brandColor")} aria-label="Farbwert (Hex)" />
                <FieldError id="su-brandColor-error">{err("brandColor")}</FieldError>
              </div>
              {!logoHidden && <Field id="su-logo" label="Logo (optional)" hint="PNG, JPG oder WebP bis 2 MB." error={f.logoError}><div className="ow-logo-row">
                {/* The picked logo itself, as in the card studio, and a German button instead of the browser's own file control. */}
                {f.logoData && <Image unoptimized className="ow-logo-thumb" src={f.logoData} width={112} height={35} alt="Ausgewähltes Logo" style={{ backgroundColor: HEX.test(f.brandColor) ? f.brandColor : undefined }} />}
                <label htmlFor="su-logo" className="ow-btn ow-btn--secondary ow-filebtn">{f.logoData ? "Anderes Logo wählen" : "Logo wählen"}<input id="su-logo" className="ow-sr" type="file" accept="image/png,image/jpeg,image/webp" aria-invalid={Boolean(f.logoError)} aria-describedby={f.logoError ? "su-logo-error" : undefined} onChange={event => void pickLogo(event.target.files?.[0])} /></label>
              </div></Field>}
              <Field id="su-programName" label="Programmname" error={err("programName")}><input id="su-programName" className="ow-input" value={f.programName || programName} maxLength={120} {...invalid("programName")} onChange={event => set({ programName: event.target.value })} /></Field>
              <Field id="su-date" label="Gültig ab" error={err("date")}><input id="su-date" className="ow-input ow-field--narrow" type="date" required {...invalid("date")} value={f.date} onChange={event => set({ date: event.target.value })} /></Field>
              {!walletsHidden && <>
                <div className="ow-grid-2"><Field id="su-latitude" label="Breitengrad (optional)" error={err("latitude")}><input id="su-latitude" className="ow-input" inputMode="decimal" {...invalid("latitude")} value={f.latitude} onChange={event => set({ latitude: event.target.value })} /></Field><Field id="su-longitude" label="Längengrad (optional)" error={err("longitude")}><input id="su-longitude" className="ow-input" inputMode="decimal" {...invalid("longitude")} value={f.longitude} onChange={event => set({ longitude: event.target.value })} /></Field></div>
                <span className="ow-hint">Nur die Position deines Geschäfts für Wallet-Hinweise. Es wird kein Kundenstandort gespeichert.</span>
              </>}
            </div>
          </details>
          <p className="ow-hint">Das Programm startet mit dem Speichern (gültig ab {f.date.split("-").reverse().join(".")}). Kunden können sich dann anmelden.</p>
          <p className="ow-hint">Papierstempel werden nicht automatisch übernommen. Dein Team prüft und bestätigt jede Übertragung einzeln.</p>
          {error && <div ref={fail} className="ow-qfail"><Notice tone="danger" role="alert">{error} Deine Eingaben sind noch da.</Notice></div>}
        </>}
        <div className="ow-qsave">{step < 3 ? <button type="submit" className="ow-btn ow-btn--primary">Weiter</button> : <button type="submit" className="ow-btn ow-btn--primary" disabled={busy} aria-busy={busy}>{busy ? "Speichern …" : "Programm starten"}</button>}</div>
      </form>
    </div>
  );
}

/** One field: on a panel of its own for a step's question (screen 19), plain inside „Weitere Einstellungen“. */
function Field({ id, label, error, hint, panel = false, children }: { id: string; label: string; error?: string; hint?: string; panel?: boolean; children: ReactNode }) {
  return <div className={panel ? "ow-field ow-qpanel" : "ow-field"}><label htmlFor={id}>{label}</label>{children}{error ? <FieldError id={`${id}-error`}>{error}</FieldError> : hint && <p className="ow-hint">{hint}</p>}</div>;
}
