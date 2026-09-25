import { JoinClient } from "@/components/join-client";

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <JoinClient slug={slug} />;
}
