import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { cx } from "./cx";
import styles from "./points-ladder.module.css";

type Reward = { title: string; cost: number };
type Props = { balance: number; rewards: Reward[]; locale?: "de" | "fr"; className?: string };

const MIN_LABEL_GAP = 0.14;

/** Marker positions (0..1) and which labels to hide so neighbours never collide. */
export function ladderMarks(sorted: Reward[], max: number, balance: number) {
  return sorted.reduce<Array<Reward & { at: number; hideLabel: boolean; reached: boolean }>>((marks, reward) => {
    const at = reward.cost / max;
    const lastShown = [...marks].reverse().find((m) => !m.hideLabel);
    marks.push({ ...reward, at, hideLabel: lastShown ? at - lastShown.at < MIN_LABEL_GAP : false, reached: balance >= reward.cost });
    return marks;
  }, []);
}

/** One track to the most expensive reward; a marker per reward becomes a pressed mark once affordable. */
export function PointsLadder({ balance, rewards, locale = "de", className }: Props) {
  if (!rewards.length) return null;
  const sorted = [...rewards].sort((a, b) => a.cost - b.cost);
  const max = Math.max(1, sorted.at(-1)?.cost ?? 1);
  const marks = ladderMarks(sorted, max, balance);
  const label = locale === "fr" ? `${balance} points sur ${max}` : `${balance} von ${max} Punkten`;
  return <div className={cx(styles.ladder, className)} role="img" aria-label={label}>
    <div className={styles.track}><span className={styles.fill} style={{ transform: `scaleX(${Math.min(1, balance / max)})` }} /></div>
    {marks.map((m) => <span key={`${m.title}-${m.cost}`} className={styles.mark} style={{ "--at": m.at } as CSSProperties} data-reached={m.reached || undefined} data-label-hidden={m.hideLabel || undefined}>
      <span className={styles.dot}>{m.reached ? <Check size={14} strokeWidth={3} /> : null}</span>
      <small className={styles.cost}>{m.cost}</small>
    </span>)}
  </div>;
}
