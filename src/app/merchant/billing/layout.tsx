import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { surfaceHidden } from "@/lib/pilot-surfaces";

// Read per request: whether this surface exists follows the live deployment, not the build (see lib/pilot-surfaces).
export const dynamic = "force-dynamic";

export default function BillingLayout({ children }: { children: ReactNode }) {
  if (surfaceHidden("billing")) notFound();
  return children;
}
