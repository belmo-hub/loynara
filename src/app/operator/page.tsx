import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { OperatorClient } from "@/components/operator/operator-client";
import { auth } from "@/lib/auth";
import { DomainError } from "@/lib/loyalty";
import { operatorOverview } from "@/lib/operator";
import "@/components/owner/owner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operator", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Anyone but the operator (shop owner, guest, logged out) gets the ordinary 404: the page does not admit it exists.
export default async function OperatorPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();
  const data = await operatorOverview(session.user.id).catch(error => { if (error instanceof DomainError && error.code === "FORBIDDEN") return null; throw error; });
  if (!data) notFound();
  return <div className="owner-app ly-theme-auto"><OperatorClient {...data} /></div>;
}
