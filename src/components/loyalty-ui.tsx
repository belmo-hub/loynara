"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { quantityPickerMax, type StaffRole } from "@/lib/award-limits";
import { parsePurchaseAmountMinor, purchasePoints } from "@/lib/points";

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
    <span className="brand-lockup" aria-label="Loynara">
      <BrandIcon className="brand-symbol" />
      {!compact && <span className="brand-word">Loynara</span>}
    </span>
  );
}

export function BrandIcon({ className = "", inverse = false }: { className?: string; inverse?: boolean }) {
  return <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="17" fill={inverse ? "#f5efdf" : "#16473f"} /><path d="M17 16v33h30" fill="none" stroke={inverse ? "#16473f" : "#f5efdf"} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="45" cy="21" r="6" fill="#f2a078" /></svg>;
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
  pointsPerCurrencyUnit: number;
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
  const [city, setCity] = useState(initial?.city || "");
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
  const [pointsPerCurrencyUnit, setPointsPerCurrencyUnit] = useState(initial?.pointsPerCurrencyUnit ?? 1);
  const [rewardName, setRewardName] = useState(initial?.rewardName || "");
  const [rewardCost, setRewardCost] = useState(initial?.rewardCost ?? 0);
  const [rules, setRules] = useState(initial?.rules || "");
  const [effectiveDate, setEffectiveDate] = useState(initial?.effectiveDate || new Date().toISOString().slice(0, 10));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const previewTextColor = readableTextColor(brandColor);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Boolean(latitude) !== Boolean(longitude)) { setCoordinateError("Bitte beide Standortkoordinaten eingeben oder beide Felder freilassen."); return; }
    setCoordinateError("");
    onSubmit({ businessName: businessName.trim(), locationName: locationName.trim(), city: city.trim(), country, timezone, locale, currency, contactEmail: contactEmail.trim(), brandColor, ...(latitude && longitude ? { latitude: Number(latitude), longitude: Number(longitude) } : {}), programName: programName.trim(), type, pointsPerCurrencyUnit, rewardName: rewardName.trim(), rewardCost, rules: rules.trim(), effectiveDate, logoFile });
  }

  return <div className="app-page app-page--setup">
    <AppHeader location="Programm einrichten" />
    <main className="app-container setup-layout">
      <div className="setup-main">
        <div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" />PAPIERKARTE DIGITAL</span><h1>Deine bestehende Stempelkarte, digital.</h1><p>Lege deine Papierkarte daneben und übertrage die bestehende Prämie und Stempelregel. Die Vorschau zeigt den Auftritt deines Geschäfts.</p></div>
        <form className="setup-form" onSubmit={submit}>
          <section className="app-panel"><div className="panel-head"><span className="step-number">01</span><div><h2>Dein Geschäft</h2><p>Dieser Name und Standort stehen auf der Kundenkarte.</p></div></div>
            <div className="field-grid"><label>Geschäftsname<input value={businessName} onChange={e => setBusinessName(e.target.value)} maxLength={120} required placeholder="Zum Beispiel Café am Platz" /></label><label>Standort<input value={locationName} onChange={e => setLocationName(e.target.value)} maxLength={120} required placeholder="Zum Beispiel Kassel Mitte" /></label><label>Stadt<input value={city} onChange={e => setCity(e.target.value)} maxLength={120} required placeholder="Zum Beispiel Kassel" /></label><label>Land<select value={country} onChange={e => { const next = e.target.value as "DE" | "MA"; setCountry(next); setTimezone(next === "DE" ? "Europe/Berlin" : "Africa/Casablanca"); setLocale(next === "DE" ? "de" : "fr"); }}><option value="DE">Deutschland</option><option value="MA">Marokko</option></select></label></div>
          </section>
          <section className="app-panel"><div className="panel-head"><span className="step-number">02</span><div><h2>{type === "stamps" ? "Deine bestehende Stempelregel" : "Deine bestehende Punkteregel"}</h2><p>Trage Anzahl, Prämie und Vergabe so ein, wie sie auf deiner Papierkarte gelten.</p></div></div>
            <div className="field-grid field-grid--reward"><label>Prämie auf der Papierkarte<input value={rewardName} onChange={e => setRewardName(e.target.value)} maxLength={120} required placeholder="Zum Beispiel ein Kaffee" /></label><label>Benötigte {type === "stamps" ? "Stempel" : "Punkte"} für diese Prämie<input type="number" min={1} max={100000} step={1} value={rewardCost || ""} onChange={e => setRewardCost(Number(e.target.value))} required placeholder="Anzahl auf der Papierkarte" /></label><label className="field-wide">Wann gibt es {type === "stamps" ? "Stempel" : "Punkte"}?<textarea value={rules} onChange={e => setRules(e.target.value)} maxLength={3000} rows={3} placeholder="Beschreibe die bestehende Vergaberegel und die Prämie genau." required minLength={10} /></label></div>
            {rewardCost > 0 && rewardName.trim() && <p className="setup-rule-summary">Auf der digitalen Karte: <strong>{rewardCost} {type === "stamps" ? "Stempel" : "Punkte"} → {rewardName.trim()}</strong></p>}
            <p className="setup-rule-note">Papierstempel werden nicht automatisch übernommen. Dein Team prüft und bestätigt jede Übertragung einzeln.</p>
          </section>
          <details className="app-panel setup-advanced"><summary><span className="step-number">03</span><span><strong>Weitere Einstellungen</strong><small>Programmname, Gestaltung und technische Angaben bei Bedarf anpassen</small></span></summary>
            <div className="setup-advanced-body">
              <fieldset className="choice-grid"><legend>Programmtyp ändern, falls deine Papierkarte Punkte nutzt</legend><label className={`choice-card${type === "stamps" ? " choice-card--selected" : ""}`}><input type="radio" name="type" value="stamps" checked={type === "stamps"} onChange={() => setType("stamps")} /><Icon name="stamp" /><strong>Stempel</strong><span>Bestehende Stempelregel</span></label><label className={`choice-card${type === "points" ? " choice-card--selected" : ""}`}><input type="radio" name="type" value="points" checked={type === "points"} onChange={() => setType("points")} /><Icon name="spark" /><strong>Punkte</strong><span>Bestehende Punkteregel</span></label></fieldset>
              {type === "points" && <label className="setup-points-rate">Punkte pro 1 {currency}<input type="number" min={1} max={1000} step={1} value={pointsPerCurrencyUnit} onChange={event => setPointsPerCurrencyUnit(Number(event.target.value))} required /><small>Kaufbetrag wird an der Kasse eingegeben. Bruchteile von Punkten werden abgerundet; ein Kauf unter der ersten Punkteschwelle kann keine Punkte ergeben.</small></label>}
              <div className="field-grid"><label>Programmname<input value={programName} onChange={e => setProgramName(e.target.value)} maxLength={120} required placeholder="Zum Beispiel Unsere Treuekarte" /></label><label>Gültig ab<input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} required /></label><label>Markenfarbe<span className="color-field"><input aria-label="Markenfarbe auswählen" type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)} /><span>{brandColor.toUpperCase()}</span></span></label><label>Logo hochladen <span className="optional">optional</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setLogoFile(e.target.files?.[0] || null)} /><small>PNG, JPG oder WebP. Maximal 2 MB; die Prüfung erfolgt beim Speichern.</small></label><label>Kontakt-E-Mail <span className="optional">optional</span><input value={contactEmail} onChange={e => setContactEmail(e.target.value)} type="email" maxLength={254} placeholder="hallo@beispiel.de" /></label><label>Zeitzone<select value={timezone} onChange={e => setTimezone(e.target.value)}><option value="Europe/Berlin">Berlin (Deutschland)</option><option value="Africa/Casablanca">Casablanca (Marokko)</option></select></label><label>Programmsprache<select value={locale} onChange={e => setLocale(e.target.value as UiLocale)}><option value="de">Deutsch</option><option value="fr">Français</option></select></label><label>Währung<input readOnly value={currency} aria-label="Währung" /></label></div>
              <details className="coordinate-details"><summary>Standortkoordinaten für Wallet <span>optional</span></summary><p>Nur die Position deines Geschäfts. Wir speichern damit keinen Kundenstandort. Die Funktion wirkt erst, wenn Wallet eingerichtet ist.</p><div className="field-grid"><label>Breitengrad<input type="number" min={-90} max={90} step="any" value={latitude} onChange={e => setLatitude(e.target.value)} placeholder="Zum Beispiel 51.3127" /></label><label>Längengrad<input type="number" min={-180} max={180} step="any" value={longitude} onChange={e => setLongitude(e.target.value)} placeholder="Zum Beispiel 9.4797" /></label></div></details>
            </div>
          </details>
          {coordinateError && <p className="inline-message inline-message--error" role="alert">{coordinateError}</p>}
          {(error || success) && <p className={`inline-message ${error ? "inline-message--error" : "inline-message--success"}`} role="status">{error || success}</p>}
          <div className="form-actions"><button className="button button--ink" type="submit" disabled={saving}>{saving ? "Wird gespeichert …" : "Bestehende Regel übernehmen"}<Icon name="arrow" size={18} /></button><span>Vergleiche Prämie und Vergaberegel mit deiner Papierkarte. Der Programmtyp bleibt nach der ersten Buchung fest.</span></div>
        </form>
      </div>
      <aside className="setup-preview"><span className="preview-label">LIVE-VORSCHAU</span><div className="preview-card" style={{ backgroundColor: brandColor, color: previewTextColor }}><div className="preview-card-top"><span>{type === "stamps" ? "STEMPELKARTE" : "PUNKTEKARTE"}</span><span>mit Loynara</span></div><div><span className="preview-card-caption">DEIN GESCHÄFT</span><strong>{businessName || "Dein Geschäft"}</strong><span>{locationName || "Dein Standort"}</span></div><div className="preview-card-footer"><span>{type === "stamps" ? "0 Stempel" : "0 Punkte"}</span><span>{rewardCost > 0 ? `Prämie ab ${rewardCost}` : "Prämie noch offen"}</span></div></div><div className="preview-explainer"><Icon name="shield" size={18} /><p>Die Vorschau enthält noch keine echte Mitgliedschaft. Deine Gäste sehen später ihre eigene Karte und ihren tatsächlichen Kontostand.</p></div></aside>
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
  onDownloadSign?: () => void;
  signError?: string;
  demo?: boolean;
  canManageStaff?: boolean;
  canViewCustomers?: boolean;
  exportUrl?: string;
};

export function MerchantDashboardView({ businessName, locationName, programType, rewardName, rewardCost, stats, activity = [], joinUrl, onDownloadSign, signError, demo = false, canManageStaff = false, canViewCustomers = false, exportUrl }: MerchantDashboardViewProps) {
  const unit = programType === "points" ? "Punkte" : "Stempel";
  return <div className="app-page">
    <AppHeader location="Übersicht" canManageStaff={canManageStaff} canViewCustomers={canViewCustomers} />
    <main className="app-container dashboard-layout"><div className="dashboard-main"><div className="dashboard-head"><div><span className="eyebrow"><span className="eyebrow-dot" />{demo ? "SYNTHETISCHE DEMO" : "DEIN STANDORT"}</span><h1>Guten Tag, {businessName}.</h1><p>{locationName} · Dein Programm auf einen Blick</p></div><Link href="/merchant/program" className="button button--outline">Programm ansehen <Icon name="arrow" size={18} /></Link></div>
      <div className="metric-grid"><MetricCard label="Mitglieder" value={stats?.members} note="Eingeschriebene Karten" /><MetricCard label="Vergaben" value={stats?.awards} note={stats?.periodLabel || "Für den gewählten Zeitraum"} /><MetricCard label="Einlösungen" value={stats?.redemptions} note={stats?.periodLabel || "Für den gewählten Zeitraum"} /></div>
      <section className="app-panel activity-panel"><div className="panel-title-row"><div><span className="tiny-label">TRANSPARENT NACHVOLLZIEHBAR</span><h2>Letzte Vorgänge</h2></div><span className="panel-meta">{stats?.periodLabel || "Aktuelle Aktivität"}</span></div>{activity.length ? <div className="activity-list">{activity.map(item => <div className="activity-row" key={item.id}><span className={`activity-icon activity-icon--${item.kind}`}><Icon name={item.kind === "award" ? "spark" : item.kind === "redemption" ? "check" : "clock"} size={17} /></span><span className="activity-text"><strong>{item.kind === "award" ? "Vergabe" : item.kind === "redemption" ? "Einlösung" : "Korrektur"}</strong><small>{item.reference} · {item.occurredAt}</small></span><strong className="activity-amount">{item.kind === "award" ? "+" : "−"}{item.amount} {item.unit}</strong></div>)}</div> : <div className="empty-state"><span className="empty-state-art"><Icon name="clock" size={28} /></span><strong>Noch keine Vorgänge</strong><p>Sobald an der Kasse gebucht wird, erscheinen die Einträge hier.</p></div>}</section>
    </div><aside className="dashboard-side"><div className="quick-panel"><span className="tiny-label">AN DEINEM TRESEN</span><h2>Gäste einfach einladen.</h2><p>Dein Link führt direkt zur Anmeldung für dieses Programm.</p>{joinUrl ? <><a className="join-url" href={joinUrl}>{joinUrl}</a>{onDownloadSign && <button type="button" className="button button--ink button--full" onClick={onDownloadSign}><Icon name="download" size={18} /> Anmeldeschild laden</button>}{signError && <p className="sign-download-error" role="alert">{signError}</p>}</> : <Link href="/merchant/program" className="button button--ink button--full">Programm fertigstellen <Icon name="arrow" size={18} /></Link>}</div><div className="mini-rule-panel"><span className="tiny-label">AKTUELLE REGEL</span><div><Icon name="stamp" size={21} /><strong>{rewardCost && rewardName ? `${rewardCost} ${unit} → ${rewardName}` : "Noch keine Prämie eingerichtet"}</strong></div><Link href="/merchant/program">Regeln ansehen <Icon name="chevron" size={15} /></Link></div>{canViewCustomers && <Link className="dashboard-export" href="/merchant/customers">Kundenkarten ansehen <Icon name="arrow" size={17} /></Link>}{exportUrl && <a className="dashboard-export" href={exportUrl} download><Icon name="download" size={17} /> Datenexport für Inhaber</a>}</aside></main>
  </div>;
}

function MetricCard({ label, value, note }: { label: string; value?: number; note: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value === undefined ? "—" : new Intl.NumberFormat("de-DE").format(value)}</strong><small>{note}</small></div>;
}

export type CashierReward = { id: string; name: string; cost: number; eligible: boolean };
export type CashierAward = { quantity: number } | { purchaseAmountMinor: number; ruleVersionId: string };
export type CashierCard = { id: string; code: string; cardLocator: string; matchedBy?: "code" | "locator"; balance: number; programType: ProgramType; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; currency: "EUR" | "MAD"; ruleVersionId: string; rewards: CashierReward[] };
export type CashierViewProps = {
  locationName: string;
  card?: CashierCard | null;
  /** Minimal result for a typed card number; the card is opened only after the cashier confirms it. */
  preview?: { cardLocator: string; programName: string; issuedAt: string } | null;
  /**
   * Shown right after a booking, above the scan form: the card is already closed, so nothing on it can be tapped again,
   * and the next card can be scanned at once.
   */
  booked?: { tone: "success" | "pending"; title: string; detail: string; hint?: string } | null;
  onConfirmPreview?: () => void;
  onCancelPreview?: () => void;
  busy?: boolean;
  status?: "idle" | "success" | "pending" | "rejected" | "offline";
  message?: string;
  onLookup: (code: string) => void | Promise<void>;
  /** Focus the card-number field when the scan form appears (handheld scanners type into it). */
  focusCodeInput?: boolean;
  onStartCamera?: () => void;
  onAward: (card: CashierCard, award: CashierAward) => void | Promise<void>;
  onRedeem: (card: CashierCard, reward: CashierReward) => void | Promise<void>;
  onQueueOffline?: (card: CashierCard, award: CashierAward) => void | Promise<void>;
  offlineLeaseExpiresAt?: string;
  offlinePanel?: ReactNode;
  onClear: () => void;
  locale?: UiLocale;
  onLocaleChange?: (locale: UiLocale) => void;
  showOverview?: boolean;
  /** Staff role of the signed-in user; caps the quantity picker at the server limit. Missing means the strictest cap. */
  role?: StaffRole;
  logoutControl?: ReactNode;
};

function previewMonth(isoMonth: string, locale: UiLocale) {
  const [year, month] = isoMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale === "fr" ? "fr-FR" : "de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function CashierView({ locationName, card, preview, booked, onConfirmPreview, onCancelPreview, busy = false, status = "idle", message, onLookup, focusCodeInput = false, onStartCamera, onAward, onRedeem, onQueueOffline, offlineLeaseExpiresAt, offlinePanel, onClear, locale = "de", onLocaleChange, showOverview = true, role, logoutControl }: CashierViewProps) {
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const maxQuantity = quantityPickerMax(role);
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [confirm, setConfirm] = useState<{ kind: "award"; award: CashierAward } | { kind: "redeem"; reward: CashierReward } | null>(null);
  const t = locale === "fr" ? {
    overview: "Vue d’ensemble", mode: "MODE CAISSE", found: "Carte trouvée.", scanTitle: "Scanner la carte. Puis décider.", foundIntro: "Vérifiez le solde et confirmez chaque opération.", scanIntro: "Le scan identifie seulement la carte. Aucune opération n’est enregistrée automatiquement.", success: "Enregistré", pending: "En attente", offline: "Hors connexion", rejected: "Impossible", ready: "Prêt pour la prochaine carte", scanHelp: "Présentez le QR code à la caméra ou saisissez le numéro de la carte.", camera: "Ouvrir la caméra", manual: "Numéro ou code de la carte", check: "Vérifier", cameraFallback: "Caméra indisponible ? Le numéro de carte fonctionne aussi sans caméra.", verified: "CARTE VÉRIFIÉE", other: "Autre carte", balance: "Solde actuel", stamps: "tampons", points: "points", award: "Ajouter", awardHint: "Choisissez la quantité. Confirmez à l’étape suivante.", decrease: "Diminuer la quantité", increase: "Augmenter la quantité", reviewAward: "Vérifier l’ajout", redeem: "Utiliser une récompense", review: "Vérifier →", unavailable: "Indisponible", noRewards: "Aucune récompense n’est configurée pour cette carte.", footnote: "Une connexion est nécessaire pour utiliser une récompense. Le serveur confirme les opérations.", confirmAward: "Confirmer l’ajout ?", confirmRedeem: "Confirmer la récompense ?", bookFor: "à ajouter à la carte", redeemFor: "à utiliser sur la carte", cancel: "Annuler", yesAward: "Oui, ajouter", yesRedeem: "Oui, utiliser",
  } : {
    overview: "Zur Übersicht", mode: "KASSENMODUS", found: "Karte gefunden.", scanTitle: "Karte scannen. Dann entscheiden.", foundIntro: "Prüfe den Kontostand und bestätige jeden Vorgang bewusst.", scanIntro: "Ein Scan identifiziert nur die Karte. Es wird nichts automatisch gebucht.", success: "Gebucht", pending: "Ausstehend", offline: "Keine Verbindung", rejected: "Nicht möglich", ready: "Bereit für die nächste Karte", scanHelp: "Halte den QR-Code in die Kamera oder gib die Kartennummer ein.", camera: "Kamera öffnen", manual: "Kartennummer oder Kartencode", check: "Prüfen", cameraFallback: "Kamera nicht verfügbar? Die Kartennummer funktioniert auch ohne Kamerafreigabe.", verified: "GEPRÜFTE KARTE", other: "Andere Karte", balance: "Aktueller Kontostand", stamps: "Stempel", points: "Punkte", award: "vergeben", awardHint: "Wähle die Menge. Du bestätigst im nächsten Schritt.", decrease: "Menge verringern", increase: "Menge erhöhen", reviewAward: "Vergabe prüfen", redeem: "Prämie einlösen", review: "Prüfen →", unavailable: "Nicht verfügbar", noRewards: "Für diese Karte ist keine Prämie eingerichtet.", footnote: "Einlösungen brauchen eine Verbindung. Buchungen werden vom Server bestätigt.", confirmAward: "Vergabe bestätigen?", confirmRedeem: "Einlösung bestätigen?", bookFor: "für Karte", redeemFor: "auf Karte", cancel: "Abbrechen", yesAward: "Ja, vergeben", yesRedeem: "Ja, einlösen",
  };
  const unit = card?.programType === "points" ? t.points : t.stamps;
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const purchaseMode = card?.programType === "points" && card.earningMode === "purchase";
  let purchasePreview: { amountMinor: number; points: number } | null = null;
  if (purchaseMode) {
    try {
      const amountMinor = parsePurchaseAmountMinor(purchaseAmount);
      purchasePreview = { amountMinor, points: purchasePoints(amountMinor, card.pointsPerCurrencyUnit) };
    } catch { purchasePreview = null; }
  }
  const amountLabel = locale === "fr" ? `Montant de l’achat (${card?.currency ?? "EUR"})` : `Kaufbetrag (${card?.currency ?? "EUR"})`;
  // A handheld scanner types the QR content into the field; do not leave that code on screen after submitting it.
  function lookup(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const value = code.trim(); if (!value) return; if (value.startsWith("sc_")) setCode(""); onLookup(value); }
  function submitConfirmed() { if (!card || !confirm) return; if (confirm.kind === "award") onAward(card, confirm.award); else onRedeem(card, confirm.reward); setConfirm(null); }

  return <div className="cashier-page" lang={locale}>
    <header className="cashier-header"><BrandMark /><span className="cashier-location">{locationName}</span><div className="cashier-header-actions">{onLocaleChange && <select aria-label={locale === "fr" ? "Langue" : "Sprache"} value={locale} onChange={event => onLocaleChange(event.target.value as UiLocale)}><option value="de">DE</option><option value="fr">FR</option></select>}{showOverview && <Link href="/merchant" className="cashier-exit">{t.overview} <Icon name="arrow" size={16} /></Link>}{logoutControl}</div></header>
    <main className="cashier-main"><div className="cashier-intro"><span className="eyebrow"><span className="eyebrow-dot" />{t.mode}</span><h1>{card ? t.found : t.scanTitle}</h1><p>{card ? t.foundIntro : t.scanIntro}</p></div>
      {status !== "idle" && !booked && <div className={`cashier-status cashier-status--${status}`} role="status" aria-live="polite"><Icon name={status === "success" ? "check" : status === "offline" ? "clock" : "shield"} size={22} /><span><strong>{status === "success" ? t.success : status === "pending" ? t.pending : status === "offline" ? t.offline : t.rejected}</strong>{message && <small>{message}</small>}</span></div>}
      {booked && <section className={`cashier-booked cashier-booked--${booked.tone}`} role="status" aria-live="polite"><span className="cashier-booked-icon"><Icon name={booked.tone === "success" ? "check" : "clock"} size={26} /></span><h2>{booked.title}</h2><p className="cashier-booked-detail">{booked.detail}</p>{booked.hint && <p className="cashier-booked-hint">{booked.hint}</p>}<button type="button" className="button button--outline button--full" onClick={onClear}>{t.other}</button></section>}
      {!card && preview ? <section className="cashier-scan-card cashier-preview" aria-labelledby="cashier-preview-title"><span className="tiny-label">{locale === "fr" ? "CARTE TROUVÉE" : "KARTE GEFUNDEN"}</span><h2 id="cashier-preview-title">{preview.cardLocator}</h2><p>{preview.programName} · {locale === "fr" ? "émise" : "ausgestellt"} {previewMonth(preview.issuedAt, locale)}</p><p className="camera-help">{locale === "fr" ? "Est-ce la carte devant vous ? Le solde n’est affiché qu’après l’ouverture." : "Ist das die Karte, die vor dir liegt? Der Kontostand erscheint erst nach dem Öffnen."}</p><div className="cashier-preview-actions"><button type="button" className="button button--ink" onClick={onConfirmPreview} disabled={busy} data-autofocus>{locale === "fr" ? "Ouvrir la carte" : "Karte öffnen"}</button><button type="button" className="text-button" onClick={onCancelPreview} disabled={busy}>{locale === "fr" ? "Autre numéro" : "Andere Nummer"}</button></div></section> : !card ? <section className="cashier-scan-card"><h2>{t.ready}</h2>{onStartCamera && <button className="button button--accent button--full cashier-camera-action" type="button" onClick={onStartCamera} disabled={busy}><Icon name="scan" size={20} /> {t.camera}</button>}<p>{t.scanHelp}</p><form className="cashier-code-form" onSubmit={lookup}><label htmlFor="cashier-code">{t.manual}</label><div><input id="cashier-code" autoFocus={focusCodeInput} value={code} onChange={event => setCode(event.target.value)} autoComplete="off" placeholder={locale === "fr" ? "p. ex. K-7QX2MA" : "z. B. K-7QX2MA"} aria-describedby="cashier-code-hint" required /><button className="button button--ink" type="submit" disabled={busy}>{t.check}</button></div><small id="cashier-code-hint" className="camera-help">{locale === "fr" ? "Le numéro figure sous le QR code de la carte client." : "Die Nummer steht unter dem QR-Code der Kundenkarte."}</small></form><small className="camera-help">{t.cameraFallback}</small></section> : <section className="cashier-card-result"><div className="card-result-head"><div><span className="tiny-label">{t.verified}</span><h2>{card.cardLocator}</h2></div><button type="button" className="text-button" onClick={() => { setConfirm(null); onClear(); }}>{t.other} <Icon name="close" size={16} /></button></div>{card.matchedBy === "locator" && <p className="cashier-number-note" role="note">{locale === "fr" ? "Ouverte par numéro, sans scan. Utilisez une récompense seulement si la personne présente sa propre carte." : "Per Kartennummer geöffnet, ohne Scan. Prämien nur einlösen, wenn die Person ihre eigene Karte zeigt."}</p>}<div className="balance-display"><span>{t.balance}</span><strong>{number.format(card.balance)} <em>{unit}</em></strong></div><div className="cashier-action-block"><h3>{locale === "fr" ? `${t.award} des ${unit}` : `${unit} ${t.award}`}</h3>{purchaseMode ? <div className="purchase-award"><p>{locale === "fr" ? `${card.pointsPerCurrencyUnit} point(s) par 1 ${card.currency}. Les fractions sont arrondies vers le bas. Le serveur confirme le calcul.` : `${card.pointsPerCurrencyUnit} Punkte pro 1 ${card.currency}. Punktbruchteile werden abgerundet. Der Server bestätigt die Berechnung.`}</p><label htmlFor="purchase-amount">{amountLabel}</label><div className="purchase-award-row"><input id="purchase-amount" type="text" inputMode="decimal" autoComplete="off" placeholder="16,70" value={purchaseAmount} onChange={event => setPurchaseAmount(event.target.value)} aria-describedby="purchase-preview" /><button type="button" className="button button--accent" onClick={() => { if (purchasePreview) setConfirm({ kind: "award", award: { purchaseAmountMinor: purchasePreview.amountMinor, ruleVersionId: card.ruleVersionId } }); }} disabled={busy || !purchasePreview}>{t.reviewAward} <Icon name="arrow" size={17} /></button></div><small id="purchase-preview" aria-live="polite">{purchasePreview ? locale === "fr" ? `${number.format(purchasePreview.points)} point(s) prévus pour cet achat. Le serveur calcule le montant final.` : `${number.format(purchasePreview.points)} Punkte voraussichtlich für diesen Kauf. Der Server berechnet die endgültige Menge.` : purchaseAmount ? locale === "fr" ? "Saisissez un montant positif avec au plus deux décimales. Les achats sans point ne peuvent pas être enregistrés." : "Positiven Kaufbetrag mit höchstens zwei Nachkommastellen eingeben. Käufe ohne Punkt können nicht gebucht werden." : locale === "fr" ? "Saisissez le montant payé; vérifiez les points avant de confirmer." : "Gezahlten Betrag eingeben und Punkte vor der Bestätigung prüfen."}</small></div> : <><p>{t.awardHint}</p><div className="quantity-row"><button type="button" aria-label={t.decrease} onClick={() => setQuantity(q => Math.max(1, q - 1))} disabled={quantity <= 1 || busy}>−</button><output aria-live="polite">{quantity}</output><button type="button" aria-label={t.increase} onClick={() => setQuantity(q => Math.min(maxQuantity, q + 1))} disabled={quantity >= maxQuantity || busy}>+</button><button type="button" className="button button--accent" onClick={() => setConfirm({ kind: "award", award: { quantity: Math.min(quantity, maxQuantity) } })} disabled={busy}>{t.reviewAward} <Icon name="arrow" size={17} /></button></div></>}</div><div className="cashier-action-block"><h3>{t.redeem}</h3>{card.rewards.length ? <div className="reward-action-list">{card.rewards.map(reward => <button type="button" key={reward.id} disabled={!reward.eligible || busy} onClick={() => setConfirm({ kind: "redeem", reward })}><span><strong>{reward.name}</strong><small>{reward.cost} {unit}</small></span><span>{reward.eligible ? t.review : t.unavailable}</span></button>)}</div> : <p>{t.noRewards}</p>}</div></section>}
      {card && offlineLeaseExpiresAt && <p className="cashier-footnote" role="status">{locale === "fr" ? "Tampon hors ligne préparé jusqu’à" : "Offline-Puffer bereit bis"} {new Date(offlineLeaseExpiresAt).toLocaleTimeString(locale === "fr" ? "fr-FR" : "de-DE", { hour: "2-digit", minute: "2-digit" })}. {locale === "fr" ? "Un ajout en attente ne change pas le solde." : "Eine vorgemerkte Vergabe ändert den Kontostand nicht."}</p>}
      {offlinePanel}
      <p className="cashier-footnote"><Icon name="shield" size={16} /> {t.footnote}</p>
    </main>
    {confirm && card && <div className="confirm-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setConfirm(null); }}><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><span className="confirm-icon"><Icon name={confirm.kind === "award" ? "stamp" : "wallet"} size={28} /></span><h2 id="confirm-title">{confirm.kind === "award" ? t.confirmAward : t.confirmRedeem}</h2><p>{confirm.kind === "award" ? `${"quantity" in confirm.award ? `${confirm.award.quantity} ${unit}` : `${number.format(purchasePoints(confirm.award.purchaseAmountMinor, card.pointsPerCurrencyUnit))} ${unit} ${locale === "fr" ? "pour un achat de" : "für einen Kauf über"} ${number.format(confirm.award.purchaseAmountMinor / 100)} ${card.currency}`} ${t.bookFor} ${card.cardLocator}.` : `${confirm.reward.name} (${confirm.reward.cost} ${unit}) ${t.redeemFor} ${card.cardLocator}.`}</p>{confirm.kind === "award" && onQueueOffline && offlineLeaseExpiresAt && <p className="confirm-offline-note" role="note">{locale === "fr" ? "Connexion au serveur perturbée. « Oui, ajouter » tente l’enregistrement en ligne. La mise en attente hors ligne garde l’ajout seulement sur cet appareil ; il ne compte qu’après la synchronisation." : "Verbindung zum Server gestört. „Ja, vergeben“ versucht die Buchung online. „Offline-Vergabe vormerken“ speichert sie nur auf diesem Gerät; sie zählt erst nach der Synchronisierung."}</p>}<div className="confirm-actions"><button type="button" className="button button--outline" onClick={() => setConfirm(null)}>{t.cancel}</button><button type="button" className="button button--ink" onClick={submitConfirmed} disabled={busy}>{confirm.kind === "award" ? t.yesAward : t.yesRedeem}</button>{confirm.kind === "award" && onQueueOffline && offlineLeaseExpiresAt && <button type="button" className="button button--outline" onClick={() => { onQueueOffline(card, confirm.award); setConfirm(null); }} disabled={busy}>{locale === "fr" ? "Mettre l’ajout hors ligne en attente" : "Offline-Vergabe vormerken"}</button>}</div></div></div>}
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
  rewards?: Array<{ id: string; title: string; cost: number; termsText?: string }>;
  cardLocator?: string;
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
  contactPanel?: ReactNode;
  onCloseCard?: () => void | Promise<void>;
  closeBusy?: boolean;
  closeError?: string;
};

export function CustomerCardView({ businessName, locationName, programType, balance, rewardName, rewardCost, rewards, cardLocator, qrSrc, brandColor = "#214739", activity = [], appleWalletUrl, googleWalletUrl, onGoogleWallet, googleWalletBusy = false, googlePublishingStatus, walletError, programTermsUrl, rulesText, demo = false, locale = "de", exportUrl, contactPanel, onCloseCard, closeBusy = false, closeError }: CustomerCardViewProps) {
  const isFrench = locale === "fr";
  const [linkCopyStatus, setLinkCopyStatus] = useState("");
  const [closeExpanded, setCloseExpanded] = useState(false);
  const [selectedRewardId, setSelectedRewardId] = useState<string | null>(null);
  async function copyCardLink() {
    try {
      const link = new URL(window.location.pathname, window.location.origin).href;
      await navigator.clipboard.writeText(link);
      setLinkCopyStatus(isFrench ? "Lien privé copié." : "Kartenlink kopiert.");
    } catch {
      setLinkCopyStatus(isFrench ? "Copie impossible. Enregistrez cette page avec votre navigateur." : "Kopieren nicht möglich. Speichere diese Seite über deinen Browser.");
    }
  }
  const t = isFrench ? {
    header: "VOTRE CARTE", demo: "DÉMO SYNTHÉTIQUE", eyebrow: "HEUREUX DE VOUS REVOIR", heading: "Chaque visite compte.", intro: "Votre carte de fidélité numérique pour", card: "CARTE DE FIDÉLITÉ", codeLabel: "CODE DE LA CARTE", balance: "Votre solde", stamps: "tampons", points: "points", rewardReady: "Récompense disponible. Demandez son utilisation en caisse.", show: "À PRÉSENTER EN CAISSE", codeHeading: "Votre QR code", missingQr: "QR code indisponible", qrAlt: "QR code de la carte", scanNote: "Ce code identifie votre carte. Toute opération doit être confirmée en caisse.", save: "Comment retrouver votre carte", copyLink: "Copier le lien de la carte", googleLoading: "Préparation …", googleDemo: "Google Wallet est en mode test. L’enregistrement est réservé aux comptes de test autorisés.", activity: "Activité récente", activityEmpty: "Aucune opération pour le moment. Vos visites apparaîtront ici après confirmation en caisse.", rules: "Règles du programme", terms: "Autres conditions de participation", privacy: "Confidentialité", export: "Exporter les données de ma carte", footer: "Avec Loynara", progress: "Progression vers",
  } : {
    header: "DEINE KARTE", demo: "SYNTHETISCHE DEMO", eyebrow: "SCHÖN, DASS DU DA BIST", heading: "Dein nächster Besuch zählt.", intro: "Deine digitale Treuekarte für", card: "TREUEKARTE", codeLabel: "KARTENCODE", balance: "Dein Kontostand", stamps: "Stempel", points: "Punkte", rewardReady: "Prämie verfügbar. Lass sie an der Kasse einlösen.", show: "AN DER KASSE ZEIGEN", codeHeading: "Dein QR-Code", missingQr: "QR-Code nicht verfügbar", qrAlt: "QR-Code für Karte", scanNote: "Dieser Code zeigt deine Karte an. Buchungen müssen an der Kasse bestätigt werden.", save: "So findest du deine Karte wieder", copyLink: "Kartenlink kopieren", googleLoading: "Wird vorbereitet …", googleDemo: "Google Wallet befindet sich im Testmodus. Speichern ist nur für freigegebene Testkonten möglich.", activity: "Letzte Aktivität", activityEmpty: "Noch keine Buchungen. Deine Besuche erscheinen hier, sobald die Kasse sie bestätigt.", rules: "Programmregeln", terms: "Weitere Teilnahmebedingungen", privacy: "Datenschutz", export: "Meine Kartendaten exportieren", footer: "Mit Loynara", progress: "Fortschritt bis",
  };
  const unit = programType === "points" ? t.points : t.stamps;
  const availableRewards = rewards?.length ? rewards : rewardName && rewardCost ? [{ id: "default", title: rewardName, cost: rewardCost }] : [];
  const nearestReward = [...availableRewards].sort((a, b) => Math.max(0, a.cost - balance) - Math.max(0, b.cost - balance) || a.cost - b.cost)[0];
  const selectedReward = availableRewards.find(reward => reward.id === selectedRewardId) ?? nearestReward;
  const progress = selectedReward ? Math.min(100, Math.round((balance / selectedReward.cost) * 100)) : 0;
  const remaining = selectedReward ? Math.max(0, selectedReward.cost - balance) : 0;
  const previewTextColor = readableTextColor(brandColor);
  const number = new Intl.NumberFormat(isFrench ? "fr-FR" : "de-DE");
  return <div className="customer-page" lang={locale}>
    <header className="customer-header"><h1 className="customer-header-merchant">{businessName}</h1><span>{t.header}</span></header>
    <main className="customer-main">
      {demo && <span className="demo-ribbon">{t.demo}</span>}
      <div className="customer-heading"><span className="eyebrow"><span className="eyebrow-dot" />{t.eyebrow}</span><h2>{t.heading}</h2><p>{t.intro} {businessName}.</p></div>
      <div className="customer-card" style={{ backgroundColor: brandColor, color: previewTextColor }}><div className="customer-card-top"><BrandIcon className="customer-card-mark" inverse /><span>{t.card}</span></div><div className="customer-card-business"><strong>{businessName}</strong><span>{locationName}</span></div><div className="customer-card-bottom"><span>{t.show}</span></div></div>
      <section className="customer-qr-panel"><span className="tiny-label">{t.show}</span><h2>{t.codeHeading}</h2>{qrSrc ? <div className="customer-qr"><Image unoptimized src={qrSrc} alt={t.qrAlt} width={188} height={188} /></div> : <div className="customer-qr-missing"><Icon name="scan" size={40} /><span>{t.missingQr}</span></div>}{cardLocator && <p className="customer-card-number"><span>{isFrench ? "Numéro de carte" : "Kartennummer"}</span><strong>{cardLocator}</strong><small>{isFrench ? "À indiquer en caisse si le code ne se scanne pas." : "An der Kasse nennen, falls der Code nicht scannt."}</small></p>}</section>
      <section className="customer-balance-panel"><div className="customer-balance-line"><div><span>{t.balance}</span><strong>{number.format(balance)} <em>{unit}</em></strong></div><span className="balance-round-icon"><Icon name="stamp" size={25} /></span></div>{selectedReward && <div className="reward-progress"><div className="reward-progress-caption"><strong>{selectedReward.title}</strong><span>{number.format(Math.min(balance, selectedReward.cost))} / {number.format(selectedReward.cost)} {unit}</span></div><div className="progress-track" role="progressbar" aria-label={`${t.progress} ${selectedReward.title}`} aria-valuenow={Math.min(balance, selectedReward.cost)} aria-valuemin={0} aria-valuemax={selectedReward.cost}><span style={{ width: `${progress}%` }} /></div><p className="reward-remaining">{remaining === 0 ? t.rewardReady : isFrench ? `Encore ${number.format(remaining)} ${unit} pour « ${selectedReward.title} ».` : `Noch ${number.format(remaining)} ${remaining === 1 && programType === "points" ? "Punkt" : unit} für „${selectedReward.title}“.`}</p></div>}</section>
      <p className="customer-scan-note">{t.scanNote}</p>
      {availableRewards.length > 1 && <section className="customer-reward-choices"><h2>{isFrench ? "Choisir une récompense" : "Prämie auswählen"}</h2><div role="group" aria-label={isFrench ? "Récompenses" : "Prämien"}>{availableRewards.map(reward => <button type="button" key={reward.id} aria-pressed={selectedReward?.id === reward.id} onClick={() => setSelectedRewardId(reward.id)}><strong>{reward.title}</strong><span>{number.format(reward.cost)} {unit}</span></button>)}</div></section>}
      <div className="customer-wallet"><h2>{t.save}</h2><ol className="customer-return-steps">
        <li>{isFrench ? "Ajoutez cette page aux favoris ou à l’écran d’accueil." : "Speichere diese Seite als Lesezeichen oder auf dem Home-Bildschirm."}</li>
        <li>{isFrench ? "Ou scannez simplement le QR code au comptoir lors de votre prochaine visite : sur ce téléphone et dans ce navigateur, nous vous proposerons alors votre carte. Cela ne fonctionne pas en navigation privée ni après la suppression des données du navigateur." : "Oder scanne beim nächsten Besuch einfach wieder den QR-Code am Tresen: Auf diesem Handy und in diesem Browser bieten wir dir dann deine Karte an. Im privaten Modus oder nach dem Löschen der Browserdaten klappt das nicht."}</li>
        {cardLocator && <li>{isFrench ? <>Notez votre numéro de carte <strong>{cardLocator}</strong>. Si vous perdez l’accès à cette carte, le commerce peut la retrouver avec ce numéro et, après vérification, vous remettre un nouveau lien.</> : <>Notiere dir deine Kartennummer <strong>{cardLocator}</strong>. Verlierst du den Zugang zu dieser Karte, kann das Geschäft sie mit dieser Nummer finden und dir nach einer Prüfung einen neuen Kartenlink geben.</>}</li>}
      </ol><p className="customer-link-warning">{isFrench ? "Toute personne qui possède le lien de la carte peut l’ouvrir. Ne le partagez pas." : "Wer den Kartenlink hat, kann die Karte öffnen. Gib ihn nicht weiter."}</p><button type="button" className="button button--outline customer-save-link" onClick={copyCardLink}>{t.copyLink}</button>{linkCopyStatus && <p className="customer-link-status" role="status">{linkCopyStatus}</p>}{appleWalletUrl || googleWalletUrl || onGoogleWallet ? <div className="wallet-actions">{appleWalletUrl && <a href={appleWalletUrl} className="button button--outline"><Icon name="wallet" size={18} /> Apple Wallet</a>}{googleWalletUrl && <a href={googleWalletUrl} className="button button--outline"><Icon name="wallet" size={18} /> Google Wallet</a>}{onGoogleWallet && <button type="button" onClick={onGoogleWallet} disabled={googleWalletBusy} className="button button--outline"><Icon name="wallet" size={18} /> {googleWalletBusy ? t.googleLoading : "Google Wallet"}</button>}</div> : null}{googlePublishingStatus === "demo" && (googleWalletUrl || onGoogleWallet) && <p className="wallet-mode-note">{t.googleDemo}</p>}{walletError && <p className="wallet-error" role="alert">{walletError}</p>}{contactPanel}</div>
      <section className="customer-activity"><div className="panel-title-row"><h2>{t.activity}</h2><Icon name="clock" size={19} /></div>{activity.length ? <div className="customer-activity-list">{activity.map(item => <div key={item.id}><span><strong>{item.label}</strong><small>{item.date}</small></span><strong>{item.change > 0 ? "+" : ""}{item.change} {unit}</strong></div>)}</div> : <p>{t.activityEmpty}</p>}</section>
      {rulesText && <section className="customer-rules"><h2>{t.rules}</h2><p>{rulesText}</p><a href="/teilnahmebedingungen">{t.terms}</a> · <a href="/datenschutz">{t.privacy}</a></section>}
      {programTermsUrl && <a className="terms-link" href={programTermsUrl}>{t.terms} <Icon name="arrow" size={15} /></a>}
      {exportUrl && <a className="terms-link" href={exportUrl} download><Icon name="download" size={15} /> {t.export}</a>}
      {onCloseCard && <section className="customer-close"><button type="button" className="text-button" aria-expanded={closeExpanded} onClick={() => setCloseExpanded(value => !value)}>{isFrench ? "Fermer ma carte" : "Karte schließen"}</button>{closeExpanded && <div className="customer-close-confirm"><p>{isFrench ? "Exportez d’abord les données de votre carte. Après fermeture, ce lien et le QR code ne fonctionneront plus ; le solde ne sera plus utilisable. Les données de contact et de récupération sont supprimées. Les opérations restent provisoirement enregistrées sous un identifiant de carte pseudonyme, jusqu’à la définition d’une règle de conservation vérifiée." : "Exportiere deine Kartendaten zuerst. Danach funktionieren dieser Kartenlink und der QR-Code nicht mehr; das Guthaben ist nicht mehr nutzbar. Kontakt- und Wiederherstellungsdaten werden entfernt. Buchungen und Einlösungen bleiben vorerst unter einer pseudonymen Karten-ID gespeichert, bis eine geprüfte Aufbewahrungsregel feststeht."}</p><button type="button" className="button button--outline" onClick={onCloseCard} disabled={closeBusy}>{closeBusy ? isFrench ? "Fermeture …" : "Wird geschlossen …" : isFrench ? "Confirmer la fermeture définitive" : "Schließung verbindlich bestätigen"}</button>{closeError && <p role="alert">{closeError}</p>}</div>}</section>}
    </main><footer className="customer-footer">{t.footer}</footer>
  </div>;
}

function AppHeader({ location, canManageStaff = false, canViewCustomers = false }: { location: string; canManageStaff?: boolean; canViewCustomers?: boolean }) {
  return <header className="app-header"><div className="app-header-inner"><Link href="/merchant" aria-label="Zur Übersicht"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link>{canViewCustomers && <><Link href="/merchant/customers">Kundenkarten</Link><Link href="/merchant/audiences">Zielgruppen</Link></>}{canManageStaff && <><Link href="/merchant/locations">Standorte</Link><Link href="/merchant/campaigns">Kampagnen</Link><Link href="/merchant/automations">Automationen</Link><Link href="/merchant/referrals">Empfehlungen</Link><Link href="/merchant/analytics">Auswertung</Link><Link href="/merchant/adviser">Beratung</Link><Link href="/merchant/billing">Abrechnung</Link><Link href="/merchant/staff">Team</Link></>}<Link href="/cashier">Kasse</Link></nav><span className="app-header-location">{location}</span></div></header>;
}

function readableTextColor(hex: string) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map(index => {
    const channel = parseInt(normalized.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (luminance + 0.05)) >= 4.5 ? "#ffffff" : "#000000";
}
