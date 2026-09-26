"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { apiJson, ClientApiError, postJson } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";
import type { ImportMapping, ImportPreview } from "@/lib/customer-import-preview";
import styles from "./import.module.css";

const sample = "id,email,balance,marketing_consent,consent_source,consent_date\nSYN-001,guest@example.test,3,no,,\n";
const initialMapping: ImportMapping = { externalId: "id", email: "email", balance: "balance", marketingConsent: "marketing_consent", consentSource: "consent_source", consentDate: "consent_date" };
const fields: Array<{ key: keyof ImportMapping; label: string; required?: boolean }> = [
  { key: "externalId", label: "Synthetische ID", required: true },
  { key: "email", label: "Test-E-Mail" },
  { key: "balance", label: "Alter Saldo" },
  { key: "marketingConsent", label: "Marketing-Angabe (yes/no)" },
  { key: "consentSource", label: "Angegebene Quelle" },
  { key: "consentDate", label: "Angegebenes Datum (YYYY-MM-DD)" },
];

export default function ImportPreviewPage() {
  const router = useRouter();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [csv, setCsv] = useState(sample);
  const [mapping, setMapping] = useState<ImportMapping>(initialMapping);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void apiJson<{ available: boolean }>("/api/merchant/customers/import-preview").then(result => {
      if (!active) return;
      setAvailable(result.available);
      setLoading(false);
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      setError(cause instanceof ClientApiError && cause.status === 404 ? "Diese Vorschau ist nur auf der lokalen Loynara-Instanz verfügbar." : "Für diese Vorschau ist ein aktiver Inhaberzugang erforderlich.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreview(null);
    if (file.size > 64_000) { setError("Die CSV-Datei darf höchstens 64 KB groß sein."); return; }
    try { setCsv(await file.text()); setError(""); }
    catch { setError("Die Datei konnte nicht gelesen werden."); }
  }

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setPreview(null);
    try { setPreview(await postJson<ImportPreview>("/api/merchant/customers/import-preview", { csv, mapping })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Die Vorschau konnte nicht geprüft werden."); }
    finally { setBusy(false); }
  }

  return <div className="app-page">
    <header className="app-header"><div className="app-header-inner"><Link href="/merchant"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/customers">Kundenkarten</Link><Link href="/merchant/customers/import" aria-current="page">CSV-Vorschau</Link></nav><span className="app-header-location">Lokale Vorschau</span></div></header>
    <main className={`app-container ${styles.main}`}>
      <div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> NUR LOKAL &amp; SYNTHETISCH</span><h1>Synthetische CSV-Vorschau</h1><p>Prüfe eine kleine Testdatei, bevor ein Datenübernahmeprozess geplant wird.</p></div>
      <div className={styles.notice}><strong>Vorschau ohne Import.</strong> Es werden keine Karten, Kontakte, Einwilligungen oder Einladungen angelegt. Nur IDs mit <code>SYN-</code> und Testadressen auf <code>example.test</code> sind zulässig. Duplikate werden nur innerhalb dieser Datei erkannt; bestehende Karten werden nicht abgeglichen.</div>
      {loading ? <section className="app-panel"><p>Lokale Berechtigung wird geprüft …</p></section> : !available ? <section className="app-panel"><p role="alert">{error}</p><Link href="/merchant/customers" className="button button--outline">Zurück zu Kundenkarten</Link></section> : <>
        <form className={`app-panel ${styles.form}`} onSubmit={inspect}>
          <div className={styles.formHead}><h2>Testdatei und Spalten</h2><p>Trage für jedes Feld genau den Spaltennamen aus der ersten CSV-Zeile ein. Nur die synthetische ID ist Pflicht. Nicht zugeordnete Spalten müssen leer sein. Zulässige Quellbezeichnungen: paper_form, legacy_platform, customer_form.</p></div>
          <label className={styles.file}>CSV-Datei auswählen<input type="file" accept=".csv,text/csv" onChange={event => void chooseFile(event)} /></label>
          <label className={styles.csv}>CSV-Inhalt<textarea value={csv} onChange={event => { setCsv(event.target.value); setPreview(null); }} rows={7} spellCheck={false} required /></label>
          <div className={styles.mapping}>{fields.map(field => <label key={field.key}>{field.label}<input value={mapping[field.key] ?? ""} onChange={event => setMapping(current => ({ ...current, [field.key]: event.target.value }))} placeholder={field.required ? "Pflichtfeld" : "Leer lassen, falls nicht vorhanden"} required={field.required} /></label>)}</div>
          <button type="submit" className="button button--ink" disabled={busy}>{busy ? "Wird geprüft …" : "Vorschau prüfen"}</button>
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </form>
        {preview && <section className={`app-panel ${styles.results}`} aria-labelledby="preview-results-heading">
          <h2 id="preview-results-heading">Prüfergebnis</h2>
          <p className={styles.summary}>{preview.total} Zeilen · {preview.ready} formal gültig · {preview.duplicates} Duplikate · {preview.invalid} ungültig</p>
          <p>Auch formal gültige Zeilen wurden nicht importiert. Eine angegebene Marketing-Einwilligung wird hier nur als unbestätigte Behauptung mit Quelle und Datum angezeigt.</p>
          <div className={styles.tableWrap}><table><thead><tr><th>Zeile</th><th>Synthetische ID</th><th>Saldo</th><th>E-Mail</th><th>Einwilligungsangabe</th><th>Prüfung</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.line}><td>{row.line}</td><td>{row.externalId ?? "Ungültige ID"}</td><td>{row.balance ?? "Nicht erfasst"}</td><td>{row.emailPresent ? "Testadresse vorhanden" : "Keine"}</td><td>{consentText(row.consentClaim)}{row.consentSource && row.consentDate ? <small>Quelle: {row.consentSource} · {row.consentDate}</small> : null}</td><td><strong>{row.status === "ready" ? "Formal gültig" : row.status === "duplicate" ? "Duplikat" : "Ungültig"}</strong>{row.errors.map(message => <small key={message}>{message}</small>)}</td></tr>)}</tbody></table></div>
        </section>}
      </>}
    </main>
  </div>;
}

function consentText(value: ImportPreview["rows"][number]["consentClaim"]) {
  switch (value) {
    case "not_granted": return "Nein";
    case "claimed_with_provenance": return "Ja, Quelle und Datum angegeben";
    case "missing_provenance": return "Ja, Nachweisangaben fehlen";
    default: return "Unbekannt";
  }
}
