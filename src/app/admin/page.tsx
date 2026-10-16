import { requireAdminPage } from "@/lib/admin/guard";
import { AdminShell } from "@/components/admin/admin-shell";
import { PageHead } from "@/components/owner/owner-ui";
export const dynamic = "force-dynamic";
const names = { founder: "Gründer", support: "Support", sales: "Vertrieb" };
export default async function AdminPage() { const ctx = await requireAdminPage("home.view"); return <AdminShell roles={ctx.roles}><PageHead eyebrow="Loynara Konsole" title="Willkommen" lead="Team und Änderungen sicher im Blick behalten." /><section className="ow-card ow-stack"><h2>Dein Zugang</h2><p>{ctx.email}</p><p>Rollen: {ctx.roles.map(role => names[role]).join(", ")}</p><p className="ow-muted">Im Team findest du die Zugänge. Das Protokoll zeigt die für dich sichtbaren Änderungen.</p></section></AdminShell>; }
