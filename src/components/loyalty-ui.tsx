"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";

export type ProgramType = "stamps" | "points";
export type UiLocale = "de" | "fr";

type IconName =
  | "arrow"
  | "check"
  | "chevron"
  | "clock"
  | "close"
  | "download"
  | "mail"
  | "menu"
  | "scan"
  | "shield"
  | "spark"
  | "stamp"
  | "wallet";

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m4 11 5 5L20 5" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    close: <><path d="M5 5 19 19" /><path d="M19 5 5 19" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 17v3h16v-3" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    scan: <><path d="M4 9V5a1 1 0 0 1 1-1h4" /><path d="M15 4h4a1 1 0 0 1 1 1v4" /><path d="M20 15v4a1 1 0 0 1-1 1h-4" /><path d="M9 20H5a1 1 0 0 1-1-1v-4" /><path d="M4 12h16" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
    spark: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" /><path d="m19 17 .5 1.5L21 19l-1.5.5L19 21l-.5-1.5L17 19l1.5-.5L19 17Z" /></>,
    stamp: <><circle cx="12" cy="8" r="4" /><path d="M8 12c-1 1.5-1 3-1 4h10c0-1 0-2.5-1-4" /><path d="M5 20h14" /></>,
    wallet: <><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 9V6a3 3 0 0 1 3-3h12" /><path d="M17 14h.01" /></>,
  };
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-lockup" aria-label="LoopLocal">
      <span className="brand-symbol" aria-hidden="true"><span /><span /></span>
      {!compact && <span className="brand-word">loop<span>local</span><span className="brand-period">.</span></span>}
    </span>
  );
}

export function SectionHeading({ eyebrow, title, children, centered = false }: { eyebrow: string; title: string; children?: ReactNode; centered?: boolean }) {
  return <div className={`section-heading${centered ? " section-heading--center" : ""}`}><span className="eyebrow"><span className="eyebrow-dot" />{eyebrow}</span><h2>{title}</h2>{children && <p>{children}</p>}</div>;
}

export type DemoRequestInput = { name: string; business: string; email: string; city: string; website?: string };

export function DemoRequestForm({ endpoint = "/api/demo-request" }: { endpoint?: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Die Anfrage konnte nicht gespeichert werden.");
      setStatus("success");
      setMessage(result?.message || "Danke! Deine Anfrage wurde gespeichert.");
      form.reset();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Bitte versuche es erneut.");
    }
  }

  return <form className="demo-form" onSubmit={submit}>
    <div className="form-row">
      <label>Dein Name<input name="name" autoComplete="name" required maxLength={100} placeholder="Vor- und Nachname" /></label>
      <label>Geschäft<input name="business" autoComplete="organization" required maxLength={120} placeholder="Name deines Geschäfts" /></label>
    </div>
    <div className="form-row">
      <label>E-Mail-Adresse<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="du@geschaeft.de" /></label>
      <label>Stadt<input name="city" autoComplete="address-level2" required maxLength={100} placeholder="Zum Beispiel Kassel" /></label>
    </div>
    <div className="honeypot" aria-hidden="true"><label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label></div>
    <p className="form-note">Wir nutzen deine Angaben nur, um auf deine Demo-Anfrage zu antworten. Es wird nichts automatisch versendet.</p>
    <div className="form-submit-row"><button className="button button--ink" type="submit" disabled={status === "sending"}>{status === "sending" ? "Wird gespeichert …" : "Demo anfragen"}<Icon name="arrow" size={18} /></button><span className="form-response" role="status" aria-live="polite" data-state={status}>{message}</span></div>
  </form>;
}

export type SetupInput = {
  businessName: string;
  locationName: string;
  city: string;
  country: "DE" | "MA";
  timezone: string;
  locale: UiLocale;
  currency: "EUR" | "MAD";
  contactEmail: string;
  brandColor: string;
  latitude?: number;
  longitude?: number;
  programName: string;
  type: ProgramType;
  rewardName: string;
  rewardCost: number;
  rules: string;
  effectiveDate: string;
  logoFile: File | null;
};

export type MerchantSetupViewProps = {
  initial?: Partial<Omit<SetupInput, "logoFile">>;
  saving?: boolean;
  error?: string;
  success?: string;
  onSubmit: (input: SetupInput) => void | Promise<void>;
};

export function MerchantSetupView({ initial, saving = false, error, success, onSubmit }: MerchantSetupViewProps) {
  const [businessName, setBusinessName] = useState(initial?.businessName || "");
  const [locationName, setLocationName] = useState(initial?.locationName || "");
  const [city, setCity] = useState(initial?.city || "Kassel");
  const [country, setCountry] = useState<"DE" | "MA">(initial?.country || "DE");
  const [timezone, setTimezone] = useState(initial?.timezone || "Europe/Berlin");
  const [locale, setLocale] = useState<UiLocale>(initial?.locale || "de");
  const currency = country === "DE" ? "EUR" : "MAD";
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail || "");
  const [brandColor, setBrandColor] = useState(initial?.brandColor || "#214739");
  const [latitude, setLatitude] = useState(initial?.latitude?.toString() || "");
  const [longitude, setLongitude] = useState(initial?.longitude?.toString() || "");
  const [coordinateError, setCoordinateError] = useState("");
  const [programName, setProgramName] = useState(initial?.programName || "Treueprogramm");
  const [type, setType] = useState<ProgramType>(initial?.type || "stamps");
  const [rewardName, setRewardName] = useState(initial?.rewardName || "");
  const [rewardCost, setRewardCost] = useState(initial?.rewardCost || 8);
  const [rules, setRules] = useState(initial?.rules || "");
  const [effectiveDate, setEffectiveDate] = useState(initial?.effectiveDate || new Date().toISOString().slice(0, 10));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const previewTextColor = readableTextColor(brandColor);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Boolean(latitude) !== Boolean(longitude)) { setCoordinateError("Bitte beide Standortkoordinaten eingeben oder beide Felder freilassen."); return; }
    setCoordinateError("");
    onSubmit({ businessName: businessName.trim(), locationName: locationName.trim(), city: city.trim(), country, timezone, locale, currency, contactEmail: contactEmail.trim(), brandColor, ...(latitude && longitude ? { latitude: Number(latitude), longitude: Number(longitude) } : {}), programName: programName.trim(), type, rewardName: rewardName.trim(), rewardCost, rules: rules.trim(), effectiveDate, logoFile });
  }

  return <div className="app-page app-page--setup">
    <AppHeader location="Programm einrichten" />
    <main className="app-container setup-layout">
      <div className="setup-main">
        <div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" />DEIN START</span><h1>Ein Programm, das zu deinem Geschäft passt.</h1><p>Lege die Regeln fest. Die Vorschau zeigt, was deine Gäste später sehen.</p></div>
        <form className="setup-form" onSubmit={submit}>
          <section className="app-panel"><div className="panel-head"><span className="step-number">01</span><div><h2>Geschäft & Standort</h2><p>Der Standort erscheint auf der Kundenkarte.</p></div></div>
            <div className="field-grid"><label>Geschäftsname<input value={businessName} onChange={e => setBusinessName(e.target.value)} maxLength={120} required placeholder="Zum Beispiel Café am Platz" /></label><label>Standort<input value={locationName} onChange={e => setLocationName(e.target.value)} maxLength={120} required placeholder="Kassel Mitte" /></label><label>Stadt<input value={city} onChange={e => setCity(e.target.value)} maxLength={120} required placeholder="Kassel" /></label><label>Land<select value={country} onChange={e => { const next = e.target.value as "DE" | "MA"; setCountry(next); setTimezone(next === "DE" ? "Europe/Berlin" : "Africa/Casablanca"); setLocale(next === "DE" ? "de" : "fr"); }}><option value="DE">Deutschland</option><option value="MA">Marokko</option></select></label><label>Kontakt-E-Mail<input value={contactEmail} onChange={e => setContactEmail(e.target.value)} type="email" maxLength={254} required placeholder="hallo@beispiel.de" /></label><label>Zeitzone<select value={timezone} onChange={e => setTimezone(e.target.value)}><option value="Europe/Berlin">Berlin (Deutschland)</option><option value="Africa/Casablanca">Casablanca (Marokko)</option></select></label><label>Programmsprache<select value={locale} onChange={e => setLocale(e.target.value as UiLocale)}><option value="de">Deutsch</option><option value="fr">Français</option></select></label><label>Währung<input readOnly value={currency} aria-label="Währung" /></label></div>
          </section>
          <section className="app-panel"><div className="panel-head"><span className="step-number">02</span><div><h2>Deine Karte</h2><p>Einfach zu erkennen, auch auf kleinen Bildschirmen.</p></div></div>
            <div className="field-grid"><label>Markenfarbe<span className="color-field"><input aria-label="Markenfarbe auswählen" type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)} /><span>{brandColor.toUpperCase()}</span></span></label><label>Logo hochladen <span className="optional">optional</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setLogoFile(e.target.files?.[0] || null)} /><small>PNG, JPG oder WebP. Maximal 2 MB; die Prüfung erfolgt beim Speichern.</small></label></div>
            <details className="coordinate-details"><summary>Standortkoordinaten für Wallet <span>optional</span></summary><p>Nur die Position deines Geschäfts. Wir speichern damit keinen Kundenstandort. Die Funktion wirkt erst, wenn Wallet eingerichtet ist.</p><div className="field-grid"><label>Breitengrad<input type="number" min={-90} max={90} step="any" value={latitude} onChange={e => setLatitude(e.target.value)} placeholder="Zum Beispiel 51.3127" /></label><label>Längengrad<input type="number" min={-180} max={180} step="any" value={longitude} onChange={e => setLongitude(e.target.value)} placeholder="Zum Beispiel 9.4797" /></label></div>{coordinateError && <p className="auth-error" role="alert">{coordinateError}</p>}</details>
          </section>
          <section className="app-panel"><div className="panel-head"><span className="step-number">03</span><div><h2>Prämie & Regeln</h2><p>Stempel und Punkte bleiben bewusst getrennt.</p></div></div>
            <fieldset className="choice-grid"><legend>Programmtyp</legend><label className={`choice-card${type === "stamps" ? " choice-card--selected" : ""}`}><input type="radio" name="type" value="stamps" checked={type === "stamps"} onChange={() => setType("stamps")} /><Icon name="stamp" /><strong>Stempel</strong><span>Ein Besuch, ein Stempel</span></label><label className={`choice-card${type === "points" ? " choice-card--selected" : ""}`}><input type="radio" name="type" value="points" checked={type === "points"} onChange={() => setType("points")} /><Icon name="spark" /><strong>Punkte</strong><span>Flexibel Punkte vergeben</span></label></fieldset>
            <div className="field-grid field-grid--reward"><label>Programmname<input value={programName} onChange={e => setProgramName(e.target.value)} maxLength={120} required placeholder="Zum Beispiel Unsere Treuekarte" /></label><label>Prämie<input value={rewardName} onChange={e => setRewardName(e.target.value)} maxLength={120} required placeholder="Zum Beispiel ein Kaffee" /></label><label>Benötigte {type === "stamps" ? "Stempel" : "Punkte"}<input type="number" min={1} max={100000} step={1} value={rewardCost} onChange={e => setRewardCost(Number(e.target.value))} required /></label><label>Gültig ab<input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} required /></label><label className="field-wide">Teilnahmebedingungen<textarea value={rules} onChange={e => setRules(e.target.value)} maxLength={3000} rows={3} placeholder="Wann gibt es einen Stempel? Welche Prämie ist enthalten?" required minLength={10} /></label></div>
          </section>
          {(error || success) && <p className={`inline-message ${error ? "inline-message--error" : "inline-message--success"}`} role="status">{error || success}</p>}
          <div className="form-actions"><button className="button button--ink" type="submit" disabled={saving}>{saving ? "Wird gespeichert …" : "Programm speichern"}<Icon name="arrow" size={18} /></button><span>Prüfe deine Angaben vor dem Speichern. Der Programmtyp bleibt nach der ersten Buchung fest.</span></div>
        </form>
      </div>
      <aside className="setup-preview"><span className="preview-label">LIVE-VORSCHAU</span><div className="preview-card" style={{ backgroundColor: brandColor, color: previewTextColor }}><div className="preview-card-top"><span className="preview-loop">∞</span><span>LOOPLOCAL</span></div><div><span className="preview-card-caption">DEINE TREUEKARTE</span><strong>{businessName || "Dein Geschäft"}</strong><span>{locationName || "Dein Standort"}</span></div><div className="preview-card-footer"><span>{type === "stamps" ? "0 Stempel" : "0 Punkte"}</span><span>↗</span></div></div><div className="preview-explainer"><Icon name="shield" size={18} /><p>Die Vorschau enthält noch keine echte Mitgliedschaft. Deine Gäste sehen später ihre eigene Karte und ihren tatsächlichen Kontostand.</p></div></aside>
    </main>
  </div>;
}

export type DashboardStats = {
  members: number;
  awards: number;
  redemptions: number;
  periodLabel: string;
};
export type DashboardActivity = { id: string; kind: "award" | "redemption" | "reversal"; occurredAt: string; amount: number; unit: string; reference: string };
export type MerchantDashboardViewProps = {
  businessName: string;
  locationName: string;
  programType?: ProgramType;
  rewardName?: string;
  rewardCost?: number;
  stats?: DashboardStats;
  activity?: DashboardActivity[];
  joinUrl?: string;
  onDownloadQr?: () => void;
  demo?: boolean;
  canManageStaff?: boolean;
  exportUrl?: string;
};

export function MerchantDashboardView({ businessName, locationName, programType, rewardName, rewardCost, stats, activity = [], joinUrl, onDownloadQr, demo = false, canManageStaff = false, exportUrl }: MerchantDashboardViewProps) {
  const unit = programType === "points" ? "Punkte" : "Stempel";
  return <div className="app-page">
    <AppHeader location="Übersicht" canManageStaff={canManageStaff} />
    <main className="app-container dashboard-layout"><div className="dashboard-main"><div className="dashboard-head"><div><span className="eyebrow"><span className="eyebrow-dot" />{demo ? "SYNTHETISCHE DEMO" : "DEIN STANDORT"}</span><h1>Guten Tag, {businessName}.</h1><p>{locationName} · Dein Programm auf einen Blick</p></div><Link href="/merchant/program" className="button button--outline">Programm ansehen <Icon name="arrow" size={18} /></Link></div>
      <div className="metric-grid"><MetricCard label="Mitglieder" value={stats?.members} note="Eingeschriebene Karten" /><MetricCard label="Vergaben" value={stats?.awards} note={stats?.periodLabel || "Für den gewählten Zeitraum"} /><MetricCard label="Einlösungen" value={stats?.redemptions} note={stats?.periodLabel || "Für den gewählten Zeitraum"} /></div>
      <section className="app-panel activity-panel"><div className="panel-title-row"><div><span className="tiny-label">TRANSPARENT NACHVOLLZIEHBAR</span><h2>Letzte Vorgänge</h2></div><span className="panel-meta">{stats?.periodLabel || "Aktuelle Aktivität"}</span></div>{activity.length ? <div className="activity-list">{activity.map(item => <div className="activity-row" key={item.id}><span className={`activity-icon activity-icon--${item.kind}`}><Icon name={item.kind === "award" ? "spark" : item.kind === "redemption" ? "check" : "clock"} size={17} /></span><span className="activity-text"><strong>{item.kind === "award" ? "Vergabe" : item.kind === "redemption" ? "Einlösung" : "Korrektur"}</strong><small>{item.reference} · {item.occurredAt}</small></span><strong className="activity-amount">{item.kind === "award" ? "+" : "−"}{item.amount} {item.unit}</strong></div>)}</div> : <div className="empty-state"><span className="empty-state-art"><Icon name="clock" size={28} /></span><strong>Noch keine Vorgänge</strong><p>Sobald an der Kasse gebucht wird, erscheinen die Einträge hier.</p></div>}</section>
    </div><aside className="dashboard-side"><div className="quick-panel"><span className="tiny-label">AN DEINEM TRESEN</span><h2>Gäste einfach einladen.</h2><p>Dein Link führt direkt zur Anmeldung für dieses Programm.</p>{joinUrl ? <><a className="join-url" href={joinUrl}>{joinUrl}</a>{onDownloadQr && <button type="button" className="button button--ink button--full" onClick={onDownloadQr}><Icon name="download" size={18} /> QR-Schild laden</button>}</> : <Link href="/merchant/program" className="button button--ink button--full">Programm fertigstellen <Icon name="arrow" size={18} /></Link>}</div><div className="mini-rule-panel"><span className="tiny-label">AKTUELLE REGEL</span><div><Icon name="stamp" size={21} /><strong>{rewardCost && rewardName ? `${rewardCost} ${unit} → ${rewardName}` : "Noch keine Prämie eingerichtet"}</strong></div><Link href="/merchant/program">Regeln ansehen <Icon name="chevron" size={15} /></Link></div>{exportUrl && <a className="dashboard-export" href={exportUrl} download><Icon name="download" size={17} /> Datenexport für Inhaber</a>}</aside></main>
  </div>;
}

function MetricCard({ label, value, note }: { label: string; value?: number; note: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value === undefined ? "—" : new Intl.NumberFormat("de-DE").format(value)}</strong><small>{note}</small></div>;
}

export type CashierReward = { id: string; name: string; cost: number; eligible: boolean };
export type CashierCard = { id: string; code: string; balance: number; programType: ProgramType; rewards: CashierReward[] };
export type CashierViewProps = {
  locationName: string;
  card?: CashierCard | null;
  busy?: boolean;
  status?: "idle" | "success" | "pending" | "rejected" | "offline";
  message?: string;
  onLookup: (code: string) => void | Promise<void>;
  onStartCamera?: () => void;
  onAward: (card: CashierCard, quantity: number) => void | Promise<void>;
  onRedeem: (card: CashierCard, reward: CashierReward) => void | Promise<void>;
  onClear: () => void;
  locale?: UiLocale;
  onLocaleChange?: (locale: UiLocale) => void;
  showOverview?: boolean;
};

export function CashierView({ locationName, card, busy = false, status = "idle", message, onLookup, onStartCamera, onAward, onRedeem, onClear, locale = "de", onLocaleChange, showOverview = true }: CashierViewProps) {
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [confirm, setConfirm] = useState<{ kind: "award"; quantity: number } | { kind: "redeem"; reward: CashierReward } | null>(null);
  const t = locale === "fr" ? {
    overview: "Vue d’ensemble", mode: "MODE CAISSE", found: "Carte trouvée.", scanTitle: "Scanner la carte. Puis décider.", foundIntro: "Vérifiez le solde et confirmez chaque opération.", scanIntro: "Le scan identifie seulement la carte. Aucune opération n’est enregistrée automatiquement.", success: "Enregistré", pending: "En attente", offline: "Hors connexion", rejected: "Impossible", ready: "Prêt pour la prochaine carte", scanHelp: "Présentez le QR code à la caméra ou saisissez le code de la carte.", camera: "Ouvrir la caméra", manual: "Saisir le code manuellement", check: "Vérifier", cameraFallback: "Caméra indisponible ? Vous pouvez toujours saisir le code manuellement.", verified: "CARTE VÉRIFIÉE", other: "Autre carte", balance: "Solde actuel", stamps: "tampons", points: "points", award: "Ajouter", awardHint: "Choisissez la quantité. Confirmez à l’étape suivante.", decrease: "Diminuer la quantité", increase: "Augmenter la quantité", reviewAward: "Vérifier l’ajout", redeem: "Utiliser une récompense", review: "Vérifier →", unavailable: "Indisponible", noRewards: "Aucune récompense n’est configurée pour cette carte.", footnote: "Une connexion est nécessaire pour utiliser une récompense. Le serveur confirme les opérations.", confirmAward: "Confirmer l’ajout ?", confirmRedeem: "Confirmer la récompense ?", bookFor: "à ajouter à la carte", redeemFor: "à utiliser sur la carte", cancel: "Annuler", yesAward: "Oui, ajouter", yesRedeem: "Oui, utiliser",
  } : {
    overview: "Zur Übersicht", mode: "KASSENMODUS", found: "Karte gefunden.", scanTitle: "Karte scannen. Dann entscheiden.", foundIntro: "Prüfe den Kontostand und bestätige jeden Vorgang bewusst.", scanIntro: "Ein Scan identifiziert nur die Karte. Es wird nichts automatisch gebucht.", success: "Gebucht", pending: "Ausstehend", offline: "Keine Verbindung", rejected: "Nicht möglich", ready: "Bereit für die nächste Karte", scanHelp: "Halte den QR-Code in die Kamera oder gib den Kartencode ein.", camera: "Kamera öffnen", manual: "Kartencode manuell eingeben", check: "Prüfen", cameraFallback: "Kamera nicht verfügbar? Der manuelle Code funktioniert auch ohne Kamerafreigabe.", verified: "GEPRÜFTE KARTE", other: "Andere Karte", balance: "Aktueller Kontostand", stamps: "Stempel", points: "Punkte", award: "vergeben", awardHint: "Wähle die Menge. Du bestätigst im nächsten Schritt.", decrease: "Menge verringern", increase: "Menge erhöhen", reviewAward: "Vergabe prüfen", redeem: "Prämie einlösen", review: "Prüfen →", unavailable: "Nicht verfügbar", noRewards: "Für diese Karte ist keine Prämie eingerichtet.", footnote: "Einlösungen brauchen eine Verbindung. Buchungen werden vom Server bestätigt.", confirmAward: "Vergabe bestätigen?", confirmRedeem: "Einlösung bestätigen?", bookFor: "für Karte", redeemFor: "auf Karte", cancel: "Abbrechen", yesAward: "Ja, vergeben", yesRedeem: "Ja, einlösen",
  };
  const unit = card?.programType === "points" ? t.points : t.stamps;
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  function lookup(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (code.trim()) onLookup(code.trim()); }
  function submitConfirmed() { if (!card || !confirm) return; if (confirm.kind === "award") onAward(card, confirm.quantity); else onRedeem(card, confirm.reward); setConfirm(null); }

  return <div className="cashier-page" lang={locale}>
    <header className="cashier-header"><BrandMark /><span className="cashier-location">{locationName}</span><div className="cashier-header-actions">{onLocaleChange && <select aria-label={locale === "fr" ? "Langue" : "Sprache"} value={locale} onChange={event => onLocaleChange(event.target.value as UiLocale)}><option value="de">DE</option><option value="fr">FR</option></select>}{showOverview && <Link href="/merchant" className="cashier-exit">{t.overview} <Icon name="arrow" size={16} /></Link>}</div></header>
    <main className="cashier-main"><div className="cashier-intro"><span className="eyebrow"><span className="eyebrow-dot" />{t.mode}</span><h1>{card ? t.found : t.scanTitle}</h1><p>{card ? t.foundIntro : t.scanIntro}</p></div>
      {status !== "idle" && <div className={`cashier-status cashier-status--${status}`} role="status" aria-live="polite"><Icon name={status === "success" ? "check" : status === "offline" ? "clock" : "shield"} size={22} /><span><strong>{status === "success" ? t.success : status === "pending" ? t.pending : status === "offline" ? t.offline : t.rejected}</strong>{message && <small>{message}</small>}</span></div>}
      {!card ? <section className="cashier-scan-card"><h2>{t.ready}</h2>{onStartCamera && <button className="button button--accent button--full cashier-camera-action" type="button" onClick={onStartCamera} disabled={busy}><Icon name="scan" size={20} /> {t.camera}</button>}<p>{t.scanHelp}</p><form className="cashier-code-form" onSubmit={lookup}><label htmlFor="cashier-code">{t.manual}</label><div><input id="cashier-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" placeholder="sc_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" aria-describedby="cashier-code-hint" required /><button className="button button--ink" type="submit" disabled={busy}>{t.check}</button></div><small id="cashier-code-hint" className="camera-help">{locale === "fr" ? "Le code commence par sc_ et comporte ensuite 32 caractères." : "Der Code beginnt mit sc_ und enthält danach 32 Zeichen."}</small></form><small className="camera-help">{t.cameraFallback}</small></section> : <section className="cashier-card-result"><div className="card-result-head"><div><span className="tiny-label">{t.verified}</span><h2>{card.code}</h2></div><button type="button" className="text-button" onClick={() => { setConfirm(null); onClear(); }}>{t.other} <Icon name="close" size={16} /></button></div><div className="balance-display"><span>{t.balance}</span><strong>{number.format(card.balance)} <em>{unit}</em></strong></div><div className="cashier-action-block"><h3>{locale === "fr" ? `${t.award} des ${unit}` : `${unit} ${t.award}`}</h3><p>{t.awardHint}</p><div className="quantity-row"><button type="button" aria-label={t.decrease} onClick={() => setQuantity(q => Math.max(1, q - 1))} disabled={quantity <= 1 || busy}>−</button><output aria-live="polite">{quantity}</output><button type="button" aria-label={t.increase} onClick={() => setQuantity(q => Math.min(100, q + 1))} disabled={quantity >= 100 || busy}>+</button><button type="button" className="button button--accent" onClick={() => setConfirm({ kind: "award", quantity })} disabled={busy}>{t.reviewAward} <Icon name="arrow" size={17} /></button></div></div><div className="cashier-action-block"><h3>{t.redeem}</h3>{card.rewards.length ? <div className="reward-action-list">{card.rewards.map(reward => <button type="button" key={reward.id} disabled={!reward.eligible || busy} onClick={() => setConfirm({ kind: "redeem", reward })}><span><strong>{reward.name}</strong><small>{reward.cost} {unit}</small></span><span>{reward.eligible ? t.review : t.unavailable}</span></button>)}</div> : <p>{t.noRewards}</p>}</div></section>}
      <p className="cashier-footnote"><Icon name="shield" size={16} /> {t.footnote}</p>
    </main>
    {confirm && card && <div className="confirm-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setConfirm(null); }}><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><span className="confirm-icon"><Icon name={confirm.kind === "award" ? "stamp" : "wallet"} size={28} /></span><h2 id="confirm-title">{confirm.kind === "award" ? t.confirmAward : t.confirmRedeem}</h2><p>{confirm.kind === "award" ? `${confirm.quantity} ${unit} ${t.bookFor} ${card.code}.` : `${confirm.reward.name} (${confirm.reward.cost} ${unit}) ${t.redeemFor} ${card.code}.`}</p><div className="confirm-actions"><button type="button" className="button button--outline" onClick={() => setConfirm(null)}>{t.cancel}</button><button type="button" className="button button--ink" onClick={submitConfirmed} disabled={busy}>{confirm.kind === "award" ? t.yesAward : t.yesRedeem}</button></div></div></div>}
  </div>;
}

export type CustomerActivity = { id: string; label: string; date: string; change: number };
export type CustomerCardViewProps = {
  businessName: string;
  locationName: string;
  programType: ProgramType;
  balance: number;
  rewardName?: string;
  rewardCost?: number;
  cardCode: string;
  qrSrc?: string;
  brandColor?: string;
  activity?: CustomerActivity[];
  appleWalletUrl?: string;
  googleWalletUrl?: string;
  onGoogleWallet?: () => void;
  googleWalletBusy?: boolean;
  googlePublishingStatus?: "demo" | "published";
  walletError?: string;
  programTermsUrl?: string;
  rulesText?: string;
  demo?: boolean;
  locale?: UiLocale;
  exportUrl?: string;
  onCloseCard?: () => void | Promise<void>;
  closeBusy?: boolean;
  closeError?: string;
};

export function CustomerCardView({ businessName, locationName, programType, balance, rewardName, rewardCost, cardCode, qrSrc, brandColor = "#214739", activity = [], appleWalletUrl, googleWalletUrl, onGoogleWallet, googleWalletBusy = false, googlePublishingStatus, walletError, programTermsUrl, rulesText, demo = false, locale = "de", exportUrl, onCloseCard, closeBusy = false, closeError }: CustomerCardViewProps) {
  const isFrench = locale === "fr";
  const [codeRevealed, setCodeRevealed] = useState(false);
  const [codeCopyStatus, setCodeCopyStatus] = useState("");
  const [closeExpanded, setCloseExpanded] = useState(false);
  async function copyScanCode() {
    try {
      await navigator.clipboard.writeText(cardCode);
      setCodeCopyStatus(isFrench ? "Code copié." : "Code kopiert.");
    } catch {
      setCodeCopyStatus(isFrench ? "Copie impossible. Sélectionnez le code affiché." : "Kopieren nicht möglich. Markiere den angezeigten Code.");
    }
  }
  const t = isFrench ? {
    header: "VOTRE CARTE", demo: "DÉMO SYNTHÉTIQUE", eyebrow: "HEUREUX DE VOUS REVOIR", heading: "Chaque visite compte.", intro: "Votre carte de fidélité numérique pour", card: "CARTE DE FIDÉLITÉ", codeLabel: "CODE DE LA CARTE", balance: "Votre solde", stamps: "tampons", points: "points", rewardReady: "Votre récompense est disponible. Présentez votre carte en caisse.", left: "encore pour obtenir votre récompense.", show: "À PRÉSENTER EN CAISSE", codeHeading: "Code de votre carte", missingQr: "QR code indisponible", qrAlt: "QR code de la carte", scanNote: "Ce code identifie votre carte. Toute opération doit être confirmée en caisse.", wallet: "Toujours à portée de main", walletFallback: "Votre carte fonctionne directement dans le navigateur. Wallet n’est pas configuré pour ce programme.", googleLoading: "Préparation …", googleDemo: "Google Wallet est en mode test. L’enregistrement est réservé aux comptes de test autorisés.", activity: "Activité récente", activityEmpty: "Aucune opération pour le moment. Vos visites apparaîtront ici après confirmation en caisse.", rules: "Règles du programme", terms: "Autres conditions de participation", privacy: "Confidentialité", export: "Exporter les données de ma carte", footer: "Avec LoopLocal · Votre carte reste accessible sans Wallet.", progress: "Progression vers",
  } : {
    header: "DEINE KARTE", demo: "SYNTHETISCHE DEMO", eyebrow: "SCHÖN, DASS DU DA BIST", heading: "Dein nächster Besuch zählt.", intro: "Deine digitale Treuekarte für", card: "TREUEKARTE", codeLabel: "KARTENCODE", balance: "Dein Kontostand", stamps: "Stempel", points: "Punkte", rewardReady: "Deine Prämie ist verfügbar. Zeige deine Karte an der Kasse.", left: "bis zu deiner Prämie.", show: "AN DER KASSE ZEIGEN", codeHeading: "Dein Kartencode", missingQr: "QR-Code nicht verfügbar", qrAlt: "QR-Code für Karte", scanNote: "Dieser Code zeigt deine Karte an. Buchungen müssen an der Kasse bestätigt werden.", wallet: "Immer griffbereit", walletFallback: "Diese Karte funktioniert direkt im Browser. Wallet ist für dieses Programm derzeit nicht eingerichtet.", googleLoading: "Wird vorbereitet …", googleDemo: "Google Wallet befindet sich im Testmodus. Speichern ist nur für freigegebene Testkonten möglich.", activity: "Letzte Aktivität", activityEmpty: "Noch keine Buchungen. Deine Besuche erscheinen hier, sobald die Kasse sie bestätigt.", rules: "Programmregeln", terms: "Weitere Teilnahmebedingungen", privacy: "Datenschutz", export: "Meine Kartendaten exportieren", footer: "Mit LoopLocal · Deine Karte bleibt auch ohne Wallet erreichbar.", progress: "Fortschritt bis",
  };
  const unit = programType === "points" ? t.points : t.stamps;
  const progress = rewardCost ? Math.min(100, Math.round((balance / rewardCost) * 100)) : 0;
  const previewTextColor = readableTextColor(brandColor);
  const number = new Intl.NumberFormat(isFrench ? "fr-FR" : "de-DE");
  return <div className="customer-page" lang={locale}>
    <header className="customer-header"><BrandMark /><span>{t.header}</span></header>
    <main className="customer-main">
      {demo && <span className="demo-ribbon">{t.demo}</span>}
      <div className="customer-heading"><span className="eyebrow"><span className="eyebrow-dot" />{t.eyebrow}</span><h1>{t.heading}</h1><p>{t.intro} {businessName}.</p></div>
      <div className="customer-card" style={{ backgroundColor: brandColor, color: previewTextColor }}><div className="customer-card-top"><span className="customer-card-mark">∞</span><span>{t.card}</span></div><div className="customer-card-business"><strong>{businessName}</strong><span>{locationName}</span></div><div className="customer-card-bottom"><span>{t.show}</span></div></div>
      <section className="customer-qr-panel"><span className="tiny-label">{t.show}</span><h2>{t.codeHeading}</h2>{qrSrc ? <div className="customer-qr"><Image unoptimized src={qrSrc} alt={t.qrAlt} width={188} height={188} /></div> : <div className="customer-qr-missing"><Icon name="scan" size={40} /><span>{t.missingQr}</span></div>}<div className="customer-code-actions"><button type="button" className="text-button" aria-expanded={codeRevealed} aria-controls="customer-scan-code" onClick={() => setCodeRevealed(value => !value)}>{codeRevealed ? isFrench ? "Masquer le code" : "Kartencode verbergen" : isFrench ? "Afficher le code" : "Kartencode anzeigen"}</button>{codeRevealed && <button type="button" className="text-button" onClick={copyScanCode}>{isFrench ? "Copier le code" : "Kartencode kopieren"}</button>}</div>{codeRevealed && <code id="customer-scan-code">{cardCode}</code>}{codeCopyStatus && <p role="status">{codeCopyStatus}</p>}</section>
      <section className="customer-balance-panel"><div className="customer-balance-line"><div><span>{t.balance}</span><strong>{number.format(balance)} <em>{unit}</em></strong></div><span className="balance-round-icon"><Icon name="stamp" size={25} /></span></div>{rewardName && rewardCost && <div className="reward-progress"><div className="reward-progress-caption"><strong>{rewardName}</strong><span>{Math.min(balance, rewardCost)} / {rewardCost} {unit}</span></div><div className="progress-track" role="progressbar" aria-label={`${t.progress} ${rewardName}`} aria-valuenow={Math.min(balance, rewardCost)} aria-valuemin={0} aria-valuemax={rewardCost}><span style={{ width: `${progress}%` }} /></div><p>{balance >= rewardCost ? t.rewardReady : isFrench ? `Encore ${rewardCost - balance} ${unit} avant votre récompense.` : `Noch ${rewardCost - balance} ${unit} bis zu deiner Prämie.`}</p></div>}</section>
      <p className="customer-scan-note">{t.scanNote}</p>
      <div className="customer-wallet"><h2>{t.wallet}</h2><p>{isFrench ? "Ajoutez cette page aux favoris de votre navigateur. Gardez son lien privé : sans lui, votre carte ne peut pas encore être récupérée." : "Speichere diese Seite als Lesezeichen. Bewahre den Link privat auf: Ohne ihn kann deine Karte derzeit nicht wiederhergestellt werden."}</p>{appleWalletUrl || googleWalletUrl || onGoogleWallet ? <div className="wallet-actions">{appleWalletUrl && <a href={appleWalletUrl} className="button button--outline"><Icon name="wallet" size={18} /> Apple Wallet</a>}{googleWalletUrl && <a href={googleWalletUrl} className="button button--outline"><Icon name="wallet" size={18} /> Google Wallet</a>}{onGoogleWallet && <button type="button" onClick={onGoogleWallet} disabled={googleWalletBusy} className="button button--outline"><Icon name="wallet" size={18} /> {googleWalletBusy ? t.googleLoading : "Google Wallet"}</button>}</div> : <p>{t.walletFallback}</p>}{googlePublishingStatus === "demo" && (googleWalletUrl || onGoogleWallet) && <p className="wallet-mode-note">{t.googleDemo}</p>}{walletError && <p className="wallet-error" role="alert">{walletError}</p>}</div>
      <section className="customer-activity"><div className="panel-title-row"><h2>{t.activity}</h2><Icon name="clock" size={19} /></div>{activity.length ? <div className="customer-activity-list">{activity.map(item => <div key={item.id}><span><strong>{item.label}</strong><small>{item.date}</small></span><strong>{item.change > 0 ? "+" : ""}{item.change} {unit}</strong></div>)}</div> : <p>{t.activityEmpty}</p>}</section>
      {rulesText && <section className="customer-rules"><h2>{t.rules}</h2><p>{rulesText}</p><a href="/teilnahmebedingungen">{t.terms}</a> · <a href="/datenschutz">{t.privacy}</a></section>}
      {programTermsUrl && <a className="terms-link" href={programTermsUrl}>{t.terms} <Icon name="arrow" size={15} /></a>}
      {exportUrl && <a className="terms-link" href={exportUrl} download><Icon name="download" size={15} /> {t.export}</a>}
      {onCloseCard && <section className="customer-close"><button type="button" className="text-button" aria-expanded={closeExpanded} onClick={() => setCloseExpanded(value => !value)}>{isFrench ? "Fermer ma carte" : "Karte schließen"}</button>{closeExpanded && <div className="customer-close-confirm"><p>{isFrench ? "Exportez d’abord les données de votre carte. Après fermeture, ce lien et le QR code ne fonctionneront plus ; le solde ne sera plus utilisable. Les données de contact et de récupération sont supprimées. Les opérations restent provisoirement enregistrées sous un identifiant de carte pseudonyme, jusqu’à la définition d’une règle de conservation vérifiée." : "Exportiere deine Kartendaten zuerst. Danach funktionieren dieser Kartenlink und der QR-Code nicht mehr; das Guthaben ist nicht mehr nutzbar. Kontakt- und Wiederherstellungsdaten werden entfernt. Buchungen und Einlösungen bleiben vorerst unter einer pseudonymen Karten-ID gespeichert, bis eine geprüfte Aufbewahrungsregel feststeht."}</p><button type="button" className="button button--outline" onClick={onCloseCard} disabled={closeBusy}>{closeBusy ? isFrench ? "Fermeture …" : "Wird geschlossen …" : isFrench ? "Confirmer la fermeture définitive" : "Schließung verbindlich bestätigen"}</button>{closeError && <p role="alert">{closeError}</p>}</div>}</section>}
    </main><footer className="customer-footer">{t.footer}</footer>
  </div>;
}

function AppHeader({ location, canManageStaff = false }: { location: string; canManageStaff?: boolean }) {
  return <header className="app-header"><div className="app-header-inner"><Link href="/merchant" aria-label="Zur Übersicht"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link>{canManageStaff && <Link href="/merchant/staff">Team</Link>}<Link href="/cashier">Kasse</Link></nav><span className="app-header-location">{location}</span></div></header>;
}

function readableTextColor(hex: string) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? "#17352d" : "#ffffff";
}
