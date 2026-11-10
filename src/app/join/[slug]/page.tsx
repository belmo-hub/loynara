import { JoinClient } from "@/components/join-client";
import { ProgrammeEnded } from "@/components/customer/programme-ended";
import { experienceFlag } from "@/lib/experience-flags";
import { programmeEnded } from "@/lib/programme-end";

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (await programmeEnded({ slug })) return <ProgrammeEnded />;
  // ENG-205: the flag is read here, on the server; off means today's page.
  return <JoinClient slug={slug} firstTap={experienceFlag("FIRST_TAP_HOOK_ENABLED")} />;
}
