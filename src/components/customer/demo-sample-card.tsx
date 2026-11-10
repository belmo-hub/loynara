import { AuthShell } from "@/components/ui/auth-shell";
import { SystemState } from "@/components/ui/system-state";
import { BrowserCardPreview } from "@/components/owner/card-preview";
import "@/components/owner/owner.css";

/** The demo plate while no demo runs: the state first, then a sample card as an illustration only (no code, no number). */
export function DemoSampleCard() {
  return <AuthShell>
    <SystemState title="Gerade läuft keine Demo." />
    <div className="owner-app ly-theme-auto" aria-hidden="true">
      <BrowserCardPreview businessName="Dein Geschäft" locationName="" brandColor="#1F4A3A" programType="stamp" rewardTitle="Kaffee aufs Haus" rewardCost={10} balance={3} showCode={false} />
    </div>
  </AuthShell>;
}
