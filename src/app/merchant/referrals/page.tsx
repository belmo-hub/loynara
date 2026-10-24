"use client";

import { useState, type FormEvent } from "react";
import { postJson } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, germanDate, LoadingBlock, Notice, PageHead, SaveBar, type SaveState } from "@/components/owner/owner-ui";
import { ReferralSummary } from "@/components/owner/referral-summary";
import { useLoad } from "@/components/owner/use-load";
import { EmptyState } from "@/components/ui/empty-state";

type Settings = { enabled: boolean; referrerBonus: number; referredBonus: number; programType: "stamp" | "points" };
type Referral = { id: string; status: string; referrerCard: string; referredCard: string; referrerBonus: number; referredBonus: number; reviewReason: string | null; hasCreditedBonus: boolean; createdAt: string; qualifiedAt: string | null };

const STATUS: Record<string, string> = { pending: "Wartet auf erste Buchung", qualified: "Bonus gebucht", review: "Prüfung nötig", rejected: "Abgelehnt", reversed: "Bonus korrigiert" };
const status = (value: string) => STATUS[value] ?? value;
function reviewReason(value: string | null) {
  switch (value) {
    case "duplicate_verified_email": return "Eine andere Karte mit derselben verifizierten E-Mail-Adresse hat bereits einen Empfehlungsbonus ausgelöst.";
    case "same_verified_email": return "Beide Karten haben dieselbe verifizierte E-Mail-Adresse.";
    case "bonus_spent": return "Ein Bonus wurde bereits eingelöst oder ausgegeben.";
    case "owner_required": return "Die Korrektur überschreitet die Befugnis der Standortleitung.";
    case "member_unavailable": return "Eine der Karten ist nicht mehr verfügbar.";
    case "balance_limit": return "Ein Guthabenlimit würde überschritten.";
    default: return value ?? "";
  }
}

export default function MerchantReferralsPage() {
  const { me } = useOwner();
  const slug = me?.programSlug ? encodeURIComponent(me.programSlug) : null;
  const owner = me?.role === "owner";
  const [rule, reloadRule] = useLoad<Settings>(owner && slug ? `/api/merchant/referrals/settings?programSlug=${slug}` : null);
  const [list, reloadList] = useLoad<{ referrals: Referral[] }>(owner && slug ? `/api/merchant/referrals?programSlug=${slug}` : null);
  if (!me) return null;
  const head = <PageHead eyebrow="Treueprogramm · Empfehlungen" title="Empfehlungen" lead="Geteilt ist noch nicht gewonnen: Ein Bonus fließt erst, wenn die neue Karte zum ersten Mal an deiner Kasse bestätigt wird." />;
  if (!owner) return <div className="ow-page">{head}<Notice tone="warn" role="alert">Empfehlungen können nur von Inhaber:innen verwaltet werden.</Notice></div>;
  if (rule.state === "error") return <div className="ow-page">{head}<ErrorNotice message={rule.message} onRetry={reloadRule} /></div>;
  if (rule.state !== "ok") return <div className="ow-page">{head}<LoadingBlock rows={2} /></div>;
  return <Loaded slug={me.programSlug} businessName={me.businessName} locationName={me.locationName} head={head} settings={rule.data} list={list} reloadList={reloadList} />;
}

function Loaded({ slug, businessName, locationName, head, settings, list, reloadList }: { slug: string; businessName: string; locationName: string; head: React.ReactNode; settings: Settings; list: ReturnType<typeof useLoad<{ referrals: Referral[] }>>[0]; reloadList: () => void }) {
  const [saved, setSaved] = useState(settings);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [referrerBonus, setReferrerBonus] = useState(String(settings.referrerBonus));
  const [referredBonus, setReferredBonus] = useState(String(settings.referredBonus));
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const unit = saved.programType === "points" ? "Punkte" : "Stempel";
  const a = Number(referrerBonus), b = Number(referredBonus);
  const numbersOk = Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a <= 1000 && b <= 1000 && referrerBonus !== "" && referredBonus !== "";
  const ruleOk = numbersOk && (!enabled || a > 0 || b > 0);
  const changed = enabled !== saved.enabled || a !== saved.referrerBonus || b !== saved.referredBonus;
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("referral-rule", changed);
  const touch = () => { if (state === "saved" || state === "error") { setState("clean"); setError(""); } };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "saving" || !ruleOk) return;
    setState("saving"); setError(""); setNotice("");
    try {
      const next = await postJson<Settings>("/api/merchant/referrals/settings", { programSlug: slug, enabled, referrerBonus: a, referredBonus: b });
      setSaved(next); setEnabled(next.enabled); setReferrerBonus(String(next.referrerBonus)); setReferredBonus(String(next.referredBonus)); setState("saved");
    } catch (cause) { setState("error"); setError(cause instanceof Error ? cause.message : "Die Regel konnte nicht gespeichert werden."); }
  }
  async function review(referral: Referral, action: "reject" | "retry_reversal") {
    setReviewing(referral.id); setError(""); setNotice("");
    try {
      const outcome = await postJson<{ status: string }>(`/api/merchant/referrals/${encodeURIComponent(referral.id)}/review`, action === "reject" ? { action, reason: (notes[referral.id] ?? "").trim() } : { action });
      reloadList();
      setNotes(current => { const next = { ...current }; delete next[referral.id]; return next; });
      setNotice(outcome.status === "review" ? "Die Bonus-Korrektur ist noch nicht möglich. Der Vorgang bleibt zur Prüfung offen." : "Prüfentscheidung gespeichert.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Die Prüfung konnte nicht gespeichert werden."); }
    finally { setReviewing(null); }
  }

  const referrals = list.state === "ok" ? list.data.referrals : [];
  // Off and nothing happened yet: a funnel of zeros and an empty history only push the switch down the page.
  const untouched = !saved.enabled && list.state === "ok" && referrals.length === 0;
  return (
    <div className="ow-page">
      {head}
      {notice && <div role="status"><Notice tone="ok">{notice}</Notice></div>}
      {list.state === "ok" && !untouched && <ReferralSummary enabled={saved.enabled} referrerBonus={saved.referrerBonus} referredBonus={saved.referredBonus} programType={saved.programType} referrals={referrals} truncated={referrals.length >= 100} />}
      <div className="ow-two" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <form className="ow-card ow-stack" onSubmit={save}>
          <div><p className="ow-eyebrow">{locationName === businessName ? businessName : `${businessName} · ${locationName}`}</p><h2>Bonusregel</h2></div>
          <label className="ow-check"><input type="checkbox" role="switch" checked={enabled} onChange={event => { setEnabled(event.target.checked); touch(); }} /> Empfehlungen für neue Anmeldungen aktivieren</label>
          <div className="ow-grid-2">
            <div className="ow-field"><label htmlFor="rf-a">Bonus für empfehlende Karte ({unit})</label><input id="rf-a" className="ow-input" type="number" min="0" max="1000" required value={referrerBonus} onChange={event => { setReferrerBonus(event.target.value); touch(); }} /></div>
            <div className="ow-field"><label htmlFor="rf-b">Bonus für neue Karte ({unit})</label><input id="rf-b" className="ow-input" type="number" min="0" max="1000" required value={referredBonus} onChange={event => { setReferredBonus(event.target.value); touch(); }} /></div>
          </div>
          <p className="ow-hint">Wenn die Regel aktiv ist, muss mindestens ein Bonus größer als null sein. Die Beträge werden bei der Anmeldung festgehalten; spätere Änderungen schreiben vorhandene Empfehlungen nicht um.</p>
          <SaveBar asSubmit state={shown} onDiscard={() => { setEnabled(saved.enabled); setReferrerBonus(String(saved.referrerBonus)); setReferredBonus(String(saved.referredBonus)); setState("clean"); setError(""); }} canSave={changed && ruleOk} saveLabel="Regel speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : shown === "saved" ? "Empfehlungsregel gespeichert. Änderungen gelten für neue Anmeldungen mit Empfehlungslink." : shown === "dirty" && !ruleOk ? "Bei aktiver Regel muss ein Bonus größer als null sein." : undefined} />
        </form>
        <section className="ow-card ow-stack" aria-labelledby="rf-how"><h2 id="rf-how">So funktioniert es</h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6, listStyle: "decimal" }}><li>Eine Person teilt den Link ihrer Karte.</li><li>Eine neue Karte wird über diesen Link erstellt. Dafür gibt es noch keinen Bonus.</li><li>Die erste Buchung der neuen Karte wird an deiner Kasse bestätigt. Dann werden beide konfigurierten Boni einmalig im Buchungsjournal erfasst.</li></ol>
          <p className="ow-hint">Melden sich zwei Karten mit derselben bestätigten E-Mail-Adresse an, hält Loynara die Empfehlung zur Prüfung an. Ganz ausschließen lässt sich Missbrauch nicht, weil Karten keine Namen haben.</p></section>
      </div>
      {!untouched && <section className="ow-card ow-stack" aria-labelledby="rf-hist">
        <div className="ow-card-head" style={{ marginBottom: 0 }}><div><h2 id="rf-hist">Vorgänge und Prüfung</h2><p>Letzte 100 Empfehlungen</p></div><span className="ow-muted">{referrals.length} angezeigt</span></div>
        {list.state === "loading" && <LoadingBlock rows={1} height={56} />}
        {list.state === "error" && <ErrorNotice message={list.message} onRetry={reloadList} />}
        {list.state === "ok" && (referrals.length === 0 ? <EmptyState level={3} size="compact" title="Noch keine Anmeldungen über Empfehlungslinks.">Gäste finden ihren Empfehlungslink auf ihrer Karte unter „Karte empfehlen“.</EmptyState> : (
          <ul className="ow-feed">{referrals.map(referral => (
            <li key={referral.id} style={{ display: "block" }}>
              <div className="ow-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div><strong>{status(referral.status)}</strong><br /><small className="ow-muted">Karte {referral.referrerCard} → Karte {referral.referredCard}</small><br /><small className="ow-muted">Angemeldet: {germanDate(referral.createdAt, true)}</small></div>
                <span className="ow-chip ow-num">+{referral.referrerBonus} / +{referral.referredBonus} {unit}</span>
              </div>
              {referral.reviewReason && <p className="ow-hint" style={{ marginTop: 6 }}>{reviewReason(referral.reviewReason)}</p>}
              {referral.status === "review" && (
                <div className="ow-row" style={{ marginTop: 8, alignItems: "flex-end" }}>
                  {referral.hasCreditedBonus
                    ? <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" disabled={reviewing === referral.id} onClick={() => void review(referral, "retry_reversal")}>{reviewing === referral.id ? "Prüft …" : "Bonus-Korrektur erneut prüfen"}</button>
                    : <>
                      <div className="ow-field" style={{ flex: "1 1 240px" }}><label htmlFor={`note-${referral.id}`}>Prüfvermerk</label><input id={`note-${referral.id}`} className="ow-input" value={notes[referral.id] ?? ""} onChange={event => setNotes(current => ({ ...current, [referral.id]: event.target.value }))} minLength={10} maxLength={240} placeholder="Grund für die Ablehnung" /></div>
                      <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" disabled={reviewing === referral.id || (notes[referral.id] ?? "").trim().length < 10} onClick={() => void review(referral, "reject")}>{reviewing === referral.id ? "Speichert …" : "Empfehlung ablehnen"}</button>
                    </>}
                </div>
              )}
            </li>))}</ul>
        ))}
      </section>}
    </div>
  );
}
