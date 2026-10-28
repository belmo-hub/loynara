import { RewardQuestion } from "@/components/owner/program-question";

export default async function RewardQuestionPage({ params }: { params: Promise<{ reward: string }> }) {
  return <RewardQuestion reward={(await params).reward} />;
}
