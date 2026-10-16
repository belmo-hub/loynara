import { requireAdminPage } from "@/lib/admin/guard";
import { StepUpForm } from "@/components/admin/forms";
import { sanitizeAdminNext } from "@/components/admin/paths";
import { AdminShell } from "@/components/admin/admin-shell";
import { PageHead } from "@/components/owner/owner-ui";
export const dynamic = "force-dynamic";
export default async function StepUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) { const ctx = await requireAdminPage("home.view", "/admin/step-up"); const next = sanitizeAdminNext((await searchParams).next); return <AdminShell roles={ctx.roles}><PageHead title="Anmeldung erneut bestätigen" lead="Diese Bestätigung gilt fünf Minuten und nur in diesem Browser." /><section className="ow-card"><StepUpForm next={next} /></section></AdminShell>; }
