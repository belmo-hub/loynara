"use client";

import { useState, type FormEvent } from "react";
import { postJson } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, germanDate, LoadingBlock, Notice, OwnerDialog, PageHead } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

type StaffMember = { userId: string; email?: string; role: "owner" | "manager" | "cashier"; locationId: string | null; active: boolean };
type InviteResult = { token: string; expiresAt: string; email: string; role: "manager" | "cashier" };
type AuditEvent = { id: string; action: "invite_created" | "invite_accepted" | "access_revoked"; actorUserId: string; subjectUserId: string | null; locationId: string | null; role: "manager" | "cashier"; createdAt: string };
const AUDIT_LABEL = { invite_created: "Einladung erstellt", invite_accepted: "Einladung angenommen", access_revoked: "Zugang gesperrt" } as const;
const ROLE_LABEL = { owner: "Inhaber:in", manager: "Leitung", cashier: "Kasse" } as const;

export default function StaffPage() {
  const { me } = useOwner();
  const owner = me?.role === "owner";
  const [staff, reloadStaff] = useLoad<{ staff: StaffMember[] }>(owner ? "/api/staff" : null);
  const [audit, reloadAudit] = useLoad<{ events: AuditEvent[] }>(owner ? "/api/staff/audit" : null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "cashier">("cashier");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<StaffMember | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useDirtyGuard("staff-invite", email.trim().length > 0);
  if (!me) return null;
  const head = <PageHead eyebrow="Einstellungen · Team" title="Das Team am Tresen." lead="Gib jeder Person einen eigenen Zugang und sperre ihn bei Bedarf." />;
  if (!owner) return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur Inhaber:innen können Teamzugänge verwalten.</Notice></div>;
  if (staff.state === "error") return <div className="ow-page">{head}<ErrorNotice message={staff.message} onRetry={reloadStaff} /></div>;

  const inviteUrl = invite && me.publicBaseUrl ? new URL(`/invite/${encodeURIComponent(invite.token)}`, me.publicBaseUrl).toString() : "";
  const people = staff.state === "ok" ? staff.data.staff : [];
  const userLabel = (userId: string) => people.find(item => item.userId === userId)?.email ?? `Konto ${userId.slice(0, 8)}`;

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me?.locationId || busy) return;
    setBusy(true); setError(""); setMessage(""); setInvite(null);
    try {
      const result = await postJson<InviteResult>("/api/staff/invite", { locationId: me.locationId, email: email.trim(), role });
      setInvite(result); setEmail(""); reloadAudit();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Einladung konnte nicht erstellt werden."); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setBusy(true); setError(""); setMessage("");
    try {
      await postJson("/api/staff/revoke", { userId: target.userId });
      setMessage("Der Teamzugang wurde gesperrt."); setRevokeTarget(null); reloadStaff(); reloadAudit();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Zugang konnte nicht gesperrt werden."); setRevokeTarget(null); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(inviteUrl); setMessage("Link kopiert. Er wurde nicht versendet."); setError(""); }
    catch { setError("Kopieren nicht möglich. Bitte markiere den Link manuell."); }
  }

  return (
    <div className="ow-page">
      {head}
      {error && <ErrorNotice message={error} />}
      {message && <div role="status"><Notice tone="ok">{message}</Notice></div>}
      <div className="ow-two" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <section className="ow-card ow-stack" aria-labelledby="st-invite">
          <div><h2 id="st-invite">Person einladen</h2><p className="ow-muted" style={{ fontSize: 14 }}>Der Link wird einmalig angezeigt und nicht automatisch versendet. Zugriff gilt für {me.locationName}.</p></div>
          <form className="ow-stack" onSubmit={createInvite}>
            <div className="ow-field"><label htmlFor="st-email">E-Mail-Adresse</label><input id="st-email" className="ow-input" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required placeholder="team@geschaeft.de" /></div>
            <div className="ow-field"><label htmlFor="st-role">Rolle</label><select id="st-role" className="ow-select" value={role} onChange={event => setRole(event.target.value as "manager" | "cashier")}><option value="cashier">Kasse · Buchungen</option><option value="manager">Leitung · Berichte & Kasse</option></select></div>
            <div><button type="submit" className="ow-btn ow-btn--primary" disabled={busy}>Einladungslink erstellen</button></div>
          </form>
          {invite && (
            <div className="ow-readonly ow-stack" role="status"><strong>Einladung für {invite.email}</strong>
              <p>Dieser Link gilt bis {new Date(invite.expiresAt).toLocaleDateString("de-DE")}. Teile ihn nur mit der eingeladenen Person.</p>
              <code style={{ overflowWrap: "anywhere", fontSize: 13 }}>{inviteUrl}</code>
              <div><button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => void copy()}>Link kopieren</button></div></div>
          )}
        </section>
        <section className="ow-card ow-stack" aria-labelledby="st-list">
          <div><h2 id="st-list">Aktuelle Zugänge</h2><p className="ow-muted" style={{ fontSize: 14 }}>Gesperrte Teammitglieder können nicht mehr buchen.</p></div>
          {staff.state === "loading" ? <LoadingBlock rows={2} height={48} /> : (
            <ul className="ow-feed">{people.map(item => (
              <li key={item.userId}><span><strong>{item.email || "E-Mail nicht verfügbar"}</strong><br /><span className="ow-muted" style={{ fontSize: 13 }}>{ROLE_LABEL[item.role]} · {item.active ? "Aktiv" : "Gesperrt"}</span></span>
                {item.role !== "owner" && item.active && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => setRevokeTarget(item)}>Sperren</button>}</li>))}</ul>
          )}
        </section>
      </div>
      <section className="ow-card ow-stack" aria-labelledby="staff-audit-title">
        <div><h2 id="staff-audit-title">Zugriffsverlauf</h2><p className="ow-muted" style={{ fontSize: 14 }}>Die letzten 50 Teamereignisse dieses Betriebs. Ältere Einträge stehen im Inhaberexport; eine Aufbewahrungsfrist ist noch nicht festgelegt.</p></div>
        {audit.state === "error" && <ErrorNotice message={audit.message} onRetry={reloadAudit} />}
        {audit.state === "loading" && <LoadingBlock rows={1} height={48} />}
        {audit.state === "ok" && (audit.data.events.length
          ? <ol className="ow-feed" aria-label="Teamereignisse">{audit.data.events.map(event => <li key={event.id}><span><strong>{AUDIT_LABEL[event.action]}</strong><br /><span className="ow-muted" style={{ fontSize: 13 }}>{event.role === "manager" ? "Leitung" : "Kasse"} · {event.subjectUserId ? userLabel(event.subjectUserId) : "Noch kein Teamkonto"} · durch {userLabel(event.actorUserId)}</span></span><time dateTime={event.createdAt}>{germanDate(event.createdAt, true)}</time></li>)}</ol>
          : <p className="ow-muted">Noch keine Teamereignisse erfasst. Frühere Vorgänge vor Einführung des Verlaufs sind nicht nachgetragen.</p>)}
      </section>
      {revokeTarget && (
        <OwnerDialog title="Zugang sperren?" tone="danger" onClose={() => setRevokeTarget(null)} actions={<><button type="button" className="ow-btn ow-btn--secondary" data-autofocus onClick={() => setRevokeTarget(null)}>Abbrechen</button><button type="button" className="ow-btn ow-btn--danger" onClick={() => void revoke()} disabled={busy}>{busy ? "Wird gesperrt …" : "Zugang sperren"}</button></>}>
          <p>{revokeTarget.email} verliert den Zugriff auf den Standort und kann keine neuen Buchungen mehr ausführen.</p>
        </OwnerDialog>
      )}
    </div>
  );
}
