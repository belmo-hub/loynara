"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { apiJson, type PublicProgram } from "@/components/client-api";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, germanDate, LoadingBlock, Notice, PageHead } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";
import type { AudienceDefinition } from "@/lib/segments";

type Preview = { total: number; asOf: string; countingRule: string };
type Kind = AudienceDefinition["kind"];
const reason = (cause: unknown) => cause instanceof Error ? cause.message : "Die Segmentvorschau konnte nicht geladen werden.";

export default function MerchantAudiencesPage() {
  const { me } = useOwner();
  const [program, reloadProgram] = useLoad<PublicProgram>(me?.programSlug ? `/api/program/${encodeURIComponent(me.programSlug)}` : null);
  const [kind, setKind] = useState<Kind>("new");
  const [withinDays, setWithinDays] = useState("30");
  const [daysSinceLast, setDaysSinceLast] = useState("60");
  const [minCheckouts, setMinCheckouts] = useState("3");
  const [maxRemaining, setMaxRemaining] = useState("2");
  const [rewardId, setRewardId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  if (!me) return null;
  const unit = me.programType === "stamp" ? "Stempel" : "Punkte";

  async function showPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me?.programSlug) return;
    const params = new URLSearchParams({ programSlug: me.programSlug, kind });
    if (kind === "new" || kind === "recently_active" || kind === "frequent_visitors") params.set("withinDays", withinDays);
    if (kind === "inactive") params.set("daysSinceLast", daysSinceLast);
    if (kind === "frequent_visitors") params.set("minCheckouts", minCheckouts);
    if (kind === "close_to_reward") { params.set("maxRemaining", maxRemaining); if (rewardId) params.set("rewardId", rewardId); }
    setPreviewing(true); setPreview(null); setError("");
    try { setPreview(await apiJson<Preview>(`/api/merchant/audiences/preview?${params}`)); }
    catch (cause) { setError(reason(cause)); }
    finally { setPreviewing(false); }
  }
  // Owners can continue from a previewed audience to a draft with the same threshold; managers cannot manage campaigns.
  const campaignLink = me.role !== "owner" || (me.hiddenSurfaces ?? []).includes("campaigns") ? null
    : kind === "inactive" ? `/merchant/campaigns?goal=winback&days=${Number(daysSinceLast) || 30}`
    : kind === "close_to_reward" ? `/merchant/campaigns?goal=near-reward&maxRemaining=${Number(maxRemaining) || 2}${rewardId ? `&rewardId=${encodeURIComponent(rewardId)}` : ""}`
    : kind === "recently_active" ? `/merchant/campaigns?goal=quiet&withinDays=${Number(withinDays) || 30}` : null;
  const change = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPreview(null); };

  return (
    <div className="ow-page">
      <PageHead eyebrow={`Kunden · ${me.locationName}`} title="Segmente prüfen" lead="Sieh, wie viele pseudonyme Karten zu einer Regel passen. Das ist noch keine Liste versendbarer Kontakte." />
      {program.state === "error" && <ErrorNotice message={program.message} onRetry={reloadProgram} />}
      {program.state === "loading" && <LoadingBlock />}
      {program.state === "ok" && (
        <div className="ow-two" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
          <form className="ow-card ow-stack" onSubmit={showPreview}>
            <div><h2>Regel auswählen</h2><p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Die Vorschau verwendet den aktuellen Datenstand dieses Programms.</p></div>
            <div className="ow-field"><label htmlFor="au-kind">Segment</label>
              <select id="au-kind" className="ow-select" value={kind} onChange={event => change(setKind)(event.target.value as Kind)}>
                <option value="new">Neu angemeldet</option><option value="recently_active">Kürzlich aktiv</option><option value="inactive">Inaktiv</option><option value="frequent_visitors">Häufige Buchungen</option><option value="close_to_reward">Kurz vor einer Prämie</option>
              </select></div>
            {(kind === "new" || kind === "recently_active" || kind === "frequent_visitors") && <div className="ow-field"><label htmlFor="au-within">Zeitraum in Tagen</label><input id="au-within" className="ow-input" type="number" min="1" max="3650" required value={withinDays} onChange={event => change(setWithinDays)(event.target.value)} /></div>}
            {kind === "inactive" && <div className="ow-field"><label htmlFor="au-inactive">Letzte bestätigte Buchung vor mindestens so vielen Tagen</label><input id="au-inactive" className="ow-input" type="number" min="1" max="3650" required value={daysSinceLast} onChange={event => change(setDaysSinceLast)(event.target.value)} /></div>}
            {kind === "frequent_visitors" && <div className="ow-field"><label htmlFor="au-min">Mindestens so viele bestätigte Buchungen</label><input id="au-min" className="ow-input" type="number" min="1" max="10000" required value={minCheckouts} onChange={event => change(setMinCheckouts)(event.target.value)} /></div>}
            {kind === "close_to_reward" && <>
              <div className="ow-field"><label htmlFor="au-rem">Höchstens so viele {unit} bis zur Prämie</label><input id="au-rem" className="ow-input" type="number" min="1" max="100000" required value={maxRemaining} onChange={event => change(setMaxRemaining)(event.target.value)} /></div>
              <div className="ow-field"><label htmlFor="au-reward">Prämie</label><select id="au-reward" className="ow-select" value={rewardId} onChange={event => change(setRewardId)(event.target.value)}><option value="">Beliebige aktive Prämie</option>{program.data.rewards.map(reward => <option key={reward.id} value={reward.rewardId}>{reward.title} · {reward.cost}</option>)}</select></div>
            </>}
            <div><button className="ow-btn ow-btn--primary" type="submit" disabled={previewing} aria-busy={previewing}>{previewing ? "Berechne …" : "Anzahl berechnen"}</button></div>
          </form>
          <section className="ow-card ow-stack" aria-live="polite" aria-labelledby="au-result">
            <h2 id="au-result">Passende Karten</h2>
            {previewing ? <p className="ow-muted">Segment wird berechnet …</p>
              : preview ? <div><strong className="ow-metric-value" style={{ fontSize: "var(--display-num)" }} data-testid="audience-total">{preview.total}</strong><p>pseudonyme {preview.total === 1 ? "Karte erfüllt" : "Karten erfüllen"} diese Regel.</p><p className="ow-hint">Datenstand: <time dateTime={preview.asOf}>{germanDate(preview.asOf, true)}</time></p>{campaignLink && <p style={{ marginTop: 12 }}><Link className="ow-btn ow-btn--secondary ow-btn--sm" href={campaignLink}>Kampagnenentwurf für diese Zielgruppe</Link></p>}</div>
              : <p className="ow-muted">Wähle eine Regel und berechne die Anzahl.</p>}
            {error && <ErrorNotice message={error} />}
            <Notice><div><strong>So wird gezählt</strong><p style={{ marginTop: 4 }}>Eine nicht stornierte, bestätigte Buchung zählt einmal. Eine Buchung beweist keinen physischen Besuch. Eine Kartenanmeldung oder ein Startguthaben zählt hier nicht.</p><p style={{ marginTop: 4 }}>Für Nachrichten braucht jede Person zusätzlich eine verifizierte Kontaktadresse und eine passende Einwilligung.</p></div></Notice>
          </section>
        </div>
      )}
    </div>
  );
}
