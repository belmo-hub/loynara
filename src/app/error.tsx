"use client";

import { CircleAlert } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { Button } from "@/components/ui/button";
import { SystemState } from "@/components/ui/system-state";

// Guests and owners both land here, so the way back never assumes an account. The error text itself is never shown.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <AuthShell>
    <SystemState icon={<CircleAlert size={26} />} title="Diese Seite hat nicht geladen." reference={error.digest}
      actions={<><Button size="lg" onClick={() => retry()}>Noch einmal versuchen</Button><Button size="lg" variant="secondary" onClick={() => window.location.reload()}>Seite neu laden</Button></>}>
      Versuch es noch einmal. Klappt es dann immer noch nicht, schreib uns und nenne den Fehlercode.
    </SystemState>
  </AuthShell>;
}
