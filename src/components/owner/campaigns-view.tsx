"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiJson, postJson, type PublicProgram } from "@/components/client-api";
import { audienceDefinitionSchema, type AudienceDefinition } from "@/lib/audience-definition";
import { useDirtyGuard, useOwner } from "./owner-context";
import { germanDate, Notice, OwnerDialog, OwnerIcon, Skeleton } from "./owner-ui";
import { useLoad } from "./use-load";

type Kind = AudienceDefinition["kind"];
type Editor = { title: string; subject: string; body: string; kind: Kind; withinDays: number; daysSinceLast: number; minCheckouts: number; maxRemaining: number; rewardId: string };
type Mode = "disabled" | "mailpit" | "mailgun_eu";
type Status = "draft" | "scheduled" | "paused" | "dispatching" | "complete" | "blocked" | "cancelled";
type Campaign = { id: string; title: string; subject: string; status: Status; scheduledAt: string | null; audienceCount: number; queuedCount: number; createdAt: string; audienceDefinition?: AudienceDefinition };
type CampaignList = { campaigns: Campaign[]; deliveryMode: Mode };
type Detail = { campaign: Campaign & { body: string; audienceDefinition: AudienceDefinition }; summary: { queued: number; sent: number; delivered: number; providerFailed: number; suppressed: number; failed: number }; attempts: Array<{ recipientId: string; status: string; reason: string | null; createdAt: string; providerStatus: string | null }>; outcome?: { sent: number; returnedAfterSend: number } };
type Preview = { total: number; eligibleCount: number; excludedCountsByReason: Record<"unverified" | "noConsent" | "unsubscribed" | "suppressed" | "frequency" | "closed" | "nonSynthetic" | "quota", number>; asOf: string; countingRule: string; deliveryMode: Mode; dailyQuota: number; monthlyLocationQuota: number; quotaRemaining: number };

const BLANK: Editor = { title: "", subject: "", body: "", kind: "inactive", withinDays: 30, daysSinceLast: 30, minCheckouts: 2, maxRemaining: 2, rewardId: "" };
// Goal shortcuts prefill the existing builder. Everything stays editable and nothing is sent or scheduled automatically.
type GoalOptions = { days?: number; withinDays?: number; maxRemaining?: number; rewardId?: string };
const GOALS: Record<string, { label: string; text: (o: GoalOptions) => string; make: (business: string, o: GoalOptions) => Editor }> = {
  winback: { label: "Kunden zurückholen", text: o => `Karten, die früher an der Kasse waren, aber seit ${o.days ?? 30} Tagen nicht mehr.`, make: (business, o) => ({ ...BLANK, kind: "inactive", daysSinceLast: o.days ?? 30, title: "Kunden zurückholen", subject: `Deine Karte bei ${business} wartet`, body: `Schön wäre es, dich bald wieder bei ${business} zu sehen. Deine Treuekarte ist weiterhin gültig. Zeig sie einfach beim nächsten Besuch an der Kasse.` }) },
  "near-reward": { label: "An die Prämie erinnern", text: o => `Karten, denen höchstens ${o.maxRemaining ?? 2} Stempel oder Punkte fehlen.`, make: (business, o) => ({ ...BLANK, kind: "close_to_reward", maxRemaining: o.maxRemaining ?? 2, rewardId: o.rewardId ?? "", title: "Kurz vor der Prämie", subject: "Dir fehlt nicht mehr viel", body: `Bei ${business} fehlt deiner Karte nicht mehr viel bis zur nächsten Prämie. Schau bald vorbei und lass sie an der Kasse bestätigen.` }) },
  quiet: { label: "Ruhige Zeit füllen", text: o => `Karten mit Kassenvorgang in den letzten ${o.withinDays ?? 30} Tagen, für ein Angebot in ruhigen Stunden.`, make: (business, o) => ({ ...BLANK, kind: "recently_active", withinDays: o.withinDays ?? 30, title: "Ruhige Zeit füllen", subject: `In ruhigen Stunden freuen wir uns auf dich`, body: `In den ruhigeren Stunden bei ${business} ist Platz für dich. Zeig einfach deine Treuekarte an der Kasse, wenn du vorbeikommst.` }) },
  announcement: { label: "Neuigkeit ankündigen", text: () => "Alle aktiven Karten, zum Beispiel für neue Öffnungszeiten oder ein neues Angebot.", make: business => ({ ...BLANK, kind: "all", title: "Neuigkeit", subject: `Neues bei ${business}`, body: `Bei ${business} gibt es etwas Neues: … Wir freuen uns auf deinen nächsten Besuch.` }) },
};
const KINDS: Array<[Kind, string]> = [["all", "Alle aktiven Karten"], ["inactive", "Länger nicht da"], ["recently_active", "Kürzlich aktiv"], ["new", "Neu angemeldet"], ["frequent_visitors", "Häufige Kassenvorgänge"], ["close_to_reward", "Kurz vor Prämie"]];
const EXCLUSION: Array<[keyof Preview["excludedCountsByReason"], string]> = [["unverified", "Keine bestätigte E-Mail-Adresse"], ["noConsent", "Keine Werbeeinwilligung"], ["unsubscribed", "Abgemeldet"], ["suppressed", "Gesperrt wegen Zustellproblemen"], ["frequency", "Zu häufig kontaktiert"], ["closed", "Karte geschlossen"], ["nonSynthetic", "Keine Testadresse (lokaler Testkanal)"], ["quota", "Versandgrenze erreicht"]];
const STATUS: Record<Status, [string, string]> = { draft: ["Entwurf", ""], scheduled: ["Geplant", "ow-chip--info"], paused: ["Pausiert", "ow-chip--warn"], dispatching: ["In Bearbeitung", "ow-chip--info"], complete: ["Abgeschlossen", "ow-chip--ok"], blocked: ["Blockiert", "ow-chip--danger"], cancelled: ["Abgebrochen", ""] };
const STEPS = ["Zielgruppe", "Nachricht", "Prüfen & speichern"];
const SUBJECT_MAX = 120;
const BODY_MAX = 3000;
/** The customer-card view that shows exactly this audience, where one exists. */
function cardViewFor(e: Editor) {
  const days = [14, 30, 60, 90];
  if (e.kind === "inactive" && days.includes(e.daysSinceLast)) return `/merchant/customers?activity=drifting&days=${e.daysSinceLast}`;
  if (e.kind === "recently_active" && days.includes(e.withinDays)) return `/merchant/customers?activity=recent&days=${e.withinDays}`;
  return null;
}
const reason = (cause: unknown) => cause instanceof Error ? cause.message : "Die Anfrage konnte nicht abgeschlossen werden.";
const channelLabel = (mode: Mode) => mode === "mailgun_eu" ? "E-Mail (freigeschalteter EU-Versand)" : mode === "mailpit" ? "Lokaler Testkanal (Mailpit), keine externe Zustellung" : "E-Mail-Versand nicht freigegeben";

function definitionOf(e: Editor): AudienceDefinition {
  switch (e.kind) {
    case "all": return { kind: "all" };
    case "new": return { kind: "new", withinDays: e.withinDays };
    case "recently_active": return { kind: "recently_active", withinDays: e.withinDays };
    case "inactive": return { kind: "inactive", daysSinceLast: e.daysSinceLast };
    case "frequent_visitors": return { kind: "frequent_visitors", withinDays: e.withinDays, minCheckouts: e.minCheckouts };
    case "close_to_reward": return { kind: "close_to_reward", maxRemaining: e.maxRemaining, ...(e.rewardId ? { rewardId: e.rewardId } : {}) };
  }
}
function editorFrom(c: Detail["campaign"]): Editor {
  const a = c.audienceDefinition;
  return { ...BLANK, title: c.title, subject: c.subject, body: c.body, kind: a.kind, withinDays: "withinDays" in a ? a.withinDays : BLANK.withinDays, daysSinceLast: "daysSinceLast" in a ? a.daysSinceLast : BLANK.daysSinceLast, minCheckouts: "minCheckouts" in a ? a.minCheckouts : BLANK.minCheckouts, maxRemaining: "maxRemaining" in a ? a.maxRemaining : BLANK.maxRemaining, rewardId: "rewardId" in a ? a.rewardId ?? "" : "" };
}
function audienceSentence(e: Editor, unit: string) {
  switch (e.kind) {
    case "all": return "Alle aktiven, nicht geschlossenen Karten";
    case "inactive": return `Karten mit früheren Kassenvorgängen, aber keinem in den letzten ${e.daysSinceLast} Tagen`;
    case "recently_active": return `Karten mit bestätigtem Vorgang in den letzten ${e.withinDays} Tagen`;
    case "new": return `Karten, die in den letzten ${e.withinDays} Tagen angelegt wurden`;
    case "frequent_visitors": return `Karten mit mindestens ${e.minCheckouts} bestätigten Vorgängen in den letzten ${e.withinDays} Tagen`;
    case "close_to_reward": return `Karten, denen höchstens ${e.maxRemaining} ${unit} bis zur Prämie fehlen`;
  }
}

export function CampaignsView() {
  const owner = useOwner();
  const me = owner.me!;
  const slug = encodeURIComponent(me.programSlug);
  const [list, reloadList] = useLoad<CampaignList>(`/api/merchant/campaigns?programSlug=${slug}`);
  const [program] = useLoad<PublicProgram>(`/api/program/${slug}`);
  // Overview and customer views link here with a goal and the threshold they showed, so the draft matches what the owner saw.
  // useSearchParams (not window.location): on a client-side navigation from the overview the browser URL is not updated yet
  // when this component first renders, which silently dropped the goal.
  const searchParams = useSearchParams();
  const [entry] = useState(() => {
    const number = (key: string, min: number, max: number) => { const value = Number(searchParams.get(key)); return Number.isInteger(value) && value >= min && value <= max ? value : undefined; };
    const rewardId = searchParams.get("rewardId") ?? "";
    return { goal: searchParams.get("goal"), options: { days: number("days", 1, 3650), withinDays: number("withinDays", 1, 3650), maxRemaining: number("maxRemaining", 1, 100000),
      rewardId: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rewardId) ? rewardId : undefined } as GoalOptions };
  });
  const [builder, setBuilder] = useState<null | { step: number; editor: Editor; editingId: string | null; savedId: string | null; goal: string | null }>(() => entry.goal && GOALS[entry.goal] ? { step: 0, editor: GOALS[entry.goal].make(me.businessName, entry.options), editingId: null, savedId: null, goal: entry.goal } : null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{ state: "idle" | "loading" | "ok" | "error"; data?: Preview; message?: string }>({ state: "idle" });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [when, setWhen] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState<Campaign | null>(null);
  useDirtyGuard("campaign-builder", Boolean(builder) && dirty);

  const unit = me.programType === "points" ? "Punkte" : "Stempel";
  const mode = list.state === "ok" ? list.data.deliveryMode : "disabled";
  const timezone = owner.locations.find(location => location.id === me.locationId)?.timezone;
  const browserZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  function start(editor: Editor, step = 0, editingId: string | null = null, goal: string | null = null) {
    setBuilder({ step, editor, editingId, savedId: editingId, goal }); setDirty(false); setPreview({ state: "idle" }); setError(""); setMessage(""); setDetail(null);
  }
  function change(patch: Partial<Editor>) { setBuilder(current => current && ({ ...current, editor: { ...current.editor, ...patch } })); setDirty(true); setPreview({ state: "idle" }); }

  async function inspect() {
    if (!builder || !audienceDefinitionSchema.safeParse(definitionOf(builder.editor)).success) return;
    setPreview({ state: "loading" });
    try { setPreview({ state: "ok", data: await postJson<Preview>("/api/merchant/campaigns/preview", { programSlug: me.programSlug, audienceDefinition: definitionOf(builder.editor) }) }); }
    catch (cause) { setPreview({ state: "error", message: reason(cause) }); }
  }
  async function saveDraft() {
    if (!builder || busy || !audienceDefinitionSchema.safeParse(definitionOf(builder.editor)).success) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const common = { title: builder.editor.title.trim(), subject: builder.editor.subject.trim(), body: builder.editor.body.trim(), audienceDefinition: definitionOf(builder.editor) };
      let id = builder.editingId ?? builder.savedId;
      if (id) await postJson("/api/merchant/campaigns", { action: "edit", campaignId: id, ...common });
      else { const created = await postJson<{ id?: string; campaignId?: string; campaign?: { id: string } }>("/api/merchant/campaigns", { action: "create", programSlug: me.programSlug, ...common }); id = created.id ?? created.campaignId ?? created.campaign?.id ?? null; }
      reloadList(); setDirty(false);
      setBuilder(current => current && ({ ...current, savedId: id }));
      setMessage("Entwurf gespeichert. Es wurde nichts versendet."); owner.announce("Entwurf gespeichert.");
    } catch (cause) { setError(reason(cause)); }
    finally { setBusy(false); }
  }
  async function act(id: string, action: "schedule" | "pause" | "cancel") {
    setBusy(true); setError(""); setMessage("");
    try {
      let payload: Record<string, unknown> = { action, campaignId: id };
      if (action === "schedule") {
        const local = when[id];
        if (!local || Number.isNaN(new Date(local).getTime())) throw new Error("Wähle zuerst einen gültigen Termin.");
        payload = { ...payload, scheduledAt: new Date(local).toISOString() };
      }
      await postJson("/api/merchant/campaigns", payload);
      reloadList();
      if (detail?.campaign.id === id) setDetail(await apiJson<Detail>(`/api/merchant/campaigns/${encodeURIComponent(id)}`));
      if (action === "schedule") setBuilder(null);
      setMessage(action === "schedule" ? "Termin gespeichert. Der aktuelle Status steht in der Liste." : action === "pause" ? "Kampagne pausiert." : "Kampagne abgebrochen.");
    } catch (cause) { setError(reason(cause)); }
    finally { setBusy(false); }
  }
  async function open(id: string, edit = false) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiJson<Detail>(`/api/merchant/campaigns/${encodeURIComponent(id)}`);
      if (edit) { if (result.campaign.status !== "draft") throw new Error("Nur Entwürfe können geändert werden."); start(editorFrom(result.campaign), 2, id); }
      else setDetail(result);
    } catch (cause) { setError(reason(cause)); }
    finally { setBusy(false); }
  }

  const head = (
    <header className="ow-pagehead"><div><p className="ow-eyebrow">Aktionen · {me.locationName}</p><h1>Kampagnen</h1><p>Wähle ein Ziel, prüfe die Zielgruppe und speichere einen Entwurf. Nichts wird automatisch versendet.</p></div>{!builder && <button type="button" className="ow-btn ow-btn--secondary" onClick={() => start({ ...BLANK })}>Eigene Kampagne</button>}</header>
  );
  const notices = <>
    {error && <Notice tone="danger" role="alert">{error}</Notice>}
    {message && <div role="status"><Notice tone="ok">{message}</Notice></div>}
  </>;

  if (!builder) {
    return (
      <div className="ow-page">
        {head}{notices}
        <Notice tone={mode === "disabled" ? "warn" : "info"}>{mode === "mailpit" ? "Lokaler Mailpit-Testkanal: nur synthetische .test-Adressen, keine externe Zustellung." : mode === "mailgun_eu" ? "Freigeschalteter EU-Versandkanal. Vor jeder Zustellung werden Einwilligung, Adresse, Zielgruppe und Versandgrenzen erneut geprüft." : <><strong>E-Mail-Versand ist noch nicht freigeschaltet.</strong> Du kannst Zielgruppen prüfen und Entwürfe vollständig vorbereiten. Gesendet wird nichts, bis der Versand freigegeben ist und du selbst planst.</>}</Notice>
        <section aria-labelledby="goal-h"><h2 id="goal-h" style={{ fontSize: 17, marginBottom: 12 }}>Womit möchtest du starten?</h2>
          <div className="ow-goals">{Object.entries(GOALS).map(([id, item]) => <button key={id} type="button" className="ow-goal" onClick={() => start(item.make(me.businessName, {}), 0, null, id)}><strong>{item.label}</strong><span>{item.text({})}</span><span className="ow-link" aria-hidden="true">Entwurf beginnen →</span></button>)}</div>
        </section>
        <section className="ow-card" aria-labelledby="camp-h">
          <div className="ow-card-head"><div><h2 id="camp-h">Deine Kampagnen</h2><p>Für {me.locationName}</p></div></div>
          {list.state === "loading" && <div className="ow-stack"><Skeleton height={64} /><Skeleton height={64} /></div>}
          {list.state === "error" && <Notice tone="danger" role="alert" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={reloadList}>Erneut laden</button>}>{list.message}</Notice>}
          {list.state === "ok" && list.data.campaigns.length === 0 && <div className="ow-empty"><strong>Noch keine Kampagne.</strong>Starte oben mit einem Ziel.</div>}
          {list.state === "ok" && list.data.campaigns.length > 0 && (
            <ul className="ow-rewards">{list.data.campaigns.map(campaign => (
              <li key={campaign.id} className="ow-reward" style={{ alignItems: "flex-start" }}>
                <div className="ow-reward-main"><strong>{campaign.title}</strong><span className="ow-muted">{campaign.subject}</span>{campaign.audienceDefinition && <span className="ow-hint">{audienceSentence(editorFrom({ ...campaign, body: "", audienceDefinition: campaign.audienceDefinition }), unit)}</span>}<span className="ow-hint">{campaign.status === "draft" ? "Noch nicht geplant, nichts versendet." : <>Zielgruppe bei Planung: {campaign.audienceCount}</>}{campaign.status !== "draft" && <> · eingereiht: {campaign.queuedCount} · Termin: {campaign.scheduledAt ? germanDate(campaign.scheduledAt, true) : "nicht geplant"}</>}</span>
                  {campaign.status === "paused" && mode !== "disabled" && <div className="ow-row" style={{ marginTop: 8 }}><label className="ow-sr" htmlFor={`w-${campaign.id}`}>Neuer Termin</label><input id={`w-${campaign.id}`} className="ow-input" style={{ maxWidth: 240 }} type="datetime-local" value={when[campaign.id] ?? ""} onChange={event => setWhen(current => ({ ...current, [campaign.id]: event.target.value }))} /><button type="button" className="ow-btn ow-btn--primary ow-btn--sm" disabled={busy || !when[campaign.id]} onClick={() => void act(campaign.id, "schedule")}>Erneut planen</button></div>}
                </div>
                <div className="ow-reward-actions"><span className={`ow-chip ${STATUS[campaign.status][1]}`}>{STATUS[campaign.status][0]}</span>
                  <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" disabled={busy} onClick={() => void open(campaign.id)}>Details</button>
                  {campaign.status === "draft" && <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" disabled={busy} onClick={() => void open(campaign.id, true)}>Bearbeiten</button>}
                  {campaign.status === "scheduled" && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" disabled={busy} onClick={() => void act(campaign.id, "pause")}>Pausieren</button>}
                  {["draft", "scheduled", "paused"].includes(campaign.status) && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" disabled={busy} onClick={() => setConfirmCancel(campaign)}>Abbrechen</button>}
                </div>
              </li>))}</ul>
          )}
        </section>
        {detail && <DetailPanel detail={detail} onClose={() => setDetail(null)} />}
        {confirmCancel && <OwnerDialog title={`„${confirmCancel.title}“ abbrechen?`} tone="danger" onClose={() => setConfirmCancel(null)} actions={<><button type="button" className="ow-btn ow-btn--secondary" data-autofocus onClick={() => setConfirmCancel(null)}>Zurück</button><button type="button" className="ow-btn ow-btn--danger" onClick={() => { const target = confirmCancel; setConfirmCancel(null); void act(target.id, "cancel"); }}>Kampagne abbrechen</button></>}><p>Eine abgebrochene Kampagne wird nicht mehr versendet.</p></OwnerDialog>}
      </div>
    );
  }

  const e = builder.editor;
  const audienceValidation = audienceDefinitionSchema.safeParse(definitionOf(e));
  const okStep0 = audienceValidation.success;
  const okStep1 = e.title.trim().length >= 2 && e.subject.trim().length >= 2 && e.body.trim().length >= 5;
  const p = preview.state === "ok" ? preview.data : undefined;
  return (
    <div className="ow-page">
      {head}{notices}
      {builder.goal && GOALS[builder.goal] && <p className="ow-muted" style={{ fontSize: 14 }}>Ziel: <strong>{GOALS[builder.goal].label}</strong></p>}
      <ol className="ow-stepper" aria-label="Fortschritt">{STEPS.map((label, index) => <li key={label} aria-current={index === builder.step ? "step" : undefined} data-done={index < builder.step}><span className="ow-stepper-n">{index < builder.step ? <OwnerIcon name="check" size={14} /> : index + 1}</span>{label}</li>)}</ol>
      <section className="ow-card ow-stack" style={{ gap: 20 }} aria-labelledby="bs-h">
        {!okStep0 && <Notice tone="danger" role="alert">Prüfe die Zielgruppe: Tage müssen ganze Zahlen von 1 bis 3650 sein, Kassenvorgänge von 1 bis 10000 und fehlende Stempel oder Punkte von 1 bis 100000.</Notice>}
        {builder.step === 0 && <>
          <div><h2 id="bs-h">Wen möchtest du erreichen?</h2><p className="ow-muted" style={{ fontSize: 14 }}>Die Zahl zeigt Karten, nicht Personen. Ob jemand per E-Mail erreichbar ist, prüfen wir im letzten Schritt.</p></div>
          <div className="ow-field"><label htmlFor="c-kind">Zielgruppe</label><select id="c-kind" className="ow-select" value={e.kind} onChange={event => change({ kind: event.target.value as Kind })}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          {(e.kind === "new" || e.kind === "recently_active" || e.kind === "frequent_visitors") && <div className="ow-field"><label htmlFor="c-within">Zeitraum in Tagen</label><input id="c-within" className="ow-input" style={{ maxWidth: 160 }} type="number" min={1} max={3650} value={e.withinDays} onChange={event => change({ withinDays: Number(event.target.value) })} /></div>}
          {e.kind === "inactive" && <div className="ow-field"><label htmlFor="c-inactive">Inaktiv seit mindestens (Tage)</label><input id="c-inactive" className="ow-input" style={{ maxWidth: 160 }} type="number" min={1} max={3650} value={e.daysSinceLast} onChange={event => change({ daysSinceLast: Number(event.target.value) })} /><span className="ow-hint">Nur Karten mit einem früheren bestätigten Vorgang.</span></div>}
          {e.kind === "frequent_visitors" && <div className="ow-field"><label htmlFor="c-min">Mindestens bestätigte Vorgänge</label><input id="c-min" className="ow-input" style={{ maxWidth: 160 }} type="number" min={1} max={10000} value={e.minCheckouts} onChange={event => change({ minCheckouts: Number(event.target.value) })} /></div>}
          {e.kind === "close_to_reward" && <div className="ow-grid-2"><div className="ow-field"><label htmlFor="c-rem">Höchstens fehlende {unit}</label><input id="c-rem" className="ow-input" type="number" min={1} max={100000} value={e.maxRemaining} onChange={event => change({ maxRemaining: Number(event.target.value) })} /></div><div className="ow-field"><label htmlFor="c-rw">Prämie</label><select id="c-rw" className="ow-select" value={e.rewardId} onChange={event => change({ rewardId: event.target.value })}><option value="">Nächste aktive Prämie</option>{program.state === "ok" && program.data.rewards.map(reward => <option key={reward.rewardId} value={reward.rewardId}>{reward.title}</option>)}</select></div></div>}
          <div className="ow-readonly"><strong>{audienceSentence(e, unit)}.</strong>
            <div className="ow-row" style={{ marginTop: 8 }}><button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => void inspect()} disabled={preview.state === "loading" || !okStep0}>{preview.state === "loading" ? "Wird berechnet …" : "Zielgruppe prüfen"}</button>{cardViewFor(e) && <a className="ow-link" href={cardViewFor(e)!} target="_blank" rel="noopener">Diese Karten ansehen (neuer Tab)</a>}</div>
            <div role="status" aria-live="polite" style={{ marginTop: 8 }}>{preview.state === "ok" && p && <span><strong className="ow-num">{p.total}</strong> {p.total === 1 ? "Karte" : "Karten"}, davon <strong className="ow-num">{p.eligibleCount}</strong> per E-Mail erreichbar. Stand {germanDate(p.asOf, true)}.</span>}{preview.state === "error" && <span className="ow-error">{preview.message}</span>}</div>
          </div>
        </>}
        {builder.step === 1 && <>
          <div><h2 id="bs-h">Was möchtest du schreiben?</h2><p className="ow-muted" style={{ fontSize: 14 }}>Ein Vorschlag aus deinem Ziel. Bitte lies und passe ihn an.</p></div>
          <div className="ow-field"><label htmlFor="c-title">Interner Titel</label><input id="c-title" className="ow-input" value={e.title} maxLength={180} onChange={event => change({ title: event.target.value })} /></div>
          <div className="ow-field"><label htmlFor="c-subject">Betreff</label><input id="c-subject" className="ow-input" value={e.subject} maxLength={SUBJECT_MAX} aria-describedby="c-subject-n" onChange={event => change({ subject: event.target.value.replace(/[\r\n]/g, " ") })} /><span id="c-subject-n" className="ow-hint ow-num">{e.subject.length}/{SUBJECT_MAX} Zeichen{e.subject.length > 60 ? " · Kurze Betreffzeilen werden auf dem Handy vollständig angezeigt." : ""}</span></div>
          <div className="ow-field"><label htmlFor="c-body">Nachricht</label><textarea id="c-body" className="ow-textarea" rows={6} value={e.body} maxLength={BODY_MAX} aria-describedby="c-body-n c-body-h" onChange={event => change({ body: event.target.value })} /><span id="c-body-n" className="ow-hint ow-num">{e.body.length}/{BODY_MAX} Zeichen</span><span id="c-body-h" className="ow-hint">Keine Zusagen machen, die dein Team nicht einhält. Loynara ergänzt bei Zustellung Geschäftsname und Abmeldelink.</span></div>
          <div className="ow-mail" aria-label="Vorschau der Nachricht"><small>Vorschau · von {me.businessName}</small><h3>{e.subject.trim() ? `${mode === "mailpit" ? "[LOCAL TEST] " : ""}${e.subject.trim()}` : "Betreff eingeben"}</h3><p style={{ whiteSpace: "pre-line" }}>{e.body.trim() || "Nachricht eingeben"}</p><p className="ow-hint" style={{ marginTop: 12 }}>{me.businessName}<br />Angebote abbestellen: Link wird automatisch eingefügt</p></div>
        </>}
        {builder.step === 2 && <>
          <div><h2 id="bs-h">Prüfen &amp; speichern</h2><p className="ow-muted" style={{ fontSize: 14 }}>Kontrolliere Zielgruppe und Kanal. Speichern legt nur einen Entwurf an.</p></div>
          <dl className="ow-dl">
            <dt>Standort</dt><dd>{me.locationName}</dd>
            <dt>Zeitzone</dt><dd>{timezone ?? "unbekannt"}</dd>
            <dt>Kanal</dt><dd>{channelLabel(mode)}</dd>
            <dt>Zielgruppe</dt><dd>{audienceSentence(e, unit)}</dd>
            <dt>Betreff</dt><dd>{e.subject}</dd>
          </dl>
          <div className="ow-readonly" aria-live="polite">
            <div className="ow-row" style={{ justifyContent: "space-between" }}><strong>Wer wird erreicht?</strong><button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => void inspect()} disabled={preview.state === "loading" || !okStep0}>{preview.state === "loading" ? "Wird berechnet …" : p ? "Neu berechnen" : "Berechnen"}</button></div>
            {preview.state === "error" && <p className="ow-error" role="alert">{preview.message}</p>}
            {p && <>
              <p style={{ marginTop: 8 }}><strong className="ow-num">{p.total}</strong> {p.total === 1 ? "Karte" : "Karten"} in der Zielgruppe, <strong className="ow-num">{p.eligibleCount}</strong> kontaktierbar. Stand {germanDate(p.asOf, true)}. Das ist eine Vorschau, keine Zusage für die Zustellung.</p>
              {(() => {
                const shown = EXCLUSION.filter(([key]) => (key !== "nonSynthetic" || p.deliveryMode === "mailpit") && p.excludedCountsByReason[key] > 0);
                return shown.length
                  ? <ul className="ow-feed">{shown.map(([key, label]) => <li key={key}><span>{label}</span><span className="ow-num">{p.excludedCountsByReason[key]} ausgeschlossen</span></li>)}</ul>
                  : <p className="ow-hint">Keine Ausschlüsse. Geprüft wurden Bestätigung, Werbeeinwilligung, Abmeldung, Sperren, Kontakthäufigkeit, Kartenstatus und Versandgrenze.</p>;
              })()}
              <p className="ow-hint">Tageslimit {p.dailyQuota}, Monatslimit je Standort {p.monthlyLocationQuota}, derzeit verfügbar {p.quotaRemaining}.</p>
            </>}
            {preview.state === "idle" && <p className="ow-muted" style={{ marginTop: 8 }}>Berechne die Zielgruppe, um Ausschlüsse mit Gründen zu sehen.</p>}
          </div>
          <div className="ow-readonly"><strong>Bereitschaft</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>{mode === "disabled" ? "E-Mail-Versand ist noch nicht freigeschaltet. Der Entwurf kann gespeichert, aber nicht geplant werden." : mode === "mailpit" ? "Lokaler Testkanal bereit (keine externe Zustellung)." : "Versandkanal bereit."}</li>
              <li>{p ? (p.eligibleCount > 0 ? `${p.eligibleCount} Karten kontaktierbar.` : "Aktuell ist niemand kontaktierbar. Kund:innen können auf ihrer Karte eine E-Mail-Adresse bestätigen und Angeboten zustimmen; erst dann zählen sie hier.") : "Zielgruppe noch nicht berechnet."}</li>
              <li>{p && p.eligibleCount > p.quotaRemaining ? "Die Zielgruppe übersteigt das verfügbare Versandlimit." : "Versandlimit: kein Konflikt bekannt."}</li>
            </ul>
          </div>
          {builder.savedId && mode === "disabled" && <Notice tone="info"><strong>Entwurf gespeichert, nichts versendet.</strong> Sobald der E-Mail-Versand freigeschaltet ist, kannst du diesen Entwurf hier planen. Bis dahin bleibt er unverändert in deiner Liste.</Notice>}
          {builder.savedId && mode !== "disabled" && (
            <div className="ow-field"><label htmlFor="c-when">Termin für den Versand</label><input id="c-when" className="ow-input" style={{ maxWidth: 260 }} type="datetime-local" value={when[builder.savedId] ?? ""} onChange={event => setWhen(current => ({ ...current, [builder.savedId!]: event.target.value }))} aria-describedby="c-when-hint" /><span id="c-when-hint" className="ow-hint">Der Termin gilt in deiner Browser-Zeitzone{browserZone ? ` (${browserZone})` : ""}{timezone && browserZone && timezone !== browserZone ? `. Der Standort nutzt ${timezone}, bitte achte auf den Unterschied.` : "."} Es wird nichts gesendet, bevor du hier plan­st. Zwischen 21 und 9 Uhr Ortszeit des Standorts wartet jede Nachricht bis 9 Uhr.</span></div>
          )}
        </>}
        <div className="ow-row" style={{ justifyContent: "space-between" }}>
          <span className="ow-row"><button type="button" className="ow-btn ow-btn--ghost" onClick={() => { if (builder.step === 0) { setBuilder(null); setDirty(false); } else setBuilder({ ...builder, step: builder.step - 1 }); }}>{builder.step === 0 ? "Abbrechen" : "Zurück"}</button></span>
          <span className="ow-row">
            {builder.step === 2 && builder.savedId && !dirty && <button type="button" className="ow-btn ow-btn--ghost" onClick={() => { setBuilder(null); reloadList(); }}>Zur Kampagnenliste</button>}
            {builder.step === 2 && <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void saveDraft()} disabled={busy || !okStep0 || !okStep1} aria-busy={busy}>{busy ? "Speichern …" : builder.savedId ? "Entwurf aktualisieren" : "Entwurf speichern"}</button>}
            {builder.step === 2 && builder.savedId && mode !== "disabled" && <button type="button" className="ow-btn ow-btn--primary" disabled={busy || dirty || !okStep0 || !when[builder.savedId]} onClick={() => void act(builder.savedId!, "schedule")}>Planen</button>}
            {builder.step < 2 && <button type="button" className="ow-btn ow-btn--primary" disabled={builder.step === 0 ? !okStep0 : !okStep0 || !okStep1} onClick={() => { const next = builder.step + 1; setBuilder({ ...builder, step: next }); if (next === 2 && preview.state === "idle") void inspect(); }}>Weiter</button>}
          </span>
        </div>
        {builder.step === 2 && dirty && builder.savedId && <p className="ow-hint">Ungespeicherte Änderungen. Speichere den Entwurf{mode !== "disabled" ? ", bevor du planst" : ""}.</p>}
      </section>
    </div>
  );
}

function DetailPanel({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const attempt = (value: string) => ({ complete: "Gesendet", suppressed: "Unterdrückt", retry: "Erneuter Versuch geplant", failed: "Fehlgeschlagen", blocked: "Blockiert" } as Record<string, string>)[value] ?? value;
  const provider = (value: string) => ({ accepted: "angenommen", delivered: "zugestellt", temporary_failure: "vorübergehendes Zustellproblem", permanent_failure: "dauerhaft fehlgeschlagen", complained: "Beschwerde", unsubscribed: "abgemeldet", ambiguous: "unklar, manuelle Prüfung nötig", sending: "unklar, manuelle Prüfung nötig" } as Record<string, string>)[value] ?? value;
  const s = detail.summary;
  return (
    <section className="ow-card ow-stack" aria-labelledby="det-h">
      <div className="ow-card-head" style={{ marginBottom: 0 }}><div><h2 id="det-h">{detail.campaign.title}</h2><p>Tatsächliche Vorgänge</p></div><button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={onClose}>Schließen</button></div>
      <dl className="ow-dl"><dt>Wartend</dt><dd>{s.queued}</dd><dt>Vom Versand angenommen</dt><dd>{s.sent}</dd><dt>Zugestellt laut Anbieter</dt><dd>{s.delivered}</dd><dt>Anbieterfehler</dt><dd>{s.providerFailed}</dd><dt>Unterdrückt</dt><dd>{s.suppressed}</dd><dt>Fehlgeschlagen</dt><dd>{s.failed}</dd></dl>
      <p className="ow-hint">„Angenommen“ heißt nicht „zugestellt“. Erst die Rückmeldung des Anbieters zählt als Zustellung.</p>
      {detail.outcome && detail.outcome.sent > 0 && <div className="ow-readonly"><strong>Danach wieder an der Kasse:</strong> <span className="ow-num">{detail.outcome.returnedAfterSend} von {detail.outcome.sent}</span> angeschriebenen Karten hatten nach dem Versand einen bestätigten Kassenvorgang.<p className="ow-hint" style={{ marginTop: 4 }}>Das ist eine Beobachtung, kein Beweis, dass die Nachricht der Grund war.</p></div>}
      <h3 style={{ fontSize: 15 }}>Letzte Zustellversuche</h3>
      {detail.attempts.length === 0 ? <p className="ow-muted">Noch keine Zustellversuche.</p> : <ol className="ow-feed">{detail.attempts.map((item, index) => <li key={`${item.recipientId}-${item.createdAt}-${index}`}><span><strong>{attempt(item.status)}</strong>{item.providerStatus && <span className="ow-muted"> · Anbieter: {provider(item.providerStatus)}</span>}{item.reason && <span className="ow-muted"> · {item.reason}</span>}</span><time dateTime={item.createdAt}>{germanDate(item.createdAt, true)}</time></li>)}</ol>}
    </section>
  );
}
