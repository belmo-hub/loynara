"use client";

import Link from "next/link";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { postJson } from "@/components/client-api";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, MoreInfo, Notice, PageHead } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";
import type { ImportMapping, ImportPreview } from "@/lib/customer-import-preview";

const sample = "id,email,balance,marketing_consent,consent_source,consent_date\nSYN-001,guest@example.test,3,no,,\n";
const initialMapping: ImportMapping = { externalId: "id", email: "email", balance: "balance", marketingConsent: "marketing_consent", consentSource: "consent_source", consentDate: "consent_date" };
const fields: Array<{ key: keyof ImportMapping; label: string; required?: boolean }> = [
  { key: "externalId", label: "Kunden-ID", required: true },
  { key: "email", label: "E-Mail" },
  { key: "balance", label: "Alter Saldo" },
  { key: "marketingConsent", label: "Marketing-Angabe (yes/no)" },
  { key: "consentSource", label: "Angegebene Quelle" },
  { key: "consentDate", label: "Angegebenes Datum (YYYY-MM-DD)" },
];
const consentText = (value: ImportPreview["rows"][number]["consentClaim"]) => value === "not_granted" ? "Nein" : value === "claimed_with_provenance" ? "Ja, Quelle und Datum angegeben" : value === "missing_provenance" ? "Ja, Nachweisangaben fehlen" : "Unbekannt";

export default function ImportPreviewPage() {
  const { me } = useOwner();
  const [access, reload] = useLoad<{ available: boolean }>(me?.role === "owner" ? "/api/merchant/customers/import-preview" : null);
  const [csv, setCsv] = useState(sample);
  const [mapping, setMapping] = useState<ImportMapping>(initialMapping);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const head = <PageHead eyebrow="Kunden · Vorschau" title="CSV-Vorschau" lead="Prüfe eine kleine Datei, bevor du Kunden übernimmst." />;
  const back = <Link href="/merchant/customers" className="ow-btn ow-btn--secondary">Zurück zu Kundenkarten</Link>;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Für diese Vorschau ist ein aktiver Inhaberzugang erforderlich.</Notice><div>{back}</div></div>;

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreview(null);
    if (file.size > 64_000) { setError("Die CSV-Datei darf höchstens 64 KB groß sein."); return; }
    try { setCsv(await file.text()); setError(""); } catch { setError("Die Datei konnte nicht gelesen werden."); }
  }
  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setPreview(null);
    try { setPreview(await postJson<ImportPreview>("/api/merchant/customers/import-preview", { csv, mapping })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Die Vorschau konnte nicht geprüft werden."); }
    finally { setBusy(false); }
  }

  return (
    <div className="ow-page">
      {head}
      <Notice><div><strong>Vorschau ohne Import.</strong> Es werden keine Karten, Kontakte, Einwilligungen oder Einladungen angelegt. Nur IDs mit <code>SYN-</code> und Testadressen auf <code>example.test</code> sind zulässig. Duplikate werden nur innerhalb dieser Datei erkannt; bestehende Karten werden nicht abgeglichen.</div></Notice>
      {access.state === "loading" && <LoadingBlock rows={1} />}
      {access.state === "error" && <div className="ow-stack"><ErrorNotice message={access.status === 404 ? "Diese Vorschau ist noch nicht verfügbar." : access.status === 401 || access.status === 403 ? "Für diese Vorschau ist ein aktiver Inhaberzugang erforderlich." : access.message} onRetry={access.status === 404 || access.status === 403 ? undefined : reload} /><div>{back}</div></div>}
      {access.state === "ok" && !access.data.available && <div className="ow-stack"><Notice tone="warn" role="alert">Diese Vorschau ist auf dieser Instanz nicht verfügbar.</Notice><div>{back}</div></div>}
      {access.state === "ok" && access.data.available && <>
        <form className="ow-card ow-stack" onSubmit={inspect}>
          <div><h2>Datei und Spalten</h2><MoreInfo><p>Trage für jedes Feld genau den Spaltennamen aus der ersten CSV-Zeile ein. Nur die Kunden-ID ist Pflicht. Nicht zugeordnete Spalten müssen leer sein. Zulässige Quellbezeichnungen: paper_form, legacy_platform, customer_form.</p></MoreInfo></div>
          <div className="ow-field"><label htmlFor="im-file">CSV-Datei auswählen</label><input id="im-file" className="ow-input" style={{ paddingBlock: 8 }} type="file" accept=".csv,text/csv" onChange={event => void chooseFile(event)} /></div>
          <div className="ow-field"><label htmlFor="im-csv">CSV-Inhalt</label><textarea id="im-csv" className="ow-textarea" value={csv} onChange={event => { setCsv(event.target.value); setPreview(null); }} rows={7} spellCheck={false} required style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-16)" }} /></div>
          <div className="ow-grid-2">{fields.map(field => <div className="ow-field" key={field.key}><label htmlFor={`im-${field.key}`}>{field.label}</label><input id={`im-${field.key}`} className="ow-input" value={mapping[field.key] ?? ""} onChange={event => setMapping(current => ({ ...current, [field.key]: event.target.value }))} placeholder={field.required ? "Pflichtfeld" : "Leer lassen, falls nicht vorhanden"} required={field.required} /></div>)}</div>
          <div><button type="submit" className="ow-btn ow-btn--primary" disabled={busy} aria-busy={busy}>{busy ? "Wird geprüft …" : "Vorschau prüfen"}</button></div>
          {error && <ErrorNotice message={error} />}
        </form>
        {preview && (
          <section className="ow-card ow-stack" aria-labelledby="preview-results-heading">
            <h2 id="preview-results-heading">Prüfergebnis</h2>
            <p><strong>{preview.total} Zeilen · {preview.ready} formal gültig · {preview.duplicates} Duplikate · {preview.invalid} ungültig</strong></p>
            <p className="ow-muted">Auch formal gültige Zeilen wurden nicht importiert. Eine angegebene Marketing-Einwilligung wird hier nur als unbestätigte Behauptung mit Quelle und Datum angezeigt.</p>
            <table className="ow-table"><thead><tr><th>Zeile</th><th>Kunden-ID</th><th>Saldo</th><th>E-Mail</th><th>Einwilligungsangabe</th><th>Prüfung</th></tr></thead>
              <tbody>{preview.rows.map(row => <tr key={row.line}><td data-label="Zeile">{row.line}</td><td data-label="Kunden-ID">{row.externalId ?? "Ungültige ID"}</td><td data-label="Saldo">{row.balance ?? "Nicht erfasst"}</td><td data-label="E-Mail">{row.emailPresent ? "Adresse vorhanden" : "Keine"}</td><td data-label="Einwilligungsangabe"><span>{consentText(row.consentClaim)}{row.consentSource && row.consentDate ? <><br /><small className="ow-muted">Quelle: {row.consentSource} · {row.consentDate}</small></> : null}</span></td><td data-label="Prüfung"><span><strong>{row.status === "ready" ? "Formal gültig" : row.status === "duplicate" ? "Duplikat" : "Ungültig"}</strong>{row.errors.map(message => <span key={message}><br /><small className="ow-muted">{message}</small></span>)}</span></td></tr>)}</tbody></table>
          </section>
        )}
      </>}
    </div>
  );
}
