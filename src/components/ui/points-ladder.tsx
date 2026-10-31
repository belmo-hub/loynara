import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { withUnit } from "@/lib/units";
import { cx } from "./cx";
import styles from "./points-ladder.module.css";

type Reward = { title: string; cost: number };
/** `titles`: each marker names its reward under the cost (the guest's card and the join preview, G-04). */
type Props = { balance: number; rewards: Reward[]; locale?: "de" | "fr"; titles?: boolean; className?: string };

const MIN_LABEL_GAP = 0.14;
/** Named markers need room for a short reward name. */
const MIN_TITLE_GAP = 0.34;

/** Marker positions (0..1) and which labels to hide so neighbours never collide. */
export function ladderMarks(sorted: Reward[], max: number, balance: number, gap = MIN_LABEL_GAP) {
  return sorted.reduce<Array<Reward & { at: number; hideLabel: boolean; reached: boolean }>>((marks, reward) => {
    const at = reward.cost / max;
    const lastShown = [...marks].reverse().find((m) => !m.hideLabel);
    marks.push({ ...reward, at, hideLabel: lastShown ? at - lastShown.at < gap : false, reached: balance >= reward.cost });
    return marks;
  }, []);
}

/** One track to the most expensive reward; a marker per reward becomes a pressed mark once affordable. */
export function PointsLadder({ balance, rewards, locale = "de", titles = false, className }: Props) {
  if (!rewards.length) return null;
  const sorted = [...rewards].sort((a, b) => a.cost - b.cost);
  const max = Math.max(1, sorted.at(-1)?.cost ?? 1);
  const marks = ladderMarks(sorted, max, balance, titles ? MIN_TITLE_GAP : MIN_LABEL_GAP);
  const label = locale === "fr" ? `${withUnit(balance, "points", "fr")} sur ${max}` : `${balance} von ${withUnit(max, "points", "de", "dat")}`;
  return <div className={cx(styles.ladder, className)} role="img" aria-label={label} data-titles={titles || undefined}>
    <div className={styles.track}><span className={styles.fill} style={{ transform: `scaleX(${Math.min(1, balance / max)})` }} /></div>
    {marks.map((m) => <span key={`${m.title}-${m.cost}`} className={styles.mark} style={{ "--at": m.at } as CSSProperties} data-reached={m.reached || undefined} data-label-hidden={m.hideLabel || undefined} data-end={m.at === 1 || undefined}>
      <span className={styles.dot}>{m.reached ? <Check size={14} strokeWidth={3} /> : null}</span>
      <small className={styles.cost}>{m.cost}</small>
      {titles ? <small className={styles.title}>{m.title}</small> : null}
    </span>)}
  </div>;
}
