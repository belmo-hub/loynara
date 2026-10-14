import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./stamp-grid.module.css";

type Props = { earned: number; total: number; landed?: number; locale?: "de" | "fr"; mark?: ReactNode; size?: "md" | "sm"; className?: string };

/** Columns that keep rows even: 4 for 8 or 12, 5 for 10 or 15, 3 for 6 or 9. */
export function stampColumns(total: number) {
  if (total <= 5) return total;
  if (total % 4 === 0) return 4;
  if (total % 5 === 0) return 5;
  if (total % 3 === 0) return 3;
  return total > 12 ? 5 : 4;
}

/**
 * The stamp card. Earned stamps are pressed marks with a small resting rotation; the stamp at index `landed - 1`
 * plays the landing motion once (DESIGN.md, "Pop in").
 */
export function StampGrid({ earned, total, landed, locale = "de", mark, size = "md", className }: Props) {
  const filled = Math.max(0, Math.min(earned, total));
  const label = locale === "fr" ? `${filled} ${filled === 1 ? "tampon" : "tampons"} sur ${total}` : `${filled} von ${total} Stempeln`;
  return <ol className={cx(styles.grid, styles[size], className)} aria-label={label} style={{ "--cols": stampColumns(total) } as CSSProperties}>
    {Array.from({ length: total }, (_, index) => {
      const isEarned = index < filled;
      return <li key={index} className={styles.slot} data-earned={isEarned || undefined} data-new={isEarned && landed === index + 1 ? true : undefined} style={{ "--r": `${((index * 47) % 17) - 8}deg` } as CSSProperties} aria-hidden="true">
        {isEarned ? mark ?? <Check size={size === "sm" ? 16 : 22} strokeWidth={3} /> : null}
      </li>;
    })}
  </ol>;
}
