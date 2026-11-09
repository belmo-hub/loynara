import { AuthShell } from "@/components/ui/auth-shell";
import { BrowserCardPreview } from "@/components/owner/card-preview";
import "@/components/owner/owner.css";

/** The demo plate while no demo runs: a sample card, nothing behind it. */
export function DemoSampleCard() {
  return <AuthShell><div className="owner-app ly-theme-auto ow-stack">
    <BrowserCardPreview businessName="Dein Geschäft" locationName="" brandColor="#1F4A3A" programType="stamp" rewardTitle="" rewardCost={8} balance={3} />
    <p>Gerade läuft keine Demo.</p>
  </div></AuthShell>;
}
