import { notFound } from "next/navigation";
import { SenderQuestionPage } from "@/components/owner/sender";
import { isSenderQuestion } from "@/components/owner/sender-routes";
import { surfaceHidden } from "@/lib/pilot-surfaces";

// Geschäft's sender rows each open their own question (ENG-164). Withheld where no email can be sent, as the section is.
export default async function SenderQuestionRoute({ params }: { params: Promise<{ question: string }> }) {
  const { question } = await params;
  if (!isSenderQuestion(question) || (surfaceHidden("campaigns") && surfaceHidden("automations"))) notFound();
  return <SenderQuestionPage question={question} />;
}
