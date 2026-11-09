import { TapClient } from "@/components/tap-client";
import { ProgrammeEnded } from "@/components/customer/programme-ended";
import { DemoSampleCard } from "@/components/customer/demo-sample-card";
import { demoPlateLive } from "@/lib/demo";
import { demoEnvironment } from "@/lib/demo-environment";
import { programmeEnded } from "@/lib/programme-end";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function TapPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  // Demo environment (design v3): with no demo running the plate shows a neutral sample card and writes nothing.
  if (demoEnvironment() && !(await demoPlateLive(ref))) return <DemoSampleCard />;
  if (await programmeEnded({ tapRef: ref })) return <ProgrammeEnded />;
  return <TapClient refId={ref} />;
}
