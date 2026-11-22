"use client";

import { History, Mail, Plus, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { postJson } from "@/components/client-api";
import { MORE_HREF } from "@/components/owner/nav";
import { useOwner } from "@/components/owner/owner-context";
import { inviteRevokeMessage, staffRevokeMessage, unconfirmed } from "@/components/owner/owner-errors";
import { Band, Confirm, MoreLabel, PageTitle, Row, Rows } from "@/components/owner/owner-rows";
import { ErrorNotice, germanDate, LoadingBlock, Notice } from "@/components/owner/owner-ui";
import { useReview } from "@/components/owner/question-form";
import { INVITATION_LABEL, PermissionTable, ROLE_LABEL, type Invitation, type StaffMember } from "@/components/owner/staff-data";
import { useLoad } from "@/components/owner/use-load";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet } from "@/components/ui/sheet";

type AuditEvent = { id: string; inviteId?: string | null; action: "invite_created" | "invite_accepted" | "access_revoked"; actorUserId: string; subjectUserId: string | null; locationId: string | null; role: "manager" | "cashier"; createdAt: string };
/** An e-mail title may break after its „@“, never inside a word (Design FIX 1); the domain moves whole (.ow-mail-domain). */
const breakAfterAt = (email: string) => { const at = email.indexOf("@"); return at < 0 ? email : <>{email.slice(0, at + 1)}<wbr /><span className="ow-mail-domain">{email.slice(at + 1)}</span></>; };
const AUDIT_LABEL = { invite_created: "Einladung erstellt", invite_accepted: "Einladung angenommen", access_revoked: "Zugang gesperrt" } as const;
/**
 * Team (ENG-122c, screen 15): „Person einladen“ as the band, access and invitations as rows; a row that can be blocked or
 * withdrawn opens its confirmation as a step of this page, so Back returns to the list. Roles and history open in sheets.
 */
export default function StaffPage() {
  const { me, locations } = useOwner();
  const owner = me?.role === "owner";
  const [staff, reloadStaff] = useLoad<{ staff: StaffMember[]; invitations?: Invitation[] }>(owner ? "/api/staff" : null);
  const [audit, reloadAudit] = useLoad<{ events: AuditEvent[] }>(owner ? "/api/staff/audit" : null);
  const step = useReview<string>();
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<"roles" | "history" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  if (!me) return null;
  const head = <PageTitle back={{ href: MORE_HREF, label: <MoreLabel /> }} title="Team" lead="Gib jeder Person einen eigenen Zugang und sperre ihn bei Bedarf." />;
  if (!owner) return <div className="ow-page">{head}<Notice>Nur die Inhaberin oder der Inhaber kann Teamzugänge verwalten.</Notice></div>;
  if (staff.state === "error") return <div className="ow-page">{head}<ErrorNotice message={staff.message} onRetry={reloadStaff} /></div>;

  const people = staff.state === "ok" ? staff.data.staff : [];
  const invitations = staff.state === "ok" ? staff.data.invitations ?? [] : [];
  const userLabel = (userId: string) => people.find(item => item.userId === userId)?.email ?? `Konto ${userId.slice(0, 8)}`;
  const placeOf = (locationId: string | null) => locations.find(location => location.id === locationId)?.name ?? "Standort";
  const revokeTarget = step.step?.startsWith("revoke:") ? people.find(item => `revoke:${item.userId}` === step.step) : undefined;
  const cancelTarget = step.step?.startsWith("cancel:") ? invitations.find(item => `cancel:${item.id}` === step.step) : undefined;
  const open = (next: string) => { setError(""); setMessage(""); step.open(next); };

  async function revoke(target: StaffMember) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await postJson("/api/staff/revoke", { userId: target.userId }); setMessage("Der Teamzugang wurde gesperrt."); reloadStaff(); reloadAudit(); }
    catch (cause) { setError(staffRevokeMessage(cause)); if (unconfirmed(cause)) { reloadStaff(); reloadAudit(); } }
    finally { setBusy(false); step.leave(`revoke:${target.userId}`); }
  }
  async function cancelInvitation(target: Invitation) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await postJson<{ inviteId: string; status: string }>("/api/staff/invite/revoke", { inviteId: target.id });
      if (result.inviteId !== target.id || result.status !== "revoked") setError("Der Widerruf wurde nicht bestätigt. Prüfe den Einladungsstatus vor einem erneuten Versuch.");
      else setMessage(`Die Einladung für ${target.email} wurde widerrufen.`);
    } catch (cause) { setError(inviteRevokeMessage(cause)); }
    finally { reloadStaff(); reloadAudit(); setBusy(false); step.leave(`cancel:${target.id}`); }
  }

  if (revokeTarget) return (
    <Confirm title="Zugang sperren?" back="Team" action="Zugang sperren" busyAction="Wird gesperrt …" busy={busy} onConfirm={() => void revoke(revokeTarget)} onCancel={step.back}>
      <div className="ow-qpanel"><p>{revokeTarget.email} verliert den Zugriff auf den Standort und kann keine neuen Buchungen mehr ausführen.</p></div>
    </Confirm>
  );
  if (cancelTarget) return (
    <Confirm title="Einladung widerrufen?" back="Team" action="Einladung widerrufen" busyAction="Wird widerrufen …" busy={busy} onConfirm={() => void cancelInvitation(cancelTarget)} onCancel={step.back}>
      <div className="ow-qpanel"><p>Der Einladungslink für {cancelTarget.email} kann danach keinen neuen Teamzugang mehr erteilen. Bereits angenommene Zugänge bleiben bestehen.</p></div>
    </Confirm>
  );

  const closeSheet = () => setSheet(null);
  return (
    <div className="ow-page">
      {head}
      {error && <ErrorNotice message={error} />}
      {message && <div role="status"><Notice tone="ok">{message}</Notice></div>}
      <div className="ow-prog">
        <Band icon={Plus} title="Person einladen" sub="Jede Person bekommt ein eigenes Konto für die Kasse." href="/merchant/staff/invite" />
        {staff.state === "loading" ? <LoadingBlock rows={2} height={64} /> : <>
          <Rows title="Aktuelle Zugänge" note="Gesperrte Teammitglieder können nicht mehr buchen.">
            {people.map(item => <Row key={item.userId} icon={Users} title={<>{item.email ? breakAfterAt(item.email) : "E-Mail nicht verfügbar"}{item.userId === me.userId && <span className="ow-muted"> (du)</span>}</>}
              sub={`${ROLE_LABEL[item.role]} · ${item.role === "owner" ? "Alle Standorte" : placeOf(item.locationId)} · ${item.active ? "Aktiv" : "Gesperrt"}`}
              {...(item.role !== "owner" && item.active ? { onClick: () => open(`revoke:${item.userId}`) } : {})} />)}
          </Rows>
          {/* R16: the invitation's sub-line names role, location and state (copy-rest R16 FINAL). */}
          <Rows title="Einladungen" note={invitations.some(item => item.status === "pending") ? "Offene Einladungen kannst du widerrufen." : undefined}>
            {invitations.length ? invitations.map(item => <Row key={item.id} icon={Mail} title={breakAfterAt(item.email)} sub={`${ROLE_LABEL[item.role]} · ${placeOf(item.locationId)} · ${INVITATION_LABEL[item.status]}`}
              {...(item.status === "pending" ? { onClick: () => open(`cancel:${item.id}`) } : {})} />)
              : <EmptyState key="none" level={3} size="compact" title="Noch keine Einladungen">Lade Mitarbeitende mit ihrer E-Mail-Adresse ein. Jede Person bekommt ein eigenes Konto für die Kasse.</EmptyState>}
          </Rows>
        </>}
        {/* „Rollen“: copy-rest R16 FINAL. */}
        <Rows title="Rollen">
          <Row key="roles" icon={ShieldCheck} title="Wer darf was?" sub="Kasse und Leitung arbeiten nur an ihrem Standort." onClick={() => setSheet("roles")} />
          <Row key="history" icon={History} title="Zugriffsverlauf" sub="Die letzten 50 Ereignisse. Ältere stehen im Export." onClick={() => setSheet("history")} />
        </Rows>
      </div>
      <Sheet open={sheet === "roles"} onClose={closeSheet} title="Wer darf was?" footer={<Button variant="secondary" block onClick={closeSheet}>Schließen</Button>}><PermissionTable /></Sheet>
      <Sheet open={sheet === "history"} onClose={closeSheet} title="Zugriffsverlauf" footer={<Button variant="secondary" block onClick={closeSheet}>Schließen</Button>}>
        {audit.state === "error" && <ErrorNotice message={audit.message} onRetry={reloadAudit} />}
        {audit.state === "loading" && <LoadingBlock rows={1} height={48} />}
        {audit.state === "ok" && (audit.data.events.length
          ? <ol className="ow-feed" aria-label="Teamereignisse">{audit.data.events.map(event => <li key={event.id}><span><strong>{event.action === "access_revoked" && event.inviteId && !event.subjectUserId ? "Einladung widerrufen" : AUDIT_LABEL[event.action]}</strong><br /><span className="ow-muted">{ROLE_LABEL[event.role as keyof typeof ROLE_LABEL] ?? "Kasse"} · {event.subjectUserId ? userLabel(event.subjectUserId) : "Noch kein Teamkonto"} · durch {userLabel(event.actorUserId)}</span></span><time dateTime={event.createdAt}>{germanDate(event.createdAt, "feed")}</time></li>)}</ol>
          : <EmptyState level={3} size="compact" title="Noch keine Teamereignisse.">Frühere Vorgänge vor Einführung des Verlaufs sind nicht nachgetragen.</EmptyState>)}
      </Sheet>
    </div>
  );
}
