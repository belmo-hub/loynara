import { TapClient } from "@/components/tap-client";
import { ProgrammeEnded } from "@/components/customer/programme-ended";
import { programmeEnded } from "@/lib/programme-end";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function TapPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (await programmeEnded({ tapRef: ref })) return <ProgrammeEnded />;
  return <TapClient refId={ref} />;
}
