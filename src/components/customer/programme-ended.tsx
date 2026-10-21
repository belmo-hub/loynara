import { Heart } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { SystemState } from "@/components/ui/system-state";

/** Shown instead of the card, join and tap pages once a programme has ended. Nothing is awarded here. */
export function ProgrammeEnded() {
  return <AuthShell><SystemState icon={<Heart size={26} />} title="Dieses Programm ist beendet.">Danke für deine Treue.</SystemState></AuthShell>;
}
