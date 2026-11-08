import { notFound } from "next/navigation";
import { isQuestion } from "@/components/owner/program-helpers";
import { ProgramQuestion } from "@/components/owner/program-question";
import { surfaceHidden } from "@/lib/pilot-surfaces";

// Each Programm row opens its own page (ENG-099). A withheld surface has no route, as everywhere in the owner area.
// `?von=aktionen`: the Aktionen row opened it, so the back link says Aktionen (Design decision 5).
export default async function ProgramQuestionPage({ params, searchParams }: { params: Promise<{ question: string }>; searchParams: Promise<{ von?: string | string[] }> }) {
  const { question } = await params, { von } = await searchParams;
  if (!isQuestion(question) || (question === "nfc" && surfaceHidden("nfc")) || ((question === "birthday" || question === "almost") && surfaceHidden("walletMessages"))) notFound();
  return <ProgramQuestion question={question} from={typeof von === "string" ? von : undefined} />;
}
