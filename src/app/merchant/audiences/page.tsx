"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiJson, ClientApiError, type MeResponse, type PublicProgram } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";
import type { AudienceDefinition } from "@/lib/segments";
import styles from "./audiences.module.css";

type Preview = { total: number; asOf: string; countingRule: string };
type Kind = AudienceDefinition["kind"];

function reason(cause: unknown) {
  return cause instanceof Error ? cause.message : "Die Segmentvorschau konnte nicht geladen werden.";
}

export default function MerchantAudiencesPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [program, setProgram] = useState<PublicProgram | null>(null);
  const [kind, setKind] = useState<Kind>("new");
  const [withinDays, setWithinDays] = useState("30");
  const [daysSinceLast, setDaysSinceLast] = useState("60");
  const [minCheckouts, setMinCheckouts] = useState("3");
  const [maxRemaining, setMaxRemaining] = useState("2");
  const [rewardId, setRewardId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const account = await apiJson<MeResponse>("/api/me");
        if (!active) return;
        if (account.role === "cashier") { router.replace("/cashier"); return; }
        if (!account.programSlug) throw new Error("Für diesen Standort ist kein aktives Programm eingerichtet.");
        const publicProgram = await apiJson<PublicProgram>(`/api/program/${encodeURIComponent(account.programSlug)}`);
        if (active) { setMe(account); setProgram(publicProgram); }
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
        setError(reason(cause));
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [router]);

  async function showPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me?.programSlug) return;
    const params = new URLSearchParams({ programSlug: me.programSlug, kind });
    if (kind === "new" || kind === "recently_active" || kind === "frequent_visitors") params.set("withinDays", withinDays);
    if (kind === "inactive") params.set("daysSinceLast", daysSinceLast);
    if (kind === "frequent_visitors") params.set("minCheckouts", minCheckouts);
    if (kind === "close_to_reward") {
      params.set("maxRemaining", maxRemaining);
      if (rewardId) params.set("rewardId", rewardId);
    }
    setPreviewing(true);
    setPreview(null);
    setError("");
    try { setPreview(await apiJson<Preview>(`/api/merchant/audiences/preview?${params}`)); }
    catch (cause) { setError(reason(cause)); }
    finally { setPreviewing(false); }
  }

  function updateKind(value: Kind) { setKind(value); setPreview(null); }

  return <div className="app-page">
    <header className="app-header"><div className="app-header-inner"><Link href="/merchant" aria-label="Zur Übersicht"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link><Link href="/merchant/customers">Kundenkarten</Link><Link href="/merchant/audiences" aria-current="page">Segmente</Link>{me?.role === "owner" && <Link href="/merchant/staff">Team</Link>}<Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Segmente</span></div></header>
    <main className={`app-container ${styles.main}`}>
      <div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> KUNDENAKTIVITÄT</span><h1>Segmente prüfen</h1><p>Sieh, wie viele pseudonyme Karten zu einer Regel passen. Das ist noch keine Liste versendbarer Kontakte.</p></div>
      {loading ? <p role="status">Programm wird geladen …</p> : !program || !me ? <p role="alert" className={styles.error}>{error || "Programm nicht verfügbar."}</p> : <div className={styles.grid}>
        <form className={`app-panel ${styles.form}`} onSubmit={showPreview}>
          <span className="tiny-label">{me.businessName} · {me.locationName}</span>
          <h2>Regel auswählen</h2>
          <p>Die Vorschau verwendet den aktuellen Datenstand dieses Programms.</p>
          <label>Segment
            <select value={kind} onChange={event => updateKind(event.target.value as Kind)}>
              <option value="new">Neu angemeldet</option>
              <option value="recently_active">Kürzlich aktiv</option>
              <option value="inactive">Inaktiv</option>
              <option value="frequent_visitors">Häufige Kassenaufträge</option>
              <option value="close_to_reward">Kurz vor einer Prämie</option>
            </select>
          </label>
          {(kind === "new" || kind === "recently_active" || kind === "frequent_visitors") && <label>Zeitraum in Tagen
            <input type="number" min="1" max="3650" required value={withinDays} onChange={event => { setWithinDays(event.target.value); setPreview(null); }} />
          </label>}
          {kind === "inactive" && <label>Letzter bestätigter Kassenauftrag vor mindestens so vielen Tagen
            <input type="number" min="1" max="3650" required value={daysSinceLast} onChange={event => { setDaysSinceLast(event.target.value); setPreview(null); }} />
          </label>}
          {kind === "frequent_visitors" && <label>Mindestens so viele bestätigte Kassenaufträge
            <input type="number" min="1" max="10000" required value={minCheckouts} onChange={event => { setMinCheckouts(event.target.value); setPreview(null); }} />
          </label>}
          {kind === "close_to_reward" && <><label>Höchstens so viele {program.programType === "stamp" ? "Stempel" : "Punkte"} bis zur Prämie
            <input type="number" min="1" max="100000" required value={maxRemaining} onChange={event => { setMaxRemaining(event.target.value); setPreview(null); }} />
          </label><label>Prämie
            <select value={rewardId} onChange={event => { setRewardId(event.target.value); setPreview(null); }}><option value="">Beliebige aktive Prämie</option>{program.rewards.map(reward => <option key={reward.id} value={reward.rewardId}>{reward.title} · {reward.cost}</option>)}</select>
          </label></>}
          <button className="button button--ink" type="submit" disabled={previewing}>{previewing ? "Berechne …" : "Anzahl berechnen"}</button>
        </form>
        <section className={`app-panel ${styles.result}`} aria-live="polite">
          <span className="tiny-label">VORSCHAU</span><h2>Passende Karten</h2>
          {previewing ? <p>Segment wird berechnet …</p> : preview ? <><strong className={styles.total} data-testid="audience-total">{preview.total}</strong><p>pseudonyme {preview.total === 1 ? "Karte" : "Karten"} erfüllen diese Regel.</p><p className={styles.muted}>Datenstand: <time dateTime={preview.asOf}>{new Date(preview.asOf).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</time></p></> : <p>Wähle eine Regel und berechne die Anzahl.</p>}
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <div className={styles.note}><h3>So wird gezählt</h3><p>Ein nicht stornierter, bestätigter Kassenauftrag zählt einmal, auch wenn mehrere Buchungen dazugehören. Ein Kassenauftrag beweist keinen physischen Besuch. Eine Kartenanmeldung oder ein Startguthaben zählt nicht als Kassenauftrag.</p><p>Für Nachrichten braucht jede Person zusätzlich eine verifizierte Kontaktadresse und eine passende Einwilligung.</p></div>
        </section>
      </div>}
    </main>
  </div>;
}
