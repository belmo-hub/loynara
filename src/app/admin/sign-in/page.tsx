import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { verifyAccessAssertion } from "@/lib/admin/access";
import { SignInForm } from "@/components/admin/forms";
import { PageHead } from "@/components/owner/owner-ui";
export const dynamic = "force-dynamic";
export default async function SignInPage() {
  try { await verifyAccessAssertion((await headers()).get("cf-access-jwt-assertion")); } catch { notFound(); }
  return <main className="ow-page"><PageHead eyebrow="Loynara Konsole" title="Anmelden" lead="Melde dich mit deinem eigenen Konsolenkonto an." /><section className="ow-card"><SignInForm /></section></main>;
}
