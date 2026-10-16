"use client";

import { GuardedLink } from "@/components/owner/owner-shell";
import { useEffect, useState, type FormEvent } from "react";
import { postJson } from "@/components/client-api";
import { clearFlash, peekFlash, setFlash } from "@/components/owner/flash";
import { useDirtyGuard, useOwner } from "@/components/owner/owner-context";
import { locationCreateMessage, locationSwitchMessage } from "@/components/owner/owner-errors";
import { ErrorNotice, LoadingBlock, Notice, PageHead } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

type Location = {
  id: string; name: string; city: string; country: string; timezone: string; createdAt: string;
  programSlug: string | null; programName: string | null; programType: "stamp" | "points" | null;
  cards: number; awards: number; redemptions: number; activeStaff: number;
};
type LocationList = { scope: "all_merchant_locations"; currency: "EUR" | "MAD"; totals: { locations: number; cards: number; awards: number; redemptions: number }; locations: Location[]; countingRule: string };
type Draft = { name: string; city: string; timezone: string; programName: string; programType: "stamp" | "points"; pointsPerCurrencyUnit: number; rulesText: string; rewardTitle: string; rewardCost: number };
const emptyDraft: Draft = { name: "", city: "", timezone: "Europe/Berlin", programName: "", programType: "stamp", pointsPerCurrencyUnit: 1, rulesText: "", rewardTitle: "", rewardCost: 5 };

export default function MerchantLocationsPage() {
  const owner = useOwner();
  const me = owner.me;
  const [list, reload] = useLoad<LocationList>(me?.role === "owner" ? "/api/merchant/locations" : null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message] = useState(() => peekFlash());
  useEffect(() => { clearFlash(); }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(emptyDraft);
  useDirtyGuard("location-draft", dirty);
  if (!me) return null;
  const head = <PageHead eyebrow="Einstellungen · Standorte" title="Standorte" lead="Jeder Standort hat sein eigenes Programm, seine eigenen Karten und seinen eigenen Kassenkontext." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur Inhaber:innen können Standorte verwalten.</Notice></div>;
  if (list.state === "error") return <div className="ow-page">{head}<ErrorNotice message={list.message} onRetry={reload} /></div>;
  if (list.state !== "ok") return <div className="ow-page">{head}<LoadingBlock rows={3} /></div>;
  const l = list.data;
  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      let created: { locationId: string };
      try { created = await postJson<{ locationId: string }>("/api/merchant/locations", { ...draft, country: l.currency === "EUR" ? "DE" : "MA", earningMode: draft.programType === "points" ? "purchase" : "manual" }); }
      catch (cause) { setError(locationCreateMessage(cause)); return; }
      try { await postJson("/api/merchant/locations/select", { locationId: created.locationId }); }
      catch (cause) {
        // The location exists now: empty the form (sending it again would hit LOCATION_EXISTS) and list the new location.
        setDraft(emptyDraft); owner.setDirty("location-draft", false); reload(); void owner.refresh();
        setError(`Der neue Standort wurde angelegt. ${locationSwitchMessage(cause)}`);
        return;
      }
      setFlash("Standort mit eigenem Programm und eigener Prämie angelegt und ausgewählt. Bestehende Karten und Guthaben blieben am bisherigen Standort.");
      owner.setDirty("location-draft", false);
      await owner.refresh(); // the shell remounts this page for the new location and shows the message
    } finally { setBusy(false); }
  }

  return (
    <div className="ow-page">
      {head}
      {message && <div role="status"><Notice tone="ok">{message}</Notice></div>}
      {error && <ErrorNotice message={error} />}
      <section className="ow-card ow-stack" aria-labelledby="loc-overview"><h2 id="loc-overview">Gesamtübersicht</h2>
        <dl className="ow-metrics"><Stat label="Standorte" value={l.totals.locations} /><Stat label="Karten insgesamt" value={l.totals.cards} /><Stat label="Gutschrift-Einträge" value={l.totals.awards} /><Stat label="Einlösungen" value={l.totals.redemptions} /></dl>
        <p className="ow-hint">{l.countingRule}</p></section>
      <div className="ow-two" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)" }}>
        <section aria-labelledby="loc-list" className="ow-stack"><h2 id="loc-list" style={{ fontSize: "var(--text-18)" }}>Deine Standorte</h2>
          {l.locations.map(location => (
            <article className="ow-card ow-stack" key={location.id}>
              <div className="ow-card-head" style={{ marginBottom: 0 }}><div><h3 style={{ fontSize: "var(--text-16)" }}>{location.name}</h3><p>{location.city} · {location.country}</p></div>{location.id === me.locationId && <span className="ow-chip ow-chip--ok">Aktiver Standort</span>}</div>
              <p>{location.programName || "Kein aktives Programm"}{location.programType ? ` · ${location.programType === "stamp" ? "Stempel" : "Punkte"}` : ""}</p>
              <dl className="ow-dl"><dt>Karten</dt><dd className="ow-num">{location.cards}</dd><dt>Gutschriften</dt><dd className="ow-num">{location.awards}</dd><dt>Einlösungen</dt><dd className="ow-num">{location.redemptions}</dd><dt>Aktive Teamzugänge</dt><dd className="ow-num">{location.activeStaff}</dd></dl>
              <div>{location.id !== me.locationId ? <button type="button" className="ow-btn ow-btn--secondary" disabled={busy || owner.switching} onClick={() => owner.switchLocation(location.id)}>Als aktiven Standort wählen</button> : <GuardedLink href="/merchant/program" className="ow-btn ow-btn--secondary">Programm ansehen</GuardedLink>}</div>
            </article>
          ))}
        </section>
        <section className="ow-card ow-stack" aria-labelledby="loc-create" style={{ alignSelf: "start" }}>
          <div><h2 id="loc-create">Standort hinzufügen</h2><p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Ein neues Standortprogramm beginnt mit null Karten und null Guthaben. Währung und Land bleiben beim bestehenden Betrieb: {l.currency} · {l.currency === "EUR" ? "Deutschland" : "Marokko"}.</p></div>
          <form onSubmit={create} className="ow-stack">
            <Field id="lc-name" label="Standortname"><input id="lc-name" className="ow-input" value={draft.name} onChange={event => set({ name: event.target.value })} minLength={2} maxLength={180} required /></Field>
            <Field id="lc-city" label="Stadt"><input id="lc-city" className="ow-input" value={draft.city} onChange={event => set({ city: event.target.value })} minLength={2} maxLength={120} required /></Field>
            <Field id="lc-tz" label="Zeitzone"><input id="lc-tz" className="ow-input" value={draft.timezone} onChange={event => set({ timezone: event.target.value })} minLength={3} maxLength={80} required /></Field>
            <Field id="lc-prog" label="Programmname"><input id="lc-prog" className="ow-input" value={draft.programName} onChange={event => set({ programName: event.target.value })} minLength={2} maxLength={180} required /></Field>
            <Field id="lc-type" label="Programmtyp"><select id="lc-type" className="ow-select" value={draft.programType} onChange={event => set({ programType: event.target.value as Draft["programType"] })}><option value="stamp">Stempel, manuelle Vergabe</option><option value="points">Punkte je Kaufbetrag</option></select></Field>
            {draft.programType === "points" && <Field id="lc-rate" label={`Punkte pro 1 ${l.currency}`}><input id="lc-rate" className="ow-input" type="number" value={draft.pointsPerCurrencyUnit} onChange={event => set({ pointsPerCurrencyUnit: Number(event.target.value) })} min={1} max={1000} step={1} required /></Field>}
            <Field id="lc-rules" label="Teilnahmebedingungen"><textarea id="lc-rules" className="ow-textarea" value={draft.rulesText} onChange={event => set({ rulesText: event.target.value })} minLength={10} maxLength={3000} rows={4} required /></Field>
            <Field id="lc-reward" label="Erste Prämie"><input id="lc-reward" className="ow-input" value={draft.rewardTitle} onChange={event => set({ rewardTitle: event.target.value })} minLength={2} maxLength={180} required /></Field>
            <Field id="lc-cost" label={`Kosten in ${draft.programType === "stamp" ? "Stempeln" : "Punkten"}`}><input id="lc-cost" className="ow-input" style={{ maxWidth: 200 }} type="number" value={draft.rewardCost} onChange={event => set({ rewardCost: Number(event.target.value) })} min={1} max={100000} step={1} required /></Field>
            <div><button type="submit" className="ow-btn ow-btn--primary" disabled={busy} aria-busy={busy}>{busy ? "Wird angelegt …" : "Standort und Programm anlegen"}</button></div>
          </form>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="ow-metric"><dt>{label}</dt><dd><span className="ow-metric-value">{value}</span></dd></div>; }
function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) { return <div className="ow-field"><label htmlFor={id}>{label}</label>{children}</div>; }
