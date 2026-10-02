import type { ReactNode } from "react";
import { redirect } from "next/navigation";

// Pilot: while public registration is disabled (production), the sign-up page is not offered; accounts are set up by Loynara.
// Read per request so it follows the live PUBLIC_REGISTRATION_ENABLED setting.
export const dynamic = "force-dynamic";

export default function RegisterLayout({ children }: { children: ReactNode }) {
  if (process.env.PUBLIC_REGISTRATION_ENABLED !== "true") redirect("/login");
  return children;
}
