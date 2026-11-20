import { withUnit } from "@/lib/units";
import s from "./points-thumb.module.css";

/** A points card for list rows, 64 × 44, no type: the track filled to the dearest reward and its dot (Design, ENG-292 §4.1). */
export function PointsThumb({ balance, cost }: { balance: number; cost: number }) {
  const fill = Math.round(36 * Math.min(Math.max(balance, 0) / cost, 1)); // whole pixels, over the goal stays full
  return <span className={s.thumb} role="img" aria-label={withUnit(balance, "points")}>
    <span className={s.track}><span className={s.fill} style={{ width: fill }} /></span>
    <i data-on={balance >= cost || undefined} />
  </span>;
}
