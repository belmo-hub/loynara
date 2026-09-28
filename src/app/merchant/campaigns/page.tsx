"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiJson, ClientApiError, postJson, type MeResponse, type PublicProgram } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";
import type { AudienceDefinition } from "@/lib/segments";
import styles from "./campaigns.module.css";

type AudienceKind = AudienceDefinition["kind"];
type Editor = {
  title: string; subject: string; body: string; kind: AudienceKind;
  withinDays: number; daysSinceLast: number; minCheckouts: number; maxRemaining: number; rewardId: string;
};
const emptyEditor: Editor = { title: "", subject: "", body: "", kind: "new", withinDays: 30, daysSinceLast: 30, minCheckouts: 2, maxRemaining: 2, rewardId: "" };
type CampaignStatus = "draft" | "scheduled" | "paused" | "dispatching" | "complete" | "blocked" | "cancelled";
type Campaign = {
  id: string; title: string; subject: string; status: CampaignStatus; scheduledAt: string | null;
  audienceCount: number; queuedCount: number; createdAt: string; body?: string; audienceDefinition?: AudienceDefinition;
};
type CampaignList = { campaigns: Campaign[]; deliveryMode: "disabled" | "mailpit" | "mailgun_eu" };
type CampaignDetail = {
  campaign: Campaign & { body: string; audienceDefinition: AudienceDefinition };
  summary: { queued: number; sent: number; delivered: number; providerFailed: number; suppressed: number; failed: number };
  attempts: Array<{ recipientId: string; status: string; reason: string | null; createdAt: string; providerStatus: string | null }>;
};
type CampaignPreview = {
  total: number; eligibleCount: number; excludedCountsByReason: { unverified: number; noConsent: number; unsubscribed: number; suppressed: number; frequency: number; closed: number; nonSynthetic: number; quota: number };
  asOf: string; countingRule: string; deliveryMode: "disabled" | "mailpit" | "mailgun_eu"; dailyQuota: number; monthlyLocationQuota: number; quotaRemaining: number;
};

function definitionOf(editor: Editor): AudienceDefinition {
  switch (editor.kind) {
    case "new": return { kind: "new", withinDays: editor.withinDays };
    case "recently_active": return { kind: "recently_active", withinDays: editor.withinDays };
    case "inactive": return { kind: "inactive", daysSinceLast: editor.daysSinceLast };
    case "frequent_visitors": return { kind: "frequent_visitors", withinDays: editor.withinDays, minCheckouts: editor.minCheckouts };
    case "close_to_reward": return { kind: "close_to_reward", maxRemaining: editor.maxRemaining, ...(editor.rewardId ? { rewardId: editor.rewardId } : {}) };
  }
}

function editorFrom(campaign: CampaignDetail["campaign"]): Editor {
  const audience = campaign.audienceDefinition;
  return {
    ...emptyEditor,
    title: campaign.title, subject: campaign.subject, body: campaign.body,
    kind: audience.kind,
    withinDays: "withinDays" in audience ? audience.withinDays : emptyEditor.withinDays,
    daysSinceLast: "daysSinceLast" in audience ? audience.daysSinceLast : emptyEditor.daysSinceLast,
    minCheckouts: "minCheckouts" in audience ? audience.minCheckouts : emptyEditor.minCheckouts,
    maxRemaining: "maxRemaining" in audience ? audience.maxRemaining : emptyEditor.maxRemaining,
    rewardId: "rewardId" in audience ? audience.rewardId ?? "" : "",
  };
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "Nicht geplant";
}

function statusLabel(value: CampaignStatus) {
  switch (value) {
    case "draft": return "Entwurf";
    case "scheduled": return "Geplant";
    case "paused": return "Pausiert";
    case "dispatching": return "In Bearbeitung";
    case "complete": return "Abgeschlossen";
    case "blocked": return "Blockiert";
    case "cancelled": return "Abgebrochen";
  }
}

function reason(cause: unknown) { return cause instanceof Error ? cause.message : "Die Anfrage konnte nicht abgeschlossen werden."; }

export default function MerchantCampaignsPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [program, setProgram] = useState<PublicProgram | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [deliveryMode, setDeliveryMode] = useState<CampaignList["deliveryMode"]>("disabled");
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [scheduleValues, setScheduleValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void apiJson<MeResponse>("/api/me").then(async account => {
      if (!active) return;
      if (account.role !== "owner") { setForbidden(true); setLoading(false); return; }
      if (!account.programSlug) { router.replace("/merchant/program"); return; }
      const [list, publicProgram] = await Promise.all([
        apiJson<CampaignList>(`/api/merchant/campaigns?programSlug=${encodeURIComponent(account.programSlug)}`),
        apiJson<PublicProgram>(`/api/program/${encodeURIComponent(account.programSlug)}`),
      ]);
      if (!active) return;
      setMe(account); setCampaigns(list.campaigns); setDeliveryMode(list.deliveryMode); setProgram(publicProgram); setLoading(false);
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 403) { setForbidden(true); setLoading(false); return; }
      setError(reason(cause)); setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  async function reloadList() {
    if (!me?.programSlug) return;
    const result = await apiJson<CampaignList>(`/api/merchant/campaigns?programSlug=${encodeURIComponent(me.programSlug)}`);
    setCampaigns(result.campaigns);
    setDeliveryMode(result.deliveryMode);
  }

  function changeEditor<K extends keyof Editor>(key: K, value: Editor[K]) {
    setEditor(current => ({ ...current, [key]: value }));
    setPreview(null);
  }

  async function inspectAudience() {
    if (!me?.programSlug) return;
    setBusy(true); setError(""); setMessage(""); setPreview(null);
    try { setPreview(await postJson<CampaignPreview>("/api/merchant/campaigns/preview", { programSlug: me.programSlug, audienceDefinition: definitionOf(editor) })); }
    catch (cause) { setError(reason(cause)); }
    finally { setBusy(false); }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me?.programSlug) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const common = { title: editor.title.trim(), subject: editor.subject.trim(), body: editor.body.trim(), audienceDefinition: definitionOf(editor) };
      if (editingId) await postJson("/api/merchant/campaigns", { action: "edit", campaignId: editingId, ...common });
      else await postJson("/api/merchant/campaigns", { action: "create", programSlug: me.programSlug, ...common });
      await reloadList();
      setEditingId(null); setEditor(emptyEditor); setPreview(null); setDetail(null);
      setMessage("Entwurf gespeichert. Es wurde keine Nachricht versendet.");
    } catch (cause) { setError(reason(cause)); }
    finally { setBusy(false); }
  }

  async function openDetail(id: string, edit = false) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiJson<CampaignDetail>(`/api/merchant/campaigns/${encodeURIComponent(id)}`);
      setDetail(result);
      if (edit) {
        if (result.campaign.status !== "draft") throw new Error("Nur Entwürfe können geändert werden.");
        setEditingId(id); setEditor(editorFrom(result.campaign)); setPreview(null);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (cause) { setError(reason(cause)); }
    finally { setBusy(false); }
  }

  async function act(id: string, action: "schedule" | "pause" | "cancel") {
    setBusy(true); setError(""); setMessage("");
    try {
      let payload: Record<string, unknown> = { action, campaignId: id };
      if (action === "schedule") {
        const local = scheduleValues[id];
        if (!local || Number.isNaN(new Date(local).getTime())) throw new Error("Wähle zuerst einen gültigen Termin.");
        payload = { ...payload, scheduledAt: new Date(local).toISOString() };
      }
      await postJson("/api/merchant/campaigns", payload);
      await reloadList();
      if (detail?.campaign.id === id) setDetail(await apiJson<CampaignDetail>(`/api/merchant/campaigns/${encodeURIComponent(id)}`));
      setMessage(action === "schedule" ? "Termin gespeichert. Der aktuelle Status steht in der Liste." : action === "pause" ? "Kampagne pausiert." : "Kampagne abgebrochen.");
    } catch (cause) { setError(reason(cause)); }
    finally { setBusy(false); }
  }

  return <div className="app-page">
    <header className={`app-header ${styles.header}`}><div className="app-header-inner"><Link href="/merchant"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link><Link href="/merchant/customers">Kundenkarten</Link><Link href="/merchant/campaigns" aria-current="page">Kampagnen</Link><Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Kampagnen</span></div></header>
    <main className={`app-container ${styles.main}`}>
      <div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> E-MAIL-KAMPAGNEN</span><h1>Kampagnen</h1><p>Entwürfe erstellen, Zielgruppen prüfen und Zustellversuche nachvollziehen.</p></div>
      <p className={styles.notice}>{deliveryMode === "mailpit" ? "Lokaler Mailpit-Testkanal: nur synthetische .test-Adressen." : deliveryMode === "mailgun_eu" ? "Freigeschalteter Mailgun-EU-Kanal. Vor jeder Zustellung werden Einwilligung, Adresse, Zielgruppe und Versandgrenzen erneut geprüft." : "Promotionaler Versand ist deaktiviert. Entwürfe und Zielgruppenvorschauen sind möglich; Planung benötigt eine gesonderte Freigabe."} Die Zielgruppenvorschau versendet keine Nachricht.</p>
      {loading ? <section className="app-panel"><p>Kampagnen werden geladen …</p></section> : forbidden ? <section className="app-panel"><p role="alert">Nur Inhaberinnen und Inhaber können Kampagnen verwalten.</p></section> : !me ? <section className="app-panel"><p role="alert">{error || "Kampagnen konnten nicht geladen werden."}</p></section> : <>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {message && <p role="status" className={styles.success}>{message}</p>}
        <div className={styles.grid}>
          <div className={styles.column}>
            <form className={`app-panel ${styles.editor}`} onSubmit={saveDraft}><fieldset className={styles.fieldset} disabled={busy}>
              <div className={styles.sectionHead}><div><span className="tiny-label">ENTWURF</span><h2>{editingId ? "Entwurf bearbeiten" : "Neue Kampagne"}</h2></div>{editingId && <button type="button" className={styles.textButton} onClick={() => { setEditingId(null); setEditor(emptyEditor); setPreview(null); }}>Neuen Entwurf beginnen</button>}</div>
              <div className={styles.fields}>
                <label>Titel<input value={editor.title} onChange={event => changeEditor("title", event.target.value)} maxLength={180} minLength={2} required /></label>
                <label>Betreff<input value={editor.subject} onChange={event => changeEditor("subject", event.target.value)} maxLength={120} minLength={2} required /></label>
                <label>Nachricht<textarea value={editor.body} onChange={event => changeEditor("body", event.target.value)} maxLength={3000} minLength={5} rows={5} required /></label>
              </div>
              <section className={styles.messagePreview} aria-label="Vorschau der Testnachricht">
                <span className="tiny-label">NACHRICHTENVORSCHAU</span>
                <h3>{editor.subject.trim() ? `${deliveryMode === "mailpit" ? "[LOCAL TEST] " : ""}${editor.subject.trim()}` : "Betreff eingeben"}</h3>
                <p>{editor.body.trim() || "Nachricht eingeben"}</p>
                <small>{deliveryMode === "mailgun_eu" ? "Bei Zustellung ergänzt Loynara Geschäftsname und Abmeldelink." : deliveryMode === "mailpit" ? "Lokale Testnachricht. Keine externe Zustellung." : "Versand derzeit deaktiviert."}</small>
              </section>
              <div className={styles.audience}><h3>Zielgruppe</h3><label>Zielgruppe auswählen<select value={editor.kind} onChange={event => changeEditor("kind", event.target.value as AudienceKind)}><option value="new">Neu angemeldet</option><option value="recently_active">Kürzlich aktiv</option><option value="inactive">Länger inaktiv</option><option value="frequent_visitors">Häufige Kassenvorgänge</option><option value="close_to_reward">Kurz vor Prämie</option></select></label>
                {(editor.kind === "new" || editor.kind === "recently_active" || editor.kind === "frequent_visitors") && <label>Zeitraum in Tagen<input type="number" min={1} max={3650} step={1} value={editor.withinDays} onChange={event => changeEditor("withinDays", Number(event.target.value))} required /></label>}
                {editor.kind === "inactive" && <label>Inaktiv seit mindestens Tagen<input type="number" min={1} max={3650} step={1} value={editor.daysSinceLast} onChange={event => changeEditor("daysSinceLast", Number(event.target.value))} required /><small>Nur Karten mit einem früheren bestätigten Kassenvorgang.</small></label>}
                {editor.kind === "frequent_visitors" && <label>Mindestens bestätigte Kassenvorgänge<input type="number" min={1} max={10000} step={1} value={editor.minCheckouts} onChange={event => changeEditor("minCheckouts", Number(event.target.value))} required /></label>}
                {editor.kind === "close_to_reward" && <><label>Höchstens fehlende Stempel oder Punkte<input type="number" min={1} max={100000} step={1} value={editor.maxRemaining} onChange={event => changeEditor("maxRemaining", Number(event.target.value))} required /></label><label>Prämie<select value={editor.rewardId} onChange={event => changeEditor("rewardId", event.target.value)}><option value="">Nächste aktive Prämie</option>{program?.rewards.map(reward => <option key={reward.rewardId} value={reward.rewardId}>{reward.title} · {reward.cost}</option>)}</select></label></>}
              </div>
              <div className={styles.actions}><button type="button" className="button button--outline" disabled={busy} onClick={() => void inspectAudience()}>Zielgruppe prüfen</button><button type="submit" className="button button--ink" disabled={busy}>{editingId ? "Änderungen speichern" : "Entwurf speichern"}</button></div>
            </fieldset></form>
            {preview && <section className={`app-panel ${styles.preview}`} aria-labelledby="audience-preview-heading"><div className={styles.sectionHead}><div><span className="tiny-label">AKTUELLER STAND</span><h2 id="audience-preview-heading">Zielgruppenvorschau</h2></div></div><div className={styles.previewStats}><strong>{preview.total} {preview.total === 1 ? "Karte" : "Karten"} in der Zielgruppe</strong><strong>{preview.eligibleCount} kontaktierbar</strong></div><p>Stand: {when(preview.asOf)}. Diese Zahl ist eine Vorschau und keine Zusage für die spätere Zustellung.</p><dl className={styles.exclusions}><div><dt>Unverifizierte Adresse</dt><dd>{preview.excludedCountsByReason.unverified}</dd></div><div><dt>Keine Einwilligung</dt><dd>{preview.excludedCountsByReason.noConsent}</dd></div><div><dt>Abgemeldet</dt><dd>{preview.excludedCountsByReason.unsubscribed}</dd></div><div><dt>Provider-Sperre</dt><dd>{preview.excludedCountsByReason.suppressed}</dd></div><div><dt>Zu häufig kontaktiert</dt><dd>{preview.excludedCountsByReason.frequency}</dd></div><div><dt>Geschlossene Karte</dt><dd>{preview.excludedCountsByReason.closed}</dd></div>{preview.deliveryMode === "mailpit" && <div><dt>Nicht synthetisch</dt><dd>{preview.excludedCountsByReason.nonSynthetic}</dd></div>}<div><dt>Versandlimit</dt><dd>{preview.excludedCountsByReason.quota}</dd></div></dl><p>Tageslimit: {preview.dailyQuota}; Monatslimit je Standort: {preview.monthlyLocationQuota}; derzeit verfügbar: {preview.quotaRemaining}. Kanal: {preview.deliveryMode === "mailgun_eu" ? "Mailgun EU" : preview.deliveryMode === "mailpit" ? "lokaler Test" : "deaktiviert"}.</p><small>{preview.countingRule}</small></section>}
          </div>
          <div className={styles.column}>
            <section className={`app-panel ${styles.list}`} aria-labelledby="campaign-list-heading"><div className={styles.sectionHead}><div><span className="tiny-label">GESPEICHERT</span><h2 id="campaign-list-heading">Deine Kampagnen</h2></div></div>{campaigns.length === 0 ? <p className={styles.muted}>Noch keine Kampagnen. Speichere zuerst einen Entwurf.</p> : <ul>{campaigns.map(campaign => <li key={campaign.id} className={styles.campaign}><div className={styles.campaignHead}><strong>{campaign.title}</strong><span>{statusLabel(campaign.status)}</span></div><p>{campaign.subject}</p><dl><div><dt>Zielgruppe bei Planung</dt><dd>{campaign.audienceCount}</dd></div><div><dt>Eingereiht</dt><dd>{campaign.queuedCount}</dd></div><div><dt>Termin</dt><dd>{when(campaign.scheduledAt)}</dd></div></dl><div className={styles.campaignActions}><button type="button" className="button button--outline button--small" disabled={busy} onClick={() => void openDetail(campaign.id)}>Details</button>{campaign.status === "draft" && <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => void openDetail(campaign.id, true)}>Bearbeiten</button>}{campaign.status === "scheduled" && <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => void act(campaign.id, "pause")}>Pausieren</button>}{["draft", "scheduled", "paused"].includes(campaign.status) && <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => void act(campaign.id, "cancel")}>Abbrechen</button>}</div>{["draft", "paused"].includes(campaign.status) && <div className={styles.schedule}><label>{campaign.status === "paused" ? "Neuer Termin für Fortsetzung" : "Termin für Planung"}<input type="datetime-local" value={scheduleValues[campaign.id] ?? ""} onChange={event => setScheduleValues(current => ({ ...current, [campaign.id]: event.target.value }))} /></label><button type="button" className="button button--ink button--small" disabled={busy || !scheduleValues[campaign.id]} onClick={() => void act(campaign.id, "schedule")}>{campaign.status === "paused" ? "Erneut planen" : "Planen"}</button></div>}</li>)}</ul>}</section>
            {detail && <section className={`app-panel ${styles.details}`} aria-labelledby="campaign-details-heading"><div className={styles.sectionHead}><div><span className="tiny-label">TATSÄCHLICHE VORGÄNGE</span><h2 id="campaign-details-heading">{detail.campaign.title}</h2></div><span>{statusLabel(detail.campaign.status)}</span></div><dl className={styles.summary}><div><dt>Wartend</dt><dd>{detail.summary.queued}</dd></div><div><dt>Vom Versand angenommen</dt><dd>{detail.summary.sent}</dd></div><div><dt>Zugestellt laut Provider</dt><dd>{detail.summary.delivered}</dd></div><div><dt>Provider-Fehler</dt><dd>{detail.summary.providerFailed}</dd></div><div><dt>Unterdrückt</dt><dd>{detail.summary.suppressed}</dd></div><div><dt>Fehlgeschlagen</dt><dd>{detail.summary.failed}</dd></div></dl><h3>Letzte Zustellversuche</h3>{detail.attempts.length === 0 ? <p className={styles.muted}>Noch keine Zustellversuche.</p> : <ol>{detail.attempts.map((attempt, index) => <li key={`${attempt.recipientId}-${attempt.createdAt}-${index}`}><strong>{attemptStatus(attempt.status)}</strong><time dateTime={attempt.createdAt}>{when(attempt.createdAt)}</time>{attempt.providerStatus && <small>Provider: {providerStatusLabel(attempt.providerStatus)}</small>}{attempt.reason && <small>{attempt.reason}</small>}</li>)}</ol>}</section>}
          </div>
        </div>
      </>}
    </main>
  </div>;
}

function attemptStatus(value: string) {
  switch (value) {
    case "complete": return "Gesendet";
    case "suppressed": return "Unterdrückt";
    case "retry": return "Erneuter Versuch geplant";
    case "failed": return "Fehlgeschlagen";
    case "blocked": return "Blockiert";
    default: return value;
  }
}

function providerStatusLabel(value: string) {
  switch (value) {
    case "accepted": return "angenommen";
    case "delivered": return "zugestellt";
    case "temporary_failure": return "vorübergehendes Zustellproblem";
    case "permanent_failure": return "dauerhaft fehlgeschlagen";
    case "complained": return "Beschwerde";
    case "unsubscribed": return "abgemeldet";
    case "ambiguous": case "sending": return "unklar, manuelle Prüfung nötig";
    default: return value;
  }
}
