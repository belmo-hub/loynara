"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CashierShell } from "@/components/ui/cashier-shell";
import { SystemState } from "@/components/ui/system-state";

// Dark like the counter. After a crash the last booking may or may not have gone through, so the copy asks to check first.
export default function CashierError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <CashierShell lang="de" live={false} location="Kasse" state="error" stateLabel="Kasse angehalten">
    <SystemState icon={<CircleAlert size={26} />} title="Die Kasse hat nicht geladen." reference={error.digest}
      actions={<><Button size="lg" onClick={() => retry()}>Kasse neu laden</Button><Button size="lg" variant="secondary" onClick={() => window.location.reload()}>Seite neu laden</Button></>}>
      Lade die Kasse neu. Prüf danach den Stand der letzten Karte, bevor du noch einmal buchst.
    </SystemState>
  </CashierShell>;
}
