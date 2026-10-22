import { JoinClient } from "@/components/join-client";
import { ProgrammeEnded } from "@/components/customer/programme-ended";
import { programmeEnded } from "@/lib/programme-end";

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (await programmeEnded({ slug })) return <ProgrammeEnded />;
  return <JoinClient slug={slug} />;
}
