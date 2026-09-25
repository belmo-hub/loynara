"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { apiJson, ClientApiError, postJson, type MeResponse } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";
import styles from "./locations.module.css";

type Location = {
  id: string; name: string; city: string; country: string; timezone: string; createdAt: string;
  programSlug: string | null; programName: string | null; programType: "stamp" | "points" | null;
  cards: number; awards: number; redemptions: number; activeStaff: number;
};
type LocationList = {
  scope: "all_merchant_locations"; currency: "EUR" | "MAD";
  totals: { locations: number; cards: number; awards: number; redemptions: number };
  locations: Location[]; countingRule: string;
};
type Draft = { name: string; city: string; timezone: string; programName: string; programType: "stamp" | "points"; pointsPerCurrencyUnit: number; rulesText: string; rewardTitle: string; rewardCost: number };
const emptyDraft: Draft = { name: "", city: "", timezone: "Europe/Berlin", programName: "", programType: "stamp", pointsPerCurrencyUnit: 1, rulesText: "", rewardTitle: "", rewardCost: 5 };

export default function MerchantLocationsPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [list, setList] = useState<LocationList | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void apiJson<MeResponse>("/api/me").then(async account => {
      if (!active) return;
      if (account.role !== "owner") { setForbidden(true); setLoading(false); return; }
      if (!account.programSlug) { router.replace("/merchant/program"); return; }
      const locations = await apiJson<LocationList>("/api/merchant/locations");
      if (active) { setMe(account); setList(locations); setLoading(false); }
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 403) { setForbidden(true); setLoading(false); return; }
      setError(cause instanceof Error ? cause.message : "Standorte konnten nicht geladen werden."); setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  async function select(id: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      await postJson("/api/merchant/locations/select", { locationId: id });
      setMe(await apiJson<MeResponse>("/api/me"));
      setMessage("Aktiver Standort gewechselt. Die Kasse und die Programmseite verwenden jetzt diesen Standort.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Standort konnte nicht gewechselt werden."); }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!list) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const created = await postJson<{ locationId: string }>("/api/merchant/locations", {
        ...draft, country: list.currency === "EUR" ? "DE" : "MA",
        earningMode: draft.programType === "points" ? "purchase" : "manual",
      });
      await postJson("/api/merchant/locations/select", { locationId: created.locationId });
      const [account, locations] = await Promise.all([apiJson<MeResponse>("/api/me"), apiJson<LocationList>("/api/merchant/locations")]);
      setMe(account); setList(locations); setDraft(emptyDraft);
      setMessage("Standort mit eigenem Programm und eigener Prämie angelegt und ausgewählt. Bestehende Karten und Guthaben blieben am bisherigen Standort.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Standort konnte nicht angelegt werden."); }
    finally { setBusy(false); }
  }

  return <div className="app-page"><header className={`app-header ${styles.header}`}><div className="app-header-inner"><Link href="/merchant"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link><Link href="/merchant/locations" aria-current="page">Standorte</Link><Link href="/merchant/staff">Team</Link><Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Standorte</span></div></header>
    <main className={`app-container ${styles.main}`}><div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> EIN BETRIEB · MEHRERE STANDORTE</span><h1>Standorte</h1><p>Jeder Standort hat sein eigenes Programm, seine eigenen Karten und seinen eigenen Kassenkontext.</p></div>
      {loading ? <section className="app-panel"><p role="status">Standorte werden geladen …</p></section> : forbidden ? <section className="app-panel"><p role="alert">Nur Inhaberinnen und Inhaber können Standorte verwalten.</p></section> : !list || !me ? <section className="app-panel"><p role="alert">{error || "Standorte konnten nicht geladen werden."}</p></section> : <>
        {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}
        <section className={`app-panel ${styles.overview}`} aria-labelledby="location-overview-title"><span className="tiny-label">ALLE STANDORTE DIESES BETRIEBS</span><h2 id="location-overview-title">Gesamtübersicht</h2><dl><div><dt>Standorte</dt><dd>{list.totals.locations}</dd></div><div><dt>Karten insgesamt</dt><dd>{list.totals.cards}</dd></div><div><dt>Gutschrift-Einträge</dt><dd>{list.totals.awards}</dd></div><div><dt>Einlösungen</dt><dd>{list.totals.redemptions}</dd></div></dl><p>{list.countingRule}</p></section>
        <div className={styles.columns}><section aria-labelledby="location-list-title"><h2 id="location-list-title">Deine Standorte</h2><div className={styles.locations}>{list.locations.map(location => <article className="app-panel" key={location.id}><div className={styles.locationHead}><div><h3>{location.name}</h3><p>{location.city} · {location.country}</p></div>{location.id === me.locationId && <span className={styles.active}>Aktiver Standort</span>}</div><p>{location.programName || "Kein aktives Programm"} {location.programType ? `· ${location.programType === "stamp" ? "Stempel" : "Punkte"}` : ""}</p><dl><div><dt>Karten</dt><dd>{location.cards}</dd></div><div><dt>Gutschriften</dt><dd>{location.awards}</dd></div><div><dt>Einlösungen</dt><dd>{location.redemptions}</dd></div><div><dt>Aktive Teamzugänge</dt><dd>{location.activeStaff}</dd></div></dl>{location.id !== me.locationId ? <button type="button" className="button button--outline" disabled={busy} onClick={() => void select(location.id)}>Als aktiven Standort wählen</button> : <Link href="/merchant/program" className="button button--outline">Programm ansehen</Link>}</article>)}</div></section>
          <section className={`app-panel ${styles.creator}`} aria-labelledby="location-create-title"><span className="tiny-label">NUR FÜR INHABER/INNEN</span><h2 id="location-create-title">Standort hinzufügen</h2><p>Ein neues Standortprogramm beginnt mit null Karten und null Guthaben. Währung und Land bleiben beim bestehenden Betrieb: {list.currency} · {list.currency === "EUR" ? "Deutschland" : "Marokko"}.</p><form onSubmit={create}><fieldset disabled={busy}><label>Standortname<input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} minLength={2} maxLength={180} required /></label><label>Stadt<input value={draft.city} onChange={event => setDraft(current => ({ ...current, city: event.target.value }))} minLength={2} maxLength={120} required /></label><label>Zeitzone<input value={draft.timezone} onChange={event => setDraft(current => ({ ...current, timezone: event.target.value }))} minLength={3} maxLength={80} required /></label><label>Programmname<input value={draft.programName} onChange={event => setDraft(current => ({ ...current, programName: event.target.value }))} minLength={2} maxLength={180} required /></label><label>Programmtyp<select value={draft.programType} onChange={event => setDraft(current => ({ ...current, programType: event.target.value as Draft["programType"] }))}><option value="stamp">Stempel, manuelle Vergabe</option><option value="points">Punkte je Kaufbetrag</option></select></label>{draft.programType === "points" && <label>Punkte pro 1 {list.currency}<input type="number" value={draft.pointsPerCurrencyUnit} onChange={event => setDraft(current => ({ ...current, pointsPerCurrencyUnit: Number(event.target.value) }))} min={1} max={1000} step={1} required /></label>}<label>Teilnahmebedingungen<textarea value={draft.rulesText} onChange={event => setDraft(current => ({ ...current, rulesText: event.target.value }))} minLength={10} maxLength={3000} rows={4} required /></label><label>Erste Prämie<input value={draft.rewardTitle} onChange={event => setDraft(current => ({ ...current, rewardTitle: event.target.value }))} minLength={2} maxLength={180} required /></label><label>Kosten in {draft.programType === "stamp" ? "Stempeln" : "Punkten"}<input type="number" value={draft.rewardCost} onChange={event => setDraft(current => ({ ...current, rewardCost: Number(event.target.value) }))} min={1} max={100000} step={1} required /></label><button type="submit" className="button button--ink">Standort und Programm anlegen</button></fieldset></form></section></div>
      </>}
    </main></div>;
}
