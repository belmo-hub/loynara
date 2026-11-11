import { redirect } from "next/navigation";
import { CircleAlert, CreditCard } from "lucide-react";
import { CustomerState, StateLink } from "@/components/customer/customer-state";
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
  return <CustomerState tone="error" icon={<CircleAlert size={24} />} title="Dieses Schild ist gerade keinem Geschäft zugeordnet." message="Hier wird nichts gutgeschrieben. Bitte frag das Team an der Kasse.">
    <StateLink href="/recover" icon={<CreditCard size={22} />}>Karte wiederfinden</StateLink>
  </CustomerState>;
}
