import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./progress-ring.module.css";

type Props = { value: number; max: number; label: string; size?: number; children?: ReactNode; className?: string };

export function ProgressRing({ value, max, label, size = 160, children, className }: Props) {
  const r = 44;
  const length = 2 * Math.PI * r;
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return <div className={cx(styles.ring, className)} style={{ width: size, height: size }} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
    <svg viewBox="0 0 100 100" aria-hidden="true" className={styles.svg}>
      <circle cx="50" cy="50" r={r} className={styles.track} />
      <circle cx="50" cy="50" r={r} className={styles.fill} strokeDasharray={`${length * fraction} ${length}`} />
    </svg>
    {children ? <div className={styles.center}>{children}</div> : null}
  </div>;
}
