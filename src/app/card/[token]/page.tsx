import { CardClient } from "@/components/card-client";
import { ProgrammeEnded } from "@/components/customer/programme-ended";
import { endedCardShop } from "@/lib/programme-end";

export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shop = await endedCardShop(token);
  if (shop) return <ProgrammeEnded shop={shop} cardToken={token} />;
  return <CardClient token={token} />;
}
