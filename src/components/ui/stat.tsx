import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./stat.module.css";

const number = new Intl.NumberFormat("de-DE");
type Point = { label: string; value: number };

export function StatGroup({ label, className, children }: { label: string; className?: string; children?: ReactNode }) {
  return <dl className={cx(styles.group, className)} aria-label={label}>{children}</dl>;
}

/**
 * KPI tile (dataviz stat-tile contract): label, value in the text sans with proportional figures, optional note and a
 * small bar trend where only the latest period carries the accent. Use inside StatGroup.
 */
export function Stat({ label, value, note, trend, unit }: { label: ReactNode; value: number | string; note?: ReactNode; trend?: Point[]; unit?: string }) {
  const max = Math.max(1, ...(trend ?? []).map((p) => p.value));
  return <div className={styles.stat}>
    <dt className={styles.label}>{label}</dt>
    <dd className={styles.value}>{typeof value === "number" ? number.format(value) : value}{unit ? <span className={styles.unit}>{unit}</span> : null}</dd>
    {trend?.length ? <dd className={styles.trendCell}>
      <svg className={styles.trend} viewBox={`0 0 ${trend.length * 12} 28`} preserveAspectRatio="none" role="img" aria-label={`Verlauf: ${trend.map((p) => `${p.label} ${number.format(p.value)}`).join(", ")}`}>
        {trend.map((p, i) => { const h = Math.max(2, (p.value / max) * 28); return <rect key={`${i}-${p.label}`} x={i * 12} y={28 - h} width={10} height={h} rx={2} className={i === trend.length - 1 ? styles.current : styles.past}><title>{`${p.label}: ${number.format(p.value)}`}</title></rect>; })}
      </svg>
    </dd> : null}
    {note ? <dd className={styles.note}>{note}</dd> : null}
  </div>;
}
