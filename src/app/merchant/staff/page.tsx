"use client";

import { useRef, useState, type FormEvent } from "react";
import { postJson } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, germanDate, LoadingBlock, Notice, OwnerDialog, PageHead } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";
import { inviteCreateMessage, inviteRevokeMessage, staffRevokeMessage, unconfirmed } from "@/components/owner/owner-errors";
import { EmptyState } from "@/components/ui/empty-state";

type StaffMember = { userId: string; email?: string; role: "owner" | "manager" | "cashier"; locationId: string | null; active: boolean };
type InviteResult = { id: string; token: string; expiresAt: string; email: string; role: "manager" | "cashier" };
type Invitation = { id: string; email: string; role: "manager" | "cashier"; locationId: string; expiresAt: string; status: "pending" | "accepted" | "revoked" | "expired" };
const INVITATION_LABEL = { pending: "Offen", accepted: "Angenommen", revoked: "Widerrufen", expired: "Abgelaufen" } as const;
type AuditEvent = { id: string; inviteId?: string | null; action: "invite_created" | "invite_accepted" | "access_revoked"; actorUserId: string; subjectUserId: string | null; locationId: string | null; role: "manager" | "cashier"; createdAt: string };
const AUDIT_LABEL = { invite_created: "Einladung erstellt", invite_accepted: "Einladung angenommen", access_revoked: "Zugang gesperrt" } as const;
const ROLE_LABEL = { owner: "Inhaber:in", manager: "Leitung", cashier: "Kasse" } as const;
/** Mirrors the server checks (lib/loyalty, card-reissue, merchant-members, owner-only APIs); the server stays the authority. */
const PERMISSIONS: Array<[string, boolean, boolean]> = [
  ["Stempel oder Punkte vergeben und Prämien einlösen", true, true],
  ["Kundenkarten und ihren Verlauf ansehen", false, true],
  ["Fehlbuchungen korrigieren (bis 100 je Vorgang)", false, true],
  ["Verlorene Karte neu ausstellen", false, true],
  ["Sammelregeln und Prämien ansehen", false, true],
  ["Programm und Prämien ändern", false, false],
  ["Empfehlungen verwalten und Ergebnisse ansehen", false, false],
  ["Team einladen und sperren", false, false],
];
const ROLE_HINT = { cashier: "Bucht an der Kasse. Bis 10 Stempel je Vorgang, sieht keine Kundenliste und keine Zahlen.", manager: "Alles von Kasse, dazu Kundenkarten, Korrekturen und Neuausstellung für diesen Standort." } as const;

export default function StaffPage() {
  const { me, locations } = useOwner();
  const owner = me?.role === "owner";
  const [staff, reloadStaff] = useLoad<{ staff: StaffMember[]; invitations?: Invitation[]; accountCreation?: "public" | "invite" | "operator" }>(owner ? "/api/staff" : null);
  const [audit, reloadAudit] = useLoad<{ events: AuditEvent[] }>(owner ? "/api/staff/audit" : null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "cashier">("cashier");
  const inviteDraftRevision = useRef(0);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<StaffMember | null>(null);
  const [revokingTarget, setRevokingTarget] = useState<StaffMember | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invitation | null>(null);
  const [cancellingTarget, setCancellingTarget] = useState<Invitation | null>(null);
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
    const submitted = { email: email.trim(), role, revision: inviteDraftRevision.current };
    setBusy(true); setError(""); setMessage(""); setInvite(null);
    try {
      const result = await postJson<InviteResult>("/api/staff/invite", { locationId: me.locationId, email: submitted.email, role: submitted.role });
      setInvite(result);
      if (inviteDraftRevision.current === submitted.revision) setEmail("");
      reloadStaff(); reloadAudit();
    } catch (cause) {
      setError(inviteCreateMessage(cause, submitted.email));
      if (unconfirmed(cause)) reloadAudit();
    }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!revokeTarget || busy) return;
    const target = revokeTarget;
    setBusy(true); setRevokingTarget(target); setError(""); setMessage("");
    try {
      await postJson("/api/staff/revoke", { userId: target.userId });
      setMessage("Der Teamzugang wurde gesperrt."); setRevokeTarget(current => current === target ? null : current); reloadStaff(); reloadAudit();
    } catch (cause) {
      setError(staffRevokeMessage(cause)); setRevokeTarget(current => current === target ? null : current);
      if (unconfirmed(cause)) { reloadStaff(); reloadAudit(); }
    }
    finally { setBusy(false); setRevokingTarget(null); }
  }
  async function cancelInvitation() {
    if (!cancelTarget || busy) return;
    const target = cancelTarget;
    setBusy(true); setCancellingTarget(target); setError(""); setMessage("");
    try {
      const result = await postJson<{ inviteId: string; status: string }>("/api/staff/invite/revoke", { inviteId: target.id });
      if (result.inviteId !== target.id || result.status !== "revoked") {
        setError("Der Widerruf wurde nicht bestätigt. Prüfe den Einladungsstatus vor einem erneuten Versuch.");
        setCancelTarget(current => current === target ? null : current);
        return;
      }
      setMessage(`Die Einladung für ${target.email} wurde widerrufen.`);
      setInvite(current => current?.id === target.id ? null : current);
      setCancelTarget(current => current === target ? null : current);
    } catch (cause) {
      setError(inviteRevokeMessage(cause));
      setCancelTarget(current => current === target ? null : current);
    } finally { reloadStaff(); reloadAudit(); setBusy(false); setCancellingTarget(null); }
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
          <div><h2 id="st-invite">Person einladen</h2><p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Der Link wird einmalig angezeigt und nicht automatisch versendet. Zugriff gilt für {me.locationName}.</p></div>
          <form className="ow-stack" onSubmit={createInvite}>
            <div className="ow-field"><label htmlFor="st-email">E-Mail-Adresse</label><input id="st-email" className="ow-input" type="email" value={email} onChange={event => { inviteDraftRevision.current++; setEmail(event.target.value); }} autoComplete="email" required placeholder="team@geschaeft.de" /></div>
            <div className="ow-field"><label htmlFor="st-role">Rolle</label><select id="st-role" className="ow-select" value={role} onChange={event => { inviteDraftRevision.current++; setRole(event.target.value as "manager" | "cashier"); }}><option value="cashier">Kasse</option><option value="manager">Leitung</option></select><span className="ow-hint">{ROLE_HINT[role]}</span></div>
            <div><button type="submit" className="ow-btn ow-btn--primary" disabled={busy}>Einladungslink erstellen</button></div>
          </form>
          {invite && (
            <div className="ow-readonly ow-stack" role="status"><strong>Einladung für {invite.email}</strong>
              <p>Dieser Link gilt bis {new Date(invite.expiresAt).toLocaleDateString("de-DE")}. Teile ihn nur mit der eingeladenen Person.</p>
              {staff.state === "ok" && <p className="ow-hint">{staff.data.accountCreation === "operator" ? "Konten werden derzeit vom Loynara-Betreiber angelegt. Die Person nimmt die Einladung an, sobald ihr Konto für genau diese Adresse besteht." : staff.data.accountCreation === "invite" ? "Die Person legt über den Link ihr eigenes Konto für genau diese Adresse an und ist danach sofort an der Kasse." : "Die Person kann über den Link ein Konto erstellen und die Einladung annehmen."}</p>}
              <code style={{ overflowWrap: "anywhere", fontSize: "var(--text-14)" }}>{inviteUrl}</code>
              <div><button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => void copy()}>Link kopieren</button></div></div>
          )}
        </section>
        <section className="ow-card ow-stack" aria-labelledby="st-list">
          <div><h2 id="st-list">Aktuelle Zugänge</h2><p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Gesperrte Teammitglieder können nicht mehr buchen.</p></div>
          {staff.state === "loading" ? <LoadingBlock rows={2} height={48} /> : (
            <ul className="ow-feed">{people.map(item => (
              <li key={item.userId} style={item.active ? undefined : { opacity: .7 }}><span><strong>{item.email || "E-Mail nicht verfügbar"}</strong>{item.userId === me.userId && <span className="ow-muted"> (du)</span>}<br /><span className="ow-row" style={{ gap: 6, marginTop: 4 }}><span className={`ow-chip ${item.role === "owner" ? "ow-chip--ok" : item.role === "manager" ? "ow-chip--info" : ""}`}>{ROLE_LABEL[item.role]}</span><span className="ow-muted">{item.role === "owner" ? "Alle Standorte" : locations.find(location => location.id === item.locationId)?.name ?? "Standort"} · {item.active ? "Aktiv" : "Gesperrt"}</span></span></span>
                {item.role !== "owner" && item.active && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => setRevokeTarget({ ...item })}>Sperren</button>}</li>))}</ul>
          )}
        </section>
      </div>
      <section className="ow-card ow-stack" aria-labelledby="st-invitations">
        <div><h2 id="st-invitations">Einladungen</h2><p className="ow-muted">Offene Einladungen kannst du widerrufen.</p></div>
        {staff.state === "loading" && <LoadingBlock rows={1} height={48} />}
        {staff.state === "ok" && ((staff.data.invitations ?? []).length
          ? <ul className="ow-feed" aria-label="Einladungen">{staff.data.invitations!.map(item => <li key={item.id}>
              <span><strong>{item.email}</strong><br /><span className="ow-muted">{ROLE_LABEL[item.role]} · {locations.find(location => location.id === item.locationId)?.name ?? "Standort"} · {INVITATION_LABEL[item.status]} · Gültig bis {germanDate(item.expiresAt)}</span></span>
              {item.status === "pending" && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => setCancelTarget({ ...item })}>Widerrufen</button>}
            </li>)}</ul> : <EmptyState level={3} size="compact" title="Noch keine Einladungen.">Lade Mitarbeitende mit ihrer E-Mail-Adresse ein. Jede Person bekommt ein eigenes Konto für die Kasse.</EmptyState>)}
      </section>
      <section className="ow-card ow-stack" aria-labelledby="st-perm">
        <div><h2 id="st-perm">Wer darf was?</h2><p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Kasse und Leitung arbeiten nur an ihrem Standort.</p></div>
        <div className="ow-table-wrap"><table className="ow-perm">
          <thead><tr><th scope="col">Aufgabe</th><th scope="col">Kasse</th><th scope="col">Leitung</th><th scope="col">Inhaber:in</th></tr></thead>
          <tbody>{PERMISSIONS.map(([task, cashier, manager]) => <tr key={task}><th scope="row">{task}</th>{[cashier, manager, true].map((allowed, index) => <td key={index}>{allowed ? <span className="ow-perm-yes" aria-label="erlaubt">✓</span> : <span className="ow-perm-no" aria-label="nicht erlaubt">–</span>}</td>)}</tr>)}</tbody>
        </table></div>
      </section>
      <section className="ow-card ow-stack" aria-labelledby="staff-audit-title">
        <div><h2 id="staff-audit-title">Zugriffsverlauf</h2><p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Die letzten 50 Ereignisse. Ältere stehen im Export.</p></div>
        {audit.state === "error" && <ErrorNotice message={audit.message} onRetry={reloadAudit} />}
        {audit.state === "loading" && <LoadingBlock rows={1} height={48} />}
        {audit.state === "ok" && (audit.data.events.length
          ? <ol className="ow-feed" aria-label="Teamereignisse">{audit.data.events.map(event => <li key={event.id}><span><strong>{event.action === "access_revoked" && event.inviteId && !event.subjectUserId ? "Einladung widerrufen" : AUDIT_LABEL[event.action]}</strong><br /><span className="ow-muted">{ROLE_LABEL[event.role as keyof typeof ROLE_LABEL] ?? "Kasse"} · {event.subjectUserId ? userLabel(event.subjectUserId) : "Noch kein Teamkonto"} · durch {userLabel(event.actorUserId)}</span></span><time dateTime={event.createdAt}>{germanDate(event.createdAt, true)}</time></li>)}</ol>
          : <EmptyState level={3} size="compact" title="Noch keine Teamereignisse.">Frühere Vorgänge vor Einführung des Verlaufs sind nicht nachgetragen.</EmptyState>)}
      </section>
      {cancelTarget && <OwnerDialog title="Einladung widerrufen?" tone="danger" onClose={() => setCancelTarget(null)} actions={<><button type="button" className="ow-btn ow-btn--secondary" data-autofocus onClick={() => setCancelTarget(null)}>Abbrechen</button><button type="button" className="ow-btn ow-btn--danger" disabled={busy} onClick={() => void cancelInvitation()}>{cancellingTarget === cancelTarget ? "Wird widerrufen …" : "Einladung widerrufen"}</button></>}>
        <p>Der Einladungslink für {cancelTarget.email} kann danach keinen neuen Teamzugang mehr erteilen. Bereits angenommene Zugänge bleiben bestehen.</p>
      </OwnerDialog>}
      {revokeTarget && (
        <OwnerDialog title="Zugang sperren?" tone="danger" onClose={() => setRevokeTarget(null)} actions={<><button type="button" className="ow-btn ow-btn--secondary" data-autofocus onClick={() => setRevokeTarget(null)}>Abbrechen</button><button type="button" className="ow-btn ow-btn--danger" onClick={() => void revoke()} disabled={busy}>{revokingTarget === revokeTarget ? "Wird gesperrt …" : "Zugang sperren"}</button></>}>
          <p>{revokeTarget.email} verliert den Zugriff auf den Standort und kann keine neuen Buchungen mehr ausführen.</p>
        </OwnerDialog>
      )}
    </div>
  );
}
