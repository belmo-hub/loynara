"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { apiJson, ClientApiError, postJson, type MeResponse } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";
import styles from "./automations.module.css";

type Kind = "first_checkout" | "inactive";
type Editor = { triggerKind: Kind; enabled: boolean; subject: string; body: string; inactivityDays?: number; cooldownDays: number; dailyCap: number };
type Rule = Editor & { id: string; revision: number; nextScanAt: string | null };
type Run = { id: string; ruleId: string; membershipId: string; triggerKey: string; status: string; reason: string | null; attempts: number; createdAt: string; sentAt: string | null };
type Data = { localOnly: true; rules: Rule[]; runs: Run[] };

const defaults: Record<Kind, Editor> = {
  first_checkout: { triggerKind: "first_checkout", enabled: false, subject: "Willkommen", body: "Danke für deinen ersten bestätigten Einkauf.", cooldownDays: 7, dailyCap: 20 },
  inactive: { triggerKind: "inactive", enabled: false, subject: "Deine Karte wartet auf dich", body: "Deine digitale Karte ist weiterhin verfügbar.", inactivityDays: 30, cooldownDays: 7, dailyCap: 20 },
};
function message(cause: unknown) { return cause instanceof Error ? cause.message : "Die Anfrage konnte nicht abgeschlossen werden."; }

export default function AutomationsPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiJson<MeResponse>("/api/me").then(async account => {
      if (!active) return;
      if (account.role !== "owner") { setForbidden(true); setLoading(false); return; }
      if (!account.programSlug) { router.replace("/merchant/program"); return; }
      const result = await apiJson<Data>(`/api/merchant/automations?programSlug=${encodeURIComponent(account.programSlug)}`);
      if (active) { setSlug(account.programSlug); setData(result); setLoading(false); }
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 403) { setForbidden(true); setLoading(false); return; }
      setError(message(cause)); setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  async function save(editor: Editor) {
    setError("");
    await postJson("/api/merchant/automations", { programSlug: slug, ...editor });
    setData(await apiJson<Data>(`/api/merchant/automations?programSlug=${encodeURIComponent(slug)}`));
  }

  return <div className="app-page"><header className="app-header"><div className="app-header-inner"><Link href="/merchant"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link><Link href="/merchant/customers">Kundenkarten</Link><Link href="/merchant/campaigns">Kampagnen</Link><Link href="/merchant/automations" aria-current="page">Automationen</Link><Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Automationen</span></div></header>
    <main className="app-container"><div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> LOKALER SYNTHETISCHER TEST</span><h1>Automationen</h1><p>Nach dem ersten bestätigten Kassenvorgang oder nach einer einstellbaren Inaktivität. Nur verifizierte .test-Adressen mit aktueller Marketing-Einwilligung; Zustellung ausschließlich an lokales Mailpit.</p></div>
      {loading ? <section className="app-panel"><p role="status">Regeln werden geladen …</p></section> : forbidden ? <section className="app-panel"><p role="alert">Nur Inhaberinnen und Inhaber können Automationen verwalten.</p></section> : error && !data ? <section className="app-panel"><p role="alert">{error}</p></section> : data && <>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="program-view-grid"><div className="program-view-main"><RuleEditor title="Erster Kassenvorgang" description="Einmal nach dem ersten nicht korrigierten Stempel- oder Punktevorgang an der Kasse. Ein späteres Einrichten löst keine rückwirkende Nachricht aus." initial={data.rules.find(row => row.triggerKind === "first_checkout") ?? defaults.first_checkout} onSave={save} onError={setError} />
          <RuleEditor title="Inaktive Karte" description="Tägliche Prüfung von Karten mit mindestens einem früheren bestätigten Kassenvorgang. Ohne neue Aktivität nach der gewählten Frist." initial={data.rules.find(row => row.triggerKind === "inactive") ?? defaults.inactive} onSave={save} onError={setError} /></div>
          <aside className="program-view-side"><section className={`app-panel ${styles.limits}`}><h2>Versandgrenzen</h2><p>Höchstens 20 Nachrichten pro Regel und UTC-Tag. Mindestens sieben Tage Abstand zwischen Automationsnachrichten je Karte. Größere inaktive Zielgruppen als 500 Karten werden lokal blockiert und müssen gesondert geprüft werden.</p><p>Der Kassenabschluss verschickt nie selbst eine Nachricht. Die Hintergrundverarbeitung prüft Einwilligung, Kontakt und Regel vor dem lokalen Testversand erneut.</p></section></aside></div>
        <section className="app-panel"><h2>Letzte Ausführungen</h2>{data.runs.length ? <div style={{ overflowX: "auto" }}><table><thead><tr><th>Regel</th><th>Karte</th><th>Zeit (UTC)</th><th>Status</th><th>Grund</th></tr></thead><tbody>{data.runs.map(run => <tr key={run.id}><td>{data.rules.find(rule => rule.id === run.ruleId)?.triggerKind === "inactive" ? "Inaktiv" : "Erster Vorgang"}</td><td>…{run.membershipId.slice(-8)}</td><td>{new Date(run.createdAt).toLocaleString("de-DE", { timeZone: "UTC" })}</td><td>{run.status === "complete" ? "Lokal angenommen" : run.status === "suppressed" ? "Unterdrückt" : run.status === "queued" ? "Wartet" : "Fehlgeschlagen"}</td><td>{run.reason ?? "–"}</td></tr>)}</tbody></table></div> : <p>Noch keine Ausführungen. Neue Regeln sind zunächst deaktiviert.</p>}</section>
      </>}
    </main></div>;
}

function RuleEditor({ title, description, initial, onSave, onError }: { title: string; description: string; initial: Editor; onSave: (editor: Editor) => Promise<void>; onError: (value: string) => void }) {
  const [editor, setEditor] = useState<Editor>({ triggerKind: initial.triggerKind, enabled: initial.enabled, subject: initial.subject, body: initial.body, inactivityDays: initial.inactivityDays, cooldownDays: initial.cooldownDays, dailyCap: initial.dailyCap });
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setSuccess(""); onError("");
    try { await onSave(editor); setSuccess("Regel gespeichert. Änderungen gelten nur für neue Ausführungen."); }
    catch (cause) { onError(message(cause)); }
    finally { setBusy(false); }
  }
  return <section className="app-panel"><h2>{title}</h2><p>{description}</p><form onSubmit={submit} className={`program-edit-form ${styles.ruleForm}`}><div className="field-grid"><label className="field-wide">Betreff<input value={editor.subject} minLength={2} maxLength={120} required onChange={event => setEditor(current => ({ ...current, subject: event.target.value }))} /></label><label className="field-wide">Nachricht<textarea value={editor.body} minLength={5} maxLength={3000} rows={4} required onChange={event => setEditor(current => ({ ...current, body: event.target.value }))} /></label>{editor.triggerKind === "inactive" && <label>Inaktiv nach Tagen<input type="number" value={editor.inactivityDays} min={7} max={365} required onChange={event => setEditor(current => ({ ...current, inactivityDays: Number(event.target.value) }))} /></label>}<label>Mindestabstand in Tagen<input type="number" value={editor.cooldownDays} min={7} max={365} required onChange={event => setEditor(current => ({ ...current, cooldownDays: Number(event.target.value) }))} /></label><label>Tageslimit je Regel<input type="number" value={editor.dailyCap} min={1} max={20} required onChange={event => setEditor(current => ({ ...current, dailyCap: Number(event.target.value) }))} /></label><label className={styles.toggle}><input type="checkbox" checked={editor.enabled} onChange={event => setEditor(current => ({ ...current, enabled: event.target.checked }))} /> Regel aktivieren</label></div>{success && <p className="inline-message inline-message--success" role="status">{success}</p>}<button className="button button--ink" disabled={busy}>{busy ? "Wird gespeichert …" : "Regel speichern"}</button></form></section>;
}
