import { headers } from "next/headers";
import { CardClient } from "@/components/card-client";
import { ProgrammeEnded } from "@/components/customer/programme-ended";
import { firstPaintQr } from "@/lib/card-first-paint";
import { endedCardShop } from "@/lib/programme-end";

export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shop = await endedCardShop(token);
  if (shop) return <ProgrammeEnded shop={shop} cardToken={token} />;
  // Web audit finding 1 (option C): the QR, the card's largest element, starts loading from the first HTML while the
  // page's script and its read run; the card then draws the same URL from memory, with nothing drawn twice. The request
  // is rebuilt from the page's own headers for the per-network limit; its path is a placeholder, never the card link.
  const qr = await firstPaintQr(token, new Request("http://card.local/card", { headers: await headers() }));
  return <>{qr && <link rel="preload" as="image" href={qr} fetchPriority="high" />}<CardClient token={token} /></>;
}
