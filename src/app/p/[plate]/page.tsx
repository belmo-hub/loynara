import { redirect } from "next/navigation";
import { Nfc } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { SystemState } from "@/components/ui/system-state";
import { ProgrammeEnded } from "@/components/customer/programme-ended";
import { plateJoinPath } from "@/lib/plates";
import { programmeEnded } from "@/lib/programme-end";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

// The plate's QR sticker. It has no signature, so it only leads to the shop's public join page, like the counter QR:
// it opens no tap request and books nothing.
export default async function PlatePage({ params }: { params: Promise<{ plate: string }> }) {
  const { plate } = await params;
  const path = await plateJoinPath(plate);
  if (path) redirect(path);
  if (await programmeEnded({ plateLabel: plate.trim().toUpperCase() })) return <ProgrammeEnded />;
  return <AuthShell>
    <SystemState icon={<Nfc size={26} />} title="Dieses Schild ist gerade keinem Geschäft zugeordnet.">
      Hier wird nichts gutgeschrieben. Bitte frag das Team an der Kasse.
    </SystemState>
  </AuthShell>;
}
