import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import type { OwnerRole } from "@/components/owner/nav";
import { OwnerProvider } from "@/components/owner/owner-context";
import { OwnerShell } from "@/components/owner/owner-shell";
import { VerifyEmailNotice } from "@/components/owner/verify-email-notice";
import { db } from "@/db";
import { staffRoles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hiddenSurfaces } from "@/lib/pilot-surfaces";
import "@/components/owner/owner.css";

// Read per request: which surfaces exist follows the live deployment (see lib/pilot-surfaces), not the build.
export const dynamic = "force-dynamic";

// Display only, for the first paint before /api/me answers (ENG-184): every API route still checks the role itself.
// The unconfirmed address is display only too: owner mail checks the account itself when it is sent (ENG-278).
async function viewer(): Promise<{ role?: OwnerRole; unconfirmed?: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const [staff] = await db.select({ role: staffRoles.role }).from(staffRoles).where(eq(staffRoles.userId, session.user.id)).limit(1);
  return { role: staff?.role as OwnerRole | undefined, unconfirmed: session.user.emailVerified ? undefined : session.user.email };
}

export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const { role, unconfirmed } = await viewer().catch(() => ({ role: undefined, unconfirmed: undefined }));
  return <div className="owner-app ly-theme-auto"><OwnerProvider hiddenSurfaces={hiddenSurfaces()} role={role}><OwnerShell>{unconfirmed && <VerifyEmailNotice email={unconfirmed} />}{children}</OwnerShell></OwnerProvider></div>;
}
