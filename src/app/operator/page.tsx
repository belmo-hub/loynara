import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { OperatorClient } from "@/components/operator/operator-client";
import { auth } from "@/lib/auth";
import { demoStatus } from "@/lib/demo";
import { demoEnvironment } from "@/lib/demo-environment";
import { DomainError } from "@/lib/loyalty";
import { operatorOverview } from "@/lib/operator";
import { surfaceHidden } from "@/lib/pilot-surfaces";
import "@/components/owner/owner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operator", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Anyone but the operator (shop owner, guest, logged out) gets the ordinary 404: the page does not admit it exists.
export default async function OperatorPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();
  const data = await operatorOverview(session.user.id).catch(error => { if (error instanceof DomainError && error.code === "FORBIDDEN") return null; throw error; });
  if (!data) notFound();
  // Demo-Modus only in the demo environment (design v3); elsewhere the section does not exist.
  const demo = demoEnvironment() ? { running: await demoStatus() } : undefined;
  return <div className="owner-app ly-theme-auto"><OperatorClient {...data} demo={demo} placeSearch={!surfaceHidden("shopSearch")} /></div>;
}
