import { TapClient } from "@/components/tap-client";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function TapPage({ params }: { params: Promise<{ ref: string }> }) {
  return <TapClient refId={(await params).ref} />;
}
