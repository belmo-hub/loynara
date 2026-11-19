import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { withUnit } from "@/lib/units";
import { cx } from "./cx";
import styles from "./stamp-grid.module.css";

/** `reward`: the icon the last slot shows in an ink ring until it is earned (the owner's card view, ENG-122a). */
type Props = { earned: number; total: number; landed?: number; landedCount?: number; locale?: "de" | "fr"; mark?: ReactNode; reward?: ReactNode; size?: "md" | "sm"; className?: string;
  /** A long programme's track grows from the start, once (the guest card page's first paint). */
  grow?: boolean };

/** Above this many stamps a card of marks stops being readable (and buries the code below it); a track replaces it. */
export const STAMP_GRID_MAX = 30;

/** What a reader hears for a card of stamps: „5 von 8 Stempeln“. */
export const stampsLabel = (filled: number, total: number, locale: "de" | "fr" = "de") =>
  locale === "fr" ? `${withUnit(filled, "stamps", "fr")} sur ${total}` : `${filled} von ${withUnit(total, "stamps", "de", "dat")}`;

/** Columns that keep rows even: 4 for 8 or 12, 5 for 10 or 15, 3 for 6 or 9. */
export function stampColumns(total: number) {
  if (total <= 5) return total;
  if (total % 4 === 0) return 4;
  if (total % 5 === 0) return 5;
  if (total % 3 === 0) return 3;
  return total > 12 ? 5 : 4;
}

/**
 * The stamp card. Earned stamps are pressed marks with a small resting rotation; the last `landedCount` stamps up to
 * `landed` play the landing motion once, 90 ms apart (DESIGN.md, "Pop in"). Programmes longer than STAMP_GRID_MAX stamps get one progress
 * track instead, so the card keeps its height whatever the merchant sets.
 */
export function StampGrid({ earned, total, landed, landedCount = 1, locale = "de", mark, reward, size = "md", className, grow = false }: Props) {
  const filled = Math.max(0, Math.min(earned, total));
  // Above the goal a reader hears the true count, as the card shows it (Design, 18 Nov: never clamp).
  const label = earned > total ? withUnit(earned, "stamps", locale) : stampsLabel(filled, total, locale);
  if (total > STAMP_GRID_MAX) {
    return <div className={cx(styles.track, className)} role="img" aria-label={label} data-grow={grow || undefined}>
      <span className={styles.trackFill} style={{ "--progress": total > 0 ? filled / total : 0 } as CSSProperties} />
    </div>;
  }
  return <ol className={cx(styles.grid, styles[size], className)} aria-label={label} style={{ "--cols": stampColumns(total) } as CSSProperties}>
    {Array.from({ length: total }, (_, index) => {
      const isEarned = index < filled, goal = !isEarned && index === total - 1 ? reward : undefined;
      const order = landed === undefined ? -1 : index - (landed - landedCount), isNew = isEarned && order >= 0 && index < landed!;
      return <li key={index} className={styles.slot} data-earned={isEarned || undefined} data-reward={goal ? true : undefined} data-new={isNew || undefined} style={{ "--r": `${((index * 47) % 17) - 8}deg`, ...(isNew && order > 0 && { "--land-stagger": `${order * 90}ms` }) } as CSSProperties} aria-hidden="true">
        {isEarned ? mark ?? <Check size={size === "sm" ? 16 : 22} strokeWidth={3} /> : goal ?? null}
      </li>;
    })}
  </ol>;
}
