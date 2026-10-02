import type { ReactNode } from "react";
import { OwnerProvider } from "@/components/owner/owner-context";
import { OwnerShell } from "@/components/owner/owner-shell";
import { hiddenSurfaces } from "@/lib/pilot-surfaces";
import "@/components/owner/owner.css";

// Read per request: which surfaces exist follows the live deployment (see lib/pilot-surfaces), not the build.
export const dynamic = "force-dynamic";

export default function MerchantLayout({ children }: { children: ReactNode }) {
  return <div className="owner-app"><OwnerProvider hiddenSurfaces={hiddenSurfaces()}><OwnerShell>{children}</OwnerShell></OwnerProvider></div>;
}
