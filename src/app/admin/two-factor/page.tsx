import { requireAdminEnrollmentPage } from "@/lib/admin/guard";
import { EnrollmentForm, AdminSignOut } from "@/components/admin/forms";
import { PageHead } from "@/components/owner/owner-ui";
export const dynamic = "force-dynamic";
export default async function TwoFactorPage() { await requireAdminEnrollmentPage(); return <main className="ow-page"><PageHead eyebrow="Loynara Konsole" title="Zweiten Faktor einrichten" lead="Schütze deinen Zugang mit einer Authenticator-App." actions={<AdminSignOut />} /><section className="ow-card"><EnrollmentForm /></section></main>; }
