import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./badge.module.css";

export type BadgeTone = "neutral" | "action" | "success" | "warning" | "danger" | "stamp";

export function Badge({ tone = "neutral", className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cx(styles.badge, styles[tone], className)} {...rest} />;
}
