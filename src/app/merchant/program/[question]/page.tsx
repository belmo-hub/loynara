import { notFound } from "next/navigation";
import { isQuestion } from "@/components/owner/program-helpers";
import { ProgramQuestion } from "@/components/owner/program-question";
import { surfaceHidden } from "@/lib/pilot-surfaces";

// Each Programm row opens its own page (ENG-099). A withheld surface has no route, as everywhere in the owner area.
export default async function ProgramQuestionPage({ params }: { params: Promise<{ question: string }> }) {
  const { question } = await params;
  if (!isQuestion(question) || (question === "nfc" && surfaceHidden("nfc"))) notFound();
  return <ProgramQuestion question={question} />;
}
