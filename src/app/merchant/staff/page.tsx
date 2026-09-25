"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiJson, ClientApiError, postJson, type MeResponse } from "@/components/client-api";
import { BrandMark, Icon } from "@/components/loyalty-ui";

type StaffMember = { userId: string; email?: string; role: "owner" | "manager" | "cashier"; locationId: string | null; active: boolean };
type InviteResult = { token: string; expiresAt: string; email: string; role: "manager" | "cashier" };

export default function StaffPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "cashier">("cashier");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<StaffMember | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const current = await apiJson<MeResponse>("/api/me");
      if (current.role !== "owner") throw new ClientApiError(403, "Nur Inhaberinnen und Inhaber können Teamzugänge verwalten.");
      const result = await apiJson<{ staff: StaffMember[] }>("/api/staff");
      setMe(current); setStaff(result.staff); setLoading(false);
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      setError(cause instanceof Error ? cause.message : "Team konnte nicht geladen werden."); setLoading(false);
    }
  }, [router]);
  useEffect(() => {
    let active = true;
    void apiJson<MeResponse>("/api/me").then(async current => {
      if (!active) return;
      if (current.role !== "owner") throw new ClientApiError(403, "Nur Inhaberinnen und Inhaber können Teamzugänge verwalten.");
      const result = await apiJson<{ staff: StaffMember[] }>("/api/staff");
      if (active) { setMe(current); setStaff(result.staff); setLoading(false); }
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      setError(cause instanceof Error ? cause.message : "Team konnte nicht geladen werden."); setLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me?.locationId) return;
    setBusy(true); setError(""); setMessage(""); setInvite(null);
    try {
      const result = await postJson<InviteResult>("/api/staff/invite", { locationId: me.locationId, email: email.trim(), role });
      setInvite(result); setEmail("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Einladung konnte nicht erstellt werden."); }
    finally { setBusy(false); }
  }

  async function revoke() {
    if (!revokeTarget) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await postJson("/api/staff/revoke", { userId: revokeTarget.userId });
      setStaff(current => current.map(item => item.userId === revokeTarget.userId ? { ...item, active: false } : item));
      setMessage("Der Teamzugang wurde gesperrt."); setRevokeTarget(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Zugang konnte nicht gesperrt werden."); setRevokeTarget(null); }
    finally { setBusy(false); }
  }

  const inviteUrl = invite && me?.publicBaseUrl ? new URL(`/invite/${encodeURIComponent(invite.token)}`, me.publicBaseUrl).toString() : "";
  return <div className="app-page"><header className="app-header"><div className="app-header-inner"><Link href="/merchant"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link><Link href="/merchant/staff">Team</Link><Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Team</span></div></header><main className="app-container staff-view"><div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> ZUGÄNGE VERWALTEN</span><h1>Das Team am Tresen.</h1><p>Gib jeder Person einen eigenen Zugang und sperre ihn bei Bedarf.</p></div>{loading ? <div className="app-panel staff-loading">Team wird geladen …</div> : error && !me ? <div className="app-panel"><p className="auth-error" role="alert">{error}</p><button type="button" className="button button--outline" onClick={() => void load()}>Erneut versuchen</button></div> : <div className="staff-grid"><section className="app-panel"><div className="panel-head"><span className="step-number"><Icon name="mail" size={18} /></span><div><h2>Person einladen</h2><p>Der Link wird einmalig angezeigt und nicht automatisch versendet.</p></div></div><form className="staff-form" onSubmit={createInvite}><label>E-Mail-Adresse<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required placeholder="team@geschaeft.de" /></label><label>Rolle<select value={role} onChange={e => setRole(e.target.value as "manager" | "cashier")}><option value="cashier">Kasse · Buchungen</option><option value="manager">Leitung · Berichte & Kasse</option></select></label><button type="submit" className="button button--ink" disabled={busy}>Einladungslink erstellen <Icon name="arrow" size={17} /></button></form>{invite && <div className="invite-result" role="status"><strong>Einladung für {invite.email}</strong><p>Dieser Link gilt bis {new Date(invite.expiresAt).toLocaleDateString("de-DE")}. Teile ihn nur mit der eingeladenen Person.</p><code>{inviteUrl}</code><button type="button" className="button button--outline" onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); setMessage("Link kopiert. Er wurde nicht versendet."); } catch { setError("Kopieren nicht möglich. Bitte markiere den Link manuell."); } }}>Link kopieren</button></div>}</section><section className="app-panel"><div className="panel-head"><span className="step-number"><Icon name="shield" size={18} /></span><div><h2>Aktuelle Zugänge</h2><p>Gesperrte Teammitglieder können nicht mehr buchen.</p></div></div><div className="staff-list">{staff.map(item => <div className="staff-row" key={item.userId}><span className="staff-avatar">{(item.email || "?").slice(0, 1).toUpperCase()}</span><span className="staff-details"><strong>{item.email || "E-Mail nicht verfügbar"}</strong><small>{item.role === "owner" ? "Inhaber/in" : item.role === "manager" ? "Leitung" : "Kasse"} · {item.active ? "Aktiv" : "Gesperrt"}</small></span>{item.role !== "owner" && item.active && <button type="button" className="staff-revoke" onClick={() => setRevokeTarget(item)}>Sperren</button>}</div>)}</div></section></div>}{error && me && <p className="auth-error" role="alert">{error}</p>}{message && <p className="inline-message inline-message--success" role="status">{message}</p>}</main>{revokeTarget && <div className="confirm-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setRevokeTarget(null); }}><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="revoke-title"><span className="confirm-icon"><Icon name="shield" size={25} /></span><h2 id="revoke-title">Zugang sperren?</h2><p>{revokeTarget.email} verliert den Zugriff auf den Standort und kann keine neuen Buchungen mehr ausführen.</p><div className="confirm-actions"><button type="button" className="button button--outline" onClick={() => setRevokeTarget(null)}>Abbrechen</button><button type="button" className="button button--ink" onClick={revoke} disabled={busy}>{busy ? "Wird gesperrt …" : "Zugang sperren"}</button></div></div></div>}</div>;
}
