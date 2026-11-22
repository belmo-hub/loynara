"use client";

import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/button";
import { SystemState } from "@/components/ui/system-state";

// Inside the owner shell: navigation stays usable, only this area failed.
export default function MerchantError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <div className="ow-page">
    <SystemState error title="Dieser Bereich hat nicht geladen." reference={error.digest}
      actions={<><Button className="ow-state-btn" onClick={() => retry()}>Noch einmal versuchen</Button><Link href="/merchant" className={buttonClassName({ variant: "secondary" }, "ow-state-btn")}>Zur Übersicht</Link></>}>
      Versuch es noch einmal. Änderungen, die du auf dieser Seite noch nicht gespeichert hattest, sind dabei eventuell verloren.
    </SystemState>
  </div>;
}
