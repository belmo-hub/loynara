import { requireAdminPage } from "@/lib/admin/guard";
import { listAdmins } from "@/lib/admin/admins";
import { can } from "@/lib/admin/capabilities";
import { AdminShell } from "@/components/admin/admin-shell";
import { ResetFactorButton } from "@/components/admin/forms";
import { PageHead } from "@/components/owner/owner-ui";
export const dynamic = "force-dynamic";
const names = { founder: "Gründer", support: "Support", sales: "Vertrieb" };
export default async function TeamPage() {
  const ctx = await requireAdminPage("home.view", "/admin/team"); const manage = can(ctx.roles, "admins.reset_2fa");
  const admins = (await listAdmins()).filter(admin => manage || admin.userId === ctx.userId);
  return <AdminShell roles={ctx.roles}><PageHead title="Team" lead={manage ? "Konsolenzugänge und ihr Sicherheitsstatus." : "Dein Konsolenzugang und Sicherheitsstatus."} />{admins.map(admin => <section className="ow-card ow-stack" key={admin.userId}><h2 style={{ overflowWrap: "anywhere" }}>{admin.email}</h2><p>{admin.roles.map(role => names[role]).join(", ")}</p><p>Zweiter Faktor: {admin.hasSecondFactor ? "Eingerichtet" : "Einrichtung erforderlich"}</p><p className="ow-muted">Zuletzt aktiv: {admin.lastSeenAt ? admin.lastSeenAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) : "Noch keine Konsolensitzung"}</p>{manage && admin.userId !== ctx.userId && <ResetFactorButton userId={admin.userId} />}</section>)}</AdminShell>;
}
