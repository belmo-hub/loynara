import Link from "next/link";
import { listAdmins } from "@/lib/admin/admins";
import { AdminAuditEvent } from "@/components/admin/audit-event";
import { requireAdminPage } from "@/lib/admin/guard";
import { listAdminEvents, type AdminAction } from "@/lib/admin/audit";
import { can } from "@/lib/admin/capabilities";
import { AdminShell } from "@/components/admin/admin-shell";
import { PageHead } from "@/components/owner/owner-ui";
export const dynamic = "force-dynamic";
const labels: Record<AdminAction,string> = { "admin.session_started": "Sitzung gestartet", "admin.step_up": "Anmeldung erneut bestätigt", "admin.role_granted": "Rolle vergeben", "admin.role_revoked": "Rolle entzogen", "admin.two_factor_reset": "Zweiter Faktor zurückgesetzt" };
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; before?: string; cursor?: string }> }) {
  const ctx = await requireAdminPage("audit.view_own", "/admin/audit"), params = await searchParams;
  const action = params.action && Object.hasOwn(labels, params.action) ? params.action as AdminAction : undefined;
  const parsedBefore = params.before ? new Date(params.before) : undefined;
  const before = parsedBefore && Number.isFinite(parsedBefore.getTime()) ? parsedBefore : undefined;
  const events = await listAdminEvents({ viewerUserId: ctx.userId, viewAll: can(ctx.roles,"audit.view_all"), limit: 50, before, beforeId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.cursor ?? "") ? params.cursor : undefined, action });
  const identities = can(ctx.roles,"audit.view_all") ? Object.fromEntries((await listAdmins()).map(admin => [admin.userId, admin.email])) : { [ctx.userId]: ctx.email };
  const next = new URLSearchParams(); if (action) next.set("action", action); if (events.length) next.set("cursor", events.at(-1)!.id);
  return <AdminShell roles={ctx.roles}><PageHead title="Protokoll" lead={can(ctx.roles,"audit.view_all") ? "Alle Änderungen an den Konsolenzugängen." : "Deine Änderungen und Konsolensitzungen."} /><form className="ow-row" method="get" action="/admin/audit" style={{ flexWrap: "wrap" }}><label htmlFor="audit-action">Aktion</label><select className="ow-select" id="audit-action" name="action" defaultValue={action ?? ""} style={{ width: "auto", maxWidth: "100%" }}><option value="">Alle Aktionen</option>{Object.entries(labels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><button className="ow-btn ow-btn--secondary">Filtern</button></form>{events.length ? events.map(event => <AdminAuditEvent key={event.id} event={event} label={labels[event.action as AdminAction] ?? "Änderung"} identities={identities} />) : <section className="ow-card"><p>Für diese Auswahl sind noch keine Einträge vorhanden.</p></section>}{events.length === 50 && <Link className="ow-btn ow-btn--secondary" href={`/admin/audit?${next}`}>Ältere Einträge</Link>}</AdminShell>;
}
