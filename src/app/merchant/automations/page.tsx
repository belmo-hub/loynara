"use client";

import { useState, type FormEvent } from "react";
import { apiJson, postJson } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, Notice, PageHead, SaveBar, type SaveState } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";
import { EmptyState } from "@/components/ui/empty-state";

type Kind = "first_checkout" | "inactive" | "reward_ready";
type Editor = { triggerKind: Kind; enabled: boolean; subject: string; body: string; inactivityDays?: number; cooldownDays: number; dailyCap: number };
type Rule = Editor & { id: string; revision: number; nextScanAt: string | null };
type Run = { id: string; ruleId: string; membershipId: string; cardLocator: string | null; triggerKey: string; status: string; reason: string | null; attempts: number; createdAt: string; sentAt: string | null };
type Data = { localOnly: boolean; deliveryMode: "disabled" | "mailpit" | "mailgun_eu"; rules: Rule[]; runs: Run[] };

const defaults: Record<Kind, Editor> = {
  reward_ready: { triggerKind: "reward_ready", enabled: false, subject: "Deine Belohnung wartet", body: "Auf deiner Karte ist eine Belohnung einlösbar. Schau dir deine Karte an.", cooldownDays: 7, dailyCap: 20 },
  first_checkout: { triggerKind: "first_checkout", enabled: false, subject: "Willkommen", body: "Danke für deinen ersten bestätigten Einkauf.", cooldownDays: 7, dailyCap: 20 },
  inactive: { triggerKind: "inactive", enabled: false, subject: "Deine Karte wartet auf dich", body: "Deine digitale Karte ist weiterhin verfügbar.", inactivityDays: 30, cooldownDays: 7, dailyCap: 20 },
};
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Die Anfrage konnte nicht abgeschlossen werden.";
const runStatus = (value: string) => value === "complete" ? "Vom Versand angenommen" : value === "suppressed" ? "Unterdrückt" : value === "queued" ? "Wartet" : "Fehlgeschlagen";

export default function AutomationsPage() {
  const { me } = useOwner();
  const slug = me?.programSlug ?? "";
  const [data, reload] = useLoad<Data>(me?.role === "owner" && slug ? `/api/merchant/automations?programSlug=${encodeURIComponent(slug)}` : null);
  if (!me) return null;
  const head = <PageHead eyebrow={`Aktionen · ${me.locationName}`} title="Automationen" lead="Nach dem ersten bestätigten Kassenvorgang, nach einer einstellbaren Inaktivität oder wenn eine Belohnung einlösbar ist. Vor dem Versand werden Kontakt, Einwilligung und Versandgrenzen erneut geprüft." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur Inhaber:innen können Automationen verwalten.</Notice></div>;
  if (data.state === "error") return <div className="ow-page">{head}<ErrorNotice message={data.message} onRetry={reload} /></div>;
  if (data.state !== "ok") return <div className="ow-page">{head}<LoadingBlock /></div>;
  const d = data.data;
  return (
    <div className="ow-page">
      {head}
      {d.deliveryMode === "disabled"
        ? <Notice tone="warn"><strong>E-Mail-Versand ist noch nicht freigeschaltet.</strong> Du kannst Regeln vorbereiten und speichern. Solange der Versand nicht freigegeben ist, wird keine Nachricht verschickt, auch nicht bei aktiver Regel.</Notice>
        : d.deliveryMode === "mailpit" ? <Notice>Lokaler Testkanal: Nachrichten gehen nur an synthetische .test-Adressen in Mailpit.</Notice> : null}
      <div className="ow-two">
        <div className="ow-stack">
          <RuleEditor title="Willkommen nach dem ersten Einkauf" description="Einmal nach dem ersten nicht korrigierten Stempel- oder Punktevorgang an der Kasse. Ein späteres Einrichten löst keine rückwirkende Nachricht aus." initial={d.rules.find(row => row.triggerKind === "first_checkout") ?? defaults.first_checkout} slug={slug} onSaved={reload} />
          <RuleEditor title="Erinnern, wenn jemand wegbleibt" description="Tägliche Prüfung von Karten mit mindestens einem früheren bestätigten Kassenvorgang. Ohne neue Aktivität nach der gewählten Frist." initial={d.rules.find(row => row.triggerKind === "inactive") ?? defaults.inactive} slug={slug} onSaved={reload} />
          <RuleEditor title="An eine einlösbare Belohnung erinnern" description="Tägliche Prüfung des aktuellen Kartenstands und der verfügbaren Belohnungen. Vor dem Versand wird erneut geprüft, ob eine Belohnung einlösbar ist. Der Mindestabstand gilt auch bei weiterhin einlösbarer Belohnung." initial={d.rules.find(row => row.triggerKind === "reward_ready") ?? defaults.reward_ready} slug={slug} onSaved={reload} />
        </div>
        <aside className="ow-card ow-stack" aria-labelledby="au-limits">
          <h2 id="au-limits">Versandgrenzen</h2>
          <p>Höchstens 20 Nachrichten pro Regel und UTC-Tag. Mindestens sieben Tage Abstand zwischen Automationsnachrichten je Karte. Zusätzlich gelten das konfigurierte Standortlimit und ein Kontaktabstand für alle Angebote. Ruhezeit: zwischen 21 und 9 Uhr Ortszeit des Standorts wird nichts versendet; fällige Nachrichten warten bis 9 Uhr und werden dann erneut geprüft.</p>
          <p className="ow-muted">Der Kassenabschluss verschickt nie selbst eine Nachricht. Kanal: {d.deliveryMode === "mailgun_eu" ? "Mailgun EU freigeschaltet" : d.deliveryMode === "mailpit" ? "nur lokaler Mailpit-Test" : "promotionaler Versand deaktiviert"}.</p>
        </aside>
      </div>
      <section className="ow-card ow-stack" aria-labelledby="au-runs">
        <h2 id="au-runs">Letzte Ausführungen</h2>
        {d.runs.length === 0 ? <EmptyState level={3} size="compact" title="Noch keine Ausführungen.">Neue Regeln sind zunächst deaktiviert. Schalte eine Regel ein, damit sie läuft.</EmptyState> : (
          <table className="ow-table"><thead><tr><th>Regel</th><th>Karte</th><th>Zeit (UTC)</th><th>Status</th><th>Grund</th></tr></thead>
            <tbody>{d.runs.map(run => <tr key={run.id}><td data-label="Regel">{d.rules.find(rule => rule.id === run.ruleId)?.triggerKind === "inactive" ? "Inaktiv" : d.rules.find(rule => rule.id === run.ruleId)?.triggerKind === "reward_ready" ? "Belohnung einlösbar" : "Erster Vorgang"}</td><td data-label="Karte">{run.cardLocator ?? "Karte entfernt"}</td><td data-label="Zeit (UTC)">{new Date(run.createdAt).toLocaleString("de-DE", { timeZone: "UTC" })}</td><td data-label="Status">{runStatus(run.status)}</td><td data-label="Grund">{run.reason ?? "–"}</td></tr>)}</tbody></table>
        )}
      </section>
    </div>
  );
}

function RuleEditor({ title, description, initial, slug, onSaved }: { title: string; description: string; initial: Editor; slug: string; onSaved: () => void }) {
  const pick = (e: Editor): Editor => ({ triggerKind: e.triggerKind, enabled: e.enabled, subject: e.subject, body: e.body, inactivityDays: e.inactivityDays, cooldownDays: e.cooldownDays, dailyCap: e.dailyCap });
  const [saved, setSaved] = useState<Editor>(pick(initial));
  const [editor, setEditor] = useState<Editor>(pick(initial));
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const changed = JSON.stringify(editor) !== JSON.stringify(saved);
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard(`automation-${editor.triggerKind}`, changed);
  const edit = (patch: Partial<Editor>) => { setEditor(current => ({ ...current, ...patch })); if (state === "saved" || state === "error") { setState("clean"); setError(""); } };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "saving") return;
    setState("saving"); setError("");
    try {
      await postJson("/api/merchant/automations", { programSlug: slug, ...editor });
      await apiJson<Data>(`/api/merchant/automations?programSlug=${encodeURIComponent(slug)}`);
      setSaved(editor); setState("saved"); onSaved();
    } catch (cause) { setState("error"); setError(message(cause)); }
  }
  return (
    <section className="ow-card ow-stack">
      <h2>{title}</h2>
      <p className="ow-muted" style={{ fontSize: 14 }}>{description}</p>
      <form onSubmit={submit} className="ow-stack">
        <div className="ow-field"><label htmlFor={`${editor.triggerKind}-subject`}>Betreff</label><input id={`${editor.triggerKind}-subject`} className="ow-input" value={editor.subject} minLength={2} maxLength={120} required onChange={event => edit({ subject: event.target.value })} /></div>
        <div className="ow-field"><label htmlFor={`${editor.triggerKind}-body`}>Nachricht</label><textarea id={`${editor.triggerKind}-body`} className="ow-textarea" value={editor.body} minLength={5} maxLength={3000} rows={4} required onChange={event => edit({ body: event.target.value })} /></div>
        <div className="ow-grid-2">
          {editor.triggerKind === "inactive" && <div className="ow-field"><label htmlFor="au-days">Inaktiv nach Tagen</label><input id="au-days" className="ow-input" type="number" value={editor.inactivityDays} min={7} max={365} required onChange={event => edit({ inactivityDays: Number(event.target.value) })} /></div>}
          <div className="ow-field"><label htmlFor={`${editor.triggerKind}-cool`}>Mindestabstand in Tagen</label><input id={`${editor.triggerKind}-cool`} className="ow-input" type="number" value={editor.cooldownDays} min={7} max={365} required onChange={event => edit({ cooldownDays: Number(event.target.value) })} /></div>
          <div className="ow-field"><label htmlFor={`${editor.triggerKind}-cap`}>Tageslimit je Regel</label><input id={`${editor.triggerKind}-cap`} className="ow-input" type="number" value={editor.dailyCap} min={1} max={20} required onChange={event => edit({ dailyCap: Number(event.target.value) })} /></div>
        </div>
        <label className="ow-check"><input type="checkbox" checked={editor.enabled} onChange={event => edit({ enabled: event.target.checked })} /> Regel aktivieren</label>
        <SaveBar asSubmit state={shown} onDiscard={() => { setEditor(saved); setState("clean"); setError(""); }} canSave={changed} saveLabel="Regel speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : shown === "saved" ? "Regel gespeichert. Änderungen gelten nur für neue Ausführungen." : undefined} />
      </form>
    </section>
  );
}
