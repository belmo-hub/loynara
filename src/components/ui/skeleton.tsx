import type { CSSProperties } from "react";
import { cx } from "./cx";
import styles from "./skeleton.module.css";

/** Placeholder shaped like the content it stands for. Wrap the loading region in aria-busy="true". */
export function Skeleton({ width = "100%", height = 16, radius, className }: { width?: number | string; height?: number | string; radius?: number | string; className?: string }) {
  return <span aria-hidden="true" className={cx(styles.skeleton, className)} style={{ width, height, borderRadius: radius } as CSSProperties} />;
}
