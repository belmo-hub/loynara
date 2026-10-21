import { CardClient } from "@/components/card-client";
import { ProgrammeEnded } from "@/components/customer/programme-ended";
import { programmeEnded } from "@/lib/programme-end";

export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await programmeEnded({ cardToken: token })) return <ProgrammeEnded />;
  return <CardClient token={token} />;
}
