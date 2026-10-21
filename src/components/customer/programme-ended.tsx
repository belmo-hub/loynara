import { Heart } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { SystemState } from "@/components/ui/system-state";
import { CustomerExportLink } from "@/components/customer-export-link";

/**
 * Shown instead of the card, join and tap pages once a programme has ended. Nothing is awarded here. The card page also
 * passes the shop and the card token: the balance stays hidden, but the data export (Art. 15 and 20 DSGVO) stays reachable.
 */
export function ProgrammeEnded({ shop, cardToken }: { shop?: string; cardToken?: string }) {
  return <AuthShell><SystemState icon={<Heart size={26} />} title="Dieses Programm ist beendet."
    actions={cardToken ? <CustomerExportLink url={`/api/card/${encodeURIComponent(cardToken)}/export`} locale="de">Daten herunterladen</CustomerExportLink> : undefined}>
    Danke für deine Treue.{shop ? ` Fragen zu offenen Stempeln oder Prämien? Wende dich an ${shop}.` : ""}
  </SystemState></AuthShell>;
}
