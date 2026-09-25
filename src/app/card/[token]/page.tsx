import { CardClient } from "@/components/card-client";

export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CardClient token={token} />;
}
