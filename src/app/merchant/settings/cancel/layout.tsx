import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { surfaceHidden } from "@/lib/pilot-surfaces";

// Read per request: withheld on real production until Legal's gate, like the request it sends (see lib/pilot-surfaces).
export const dynamic = "force-dynamic";

export default function CancelLayout({ children }: { children: ReactNode }) {
  if (surfaceHidden("cancellation")) notFound();
  return children;
}
