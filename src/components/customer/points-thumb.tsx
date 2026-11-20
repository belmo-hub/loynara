import { withUnit } from "@/lib/units";
import s from "./points-thumb.module.css";

/** A points card for list rows, 64 × 44, no type: the track filled to the dearest reward and its dot (Design, ENG-292 §4.1). */
/** The fill in whole pixels; any balance shows at least 1, and only a reached cost fills all 36, so it agrees with the dot. */
export const thumbFill = (balance: number, cost: number) =>
  balance <= 0 ? 0 : balance >= cost ? 36 : Math.min(35, Math.max(1, Math.round(36 * balance / cost)));

export function PointsThumb({ balance, cost }: { balance: number; cost: number }) {
  const fill = thumbFill(balance, cost);
  return <span className={s.thumb} role="img" aria-label={withUnit(balance, "points")}>
    <span className={s.track}><span className={s.fill} style={{ width: fill }} /></span>
    <i data-on={balance >= cost || undefined} />
  </span>;
}
