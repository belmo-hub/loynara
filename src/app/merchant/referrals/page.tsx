"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiJson, ClientApiError, postJson, type MeResponse } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";
import { ReferralSummary } from "@/components/owner/referral-summary";
import styles from "./referrals.module.css";

type Settings = { enabled: boolean; referrerBonus: number; referredBonus: number; programType: "stamp" | "points" };
type Referral = { id: string; status: string; referrerCard: string; referredCard: string; referrerBonus: number; referredBonus: number; reviewReason: string | null; hasCreditedBonus: boolean; createdAt: string; qualifiedAt: string | null };

function status(value: string) {
  switch (value) {
    case "pending": return "Wartet auf ersten Kassenauftrag";
    case "qualified": return "Bonus gebucht";
    case "review": return "Prüfung nötig";
    case "rejected": return "Abgelehnt";
    case "reversed": return "Bonus korrigiert";
    default: return value;
  }
}

function reviewReason(value: string | null) {
  switch (value) {
    case "same_verified_email": return "Beide Karten haben dieselbe verifizierte E-Mail-Adresse.";
    case "bonus_spent": return "Ein Bonus wurde bereits eingelöst oder ausgegeben.";
    case "owner_required": return "Die Korrektur überschreitet die Befugnis der Standortleitung.";
    case "member_unavailable": return "Eine der Karten ist nicht mehr verfügbar.";
    case "balance_limit": return "Ein Guthabenlimit würde überschritten.";
    default: return value ?? "";
  }
}

export default function MerchantReferralsPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [referrerBonus, setReferrerBonus] = useState("1");
  const [referredBonus, setReferredBonus] = useState("0");
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const account = await apiJson<MeResponse>("/api/me");
        if (!active) return;
        if (account.role !== "owner") { router.replace(account.role === "cashier" ? "/cashier" : "/merchant"); return; }
        if (!account.programSlug) throw new Error("Für diesen Standort ist kein aktives Programm vorhanden.");
        const slug = encodeURIComponent(account.programSlug);
        const [rule, list] = await Promise.all([
          apiJson<Settings>(`/api/merchant/referrals/settings?programSlug=${slug}`),
          apiJson<{ referrals: Referral[] }>(`/api/merchant/referrals?programSlug=${slug}`),
        ]);
        if (!active) return;
        setMe(account); setSettings(rule); setEnabled(rule.enabled);
        setReferrerBonus(String(rule.referrerBonus)); setReferredBonus(String(rule.referredBonus)); setReferrals(list.referrals);
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
        setError(cause instanceof Error ? cause.message : "Empfehlungen konnten nicht geladen werden.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [router]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me?.programSlug) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const rule = await postJson<Settings>("/api/merchant/referrals/settings", {
        programSlug: me.programSlug, enabled, referrerBonus: Number(referrerBonus), referredBonus: Number(referredBonus),
      });
      setSettings(rule); setNotice("Empfehlungsregel gespeichert. Änderungen gelten für neue Anmeldungen mit Empfehlungslink.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Die Regel konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  async function review(referral: Referral, action: "reject" | "retry_reversal") {
    setReviewing(referral.id); setError(""); setNotice("");
    try {
      const outcome = await postJson<{ status: string }>(`/api/merchant/referrals/${encodeURIComponent(referral.id)}/review`, action === "reject" ? { action, reason: (reviewNotes[referral.id] ?? "").trim() } : { action });
      const list = await apiJson<{ referrals: Referral[] }>(`/api/merchant/referrals?programSlug=${encodeURIComponent(me!.programSlug)}`);
      setReferrals(list.referrals);
      setReviewNotes(current => { const next = { ...current }; delete next[referral.id]; return next; });
      setNotice(outcome.status === "review" ? "Die Bonus-Korrektur ist noch nicht möglich. Der Vorgang bleibt zur Prüfung offen." : "Prüfentscheidung gespeichert.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Die Prüfung konnte nicht gespeichert werden."); }
    finally { setReviewing(null); }
  }

  const unit = settings?.programType === "points" ? "Punkte" : "Stempel";
  return <div className="app-page"><header className="app-header"><div className="app-header-inner"><Link href="/merchant" aria-label="Zur Übersicht"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link><Link href="/merchant/customers">Kundenkarten</Link><Link href="/merchant/referrals" aria-current="page">Empfehlungen</Link><Link href="/merchant/staff">Team</Link><Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Empfehlungen</span></div></header>
    <main className={`app-container ${styles.main}`}>
      <div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> WEITEREMPFEHLEN</span><h1>Empfehlungen</h1><p>Eine Empfehlung wird erst nach dem ersten bestätigten Kassenauftrag der neuen Karte gutgeschrieben.</p></div>
      {loading ? <p role="status">Empfehlungen werden geladen …</p> : !me || !settings ? <p role="alert" className={styles.error}>{error || "Empfehlungen nicht verfügbar."}</p> : <>
        {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
        <ReferralSummary enabled={settings.enabled} referrerBonus={settings.referrerBonus} referredBonus={settings.referredBonus} programType={settings.programType} referrals={referrals} truncated={referrals.length >= 100} />
        <div className={styles.grid}>
          <form className={`app-panel ${styles.panel}`} onSubmit={save}>
            <span className="tiny-label">{me.businessName} · {me.locationName}</span><h2>Bonusregel</h2>
            <label className={styles.check}><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Empfehlungen für neue Anmeldungen aktivieren</label>
            <div className={styles.fields}><label>Bonus für empfehlende Karte ({unit})<input type="number" min="0" max="1000" required value={referrerBonus} onChange={event => setReferrerBonus(event.target.value)} /></label><label>Bonus für neue Karte ({unit})<input type="number" min="0" max="1000" required value={referredBonus} onChange={event => setReferredBonus(event.target.value)} /></label></div>
            <p>Wenn die Regel aktiv ist, muss mindestens ein Bonus größer als null sein. Die Beträge werden bei der Anmeldung festgehalten; spätere Änderungen schreiben vorhandene Empfehlungen nicht um.</p>
            <button className="button button--ink" type="submit" disabled={busy}>{busy ? "Speichert …" : "Regel speichern"}</button>
          </form>
          <section className={`app-panel ${styles.panel}`}><span className="tiny-label">ABLAUF</span><h2>So funktioniert es</h2><ol><li>Eine Person teilt den Link ihrer Karte.</li><li>Eine neue Karte wird über diesen Link erstellt. Dafür gibt es noch keinen Bonus.</li><li>Ein berechtigter erster Kassenauftrag wird bestätigt. Dann werden beide konfigurierten Boni einmalig im Buchungsjournal erfasst.</li></ol><p>Gleiche verifizierte E-Mail-Adressen werden zur Prüfung angehalten. Pseudonyme Karten lassen sich nicht zuverlässig derselben Person zuordnen; Missbrauch kann daher nicht vollständig ausgeschlossen werden.</p></section>
        </div>
        <section className={`app-panel ${styles.history}`}><div className={styles.head}><div><span className="tiny-label">LETZTE 100 EMPFEHLUNGEN</span><h2>Vorgänge und Prüfung</h2></div><span>{referrals.length} angezeigt</span></div>
          {referrals.length === 0 ? <p>Noch keine Anmeldungen über Empfehlungslinks.</p> : <ul>{referrals.map(referral => <li key={referral.id}><div className={styles.row}><div><strong>{status(referral.status)}</strong><small>Karte {referral.referrerCard} → Karte {referral.referredCard}</small><small>Angemeldet: {new Date(referral.createdAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</small></div><div className={styles.bonus}>+{referral.referrerBonus} / +{referral.referredBonus} {unit}</div></div>{referral.reviewReason && <p className={styles.reviewReason}>{reviewReason(referral.reviewReason)}</p>}{referral.status === "review" && <div className={styles.actions}>{referral.hasCreditedBonus ? <button type="button" className="button button--outline" disabled={reviewing === referral.id} onClick={() => void review(referral, "retry_reversal")}>{reviewing === referral.id ? "Prüft …" : "Bonus-Korrektur erneut prüfen"}</button> : <><label>Prüfvermerk<input value={reviewNotes[referral.id] ?? ""} onChange={event => setReviewNotes(current => ({ ...current, [referral.id]: event.target.value }))} minLength={10} maxLength={240} placeholder="Grund für die Ablehnung" /></label><button type="button" className="button button--outline" disabled={reviewing === referral.id || (reviewNotes[referral.id] ?? "").trim().length < 10} onClick={() => void review(referral, "reject")}>{reviewing === referral.id ? "Speichert …" : "Empfehlung ablehnen"}</button></>}</div>}</li>)}</ul>}
        </section>
      </>}
    </main>
  </div>;
}
