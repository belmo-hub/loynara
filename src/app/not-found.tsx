import Link from "next/link";
import { Compass } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { buttonClassName } from "@/components/ui/button";
import { SystemState } from "@/components/ui/system-state";

// Most people who reach a dead link are guests with an old card link, so the first way out is finding the card again.
export default function NotFound() {
  return <AuthShell>
    <SystemState icon={<Compass size={26} />} title="Diese Seite gibt es nicht."
      actions={<><Link href="/recover" className={buttonClassName({ size: "lg" })}>Karte wiederfinden</Link><Link href="/login" className={buttonClassName({ size: "lg", variant: "quiet" })}>Anmeldung für Geschäfte</Link></>}>
      Prüf den Link auf Tippfehler. Suchst du deine Treuekarte? Mit deiner E-Mail-Adresse findest du sie wieder.
    </SystemState>
  </AuthShell>;
}
