import { Gift } from "lucide-react";
import type { PublicProgram } from "@/components/client-api";
import { PointsLadder } from "@/components/ui/points-ladder";
import { StampGrid } from "@/components/ui/stamp-grid";
import { HEAD_START_DRAFT } from "@/lib/card-extras";
import { withUnit } from "@/lib/units";
import first from "./first-page.module.css";

/**
 * The card on the first page (ENG-205, block 2), and the same card in the owner's „So sieht es der Gast“ preview
 * (ENG-207). `promised` places are rings at full ink, never a fill; `filled` is only what the server booked, and it
 * lands once. A points card promises in its footer alone: the track stays at 0.
 */
export function FirstCard({ program, label, promised = 0, filled = 0, created = false, bonus = false }: {
  program: Pick<PublicProgram, "programType" | "rewardTitle" | "rewardCost" | "rewards">; /** The guest's page names the card; the owner's preview has its own label. */ label?: string; promised?: number; filled?: number;
  /** The server has created the card: its ground presses once. */ created?: boolean; /** The footer ends with „· Startbonus“. */ bonus?: boolean;
}) {
  const points = program.programType === "points", note = promised > 0 ? HEAD_START_DRAFT.spoken(promised) : undefined;
  return <section className={`join-hero ${first.card}`} aria-label={label} data-created={created || undefined} data-promised={(!points && Math.min(promised, 2)) || undefined}>
    {points
      ? <PointsLadder balance={filled} landedFrom={filled > 0 ? 0 : undefined} rewards={(program.rewards?.length ? program.rewards : [{ title: program.rewardTitle, cost: program.rewardCost }]).map(item => ({ title: item.title, cost: item.cost }))} locale="de" note={note} />
      : <StampGrid earned={filled} landed={filled > 0 ? filled : undefined} landedCount={filled || 1} total={program.rewardCost} locale="de" size="sm" reward={<Gift size={16} />} className={first.stamps} note={note} />}
    <p className={`join-reward ${first.foot}`}><Gift size={18} aria-hidden="true" /><span><strong>{program.rewardTitle}</strong> für {withUnit(program.rewardCost, program.programType, "de")}{bonus && <span className={first.bonus}> · Startbonus</span>}</span></p>
  </section>;
}
