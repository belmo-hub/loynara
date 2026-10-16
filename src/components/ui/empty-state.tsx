import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./empty-state.module.css";

/**
 * Says what this place is for and how to fill it. `compact` is for feeds and side panels inside a card:
 * left-aligned, no icon tile, less padding.
 */
export function EmptyState({ icon, title, children, action, level = 2, size = "default", className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; level?: 2 | 3 | 4; size?: "default" | "compact"; className?: string }) {
  const Heading = level === 2 ? "h2" : level === 3 ? "h3" : "h4";
  return <div className={cx(styles.empty, className)} data-size={size}>
    {icon && size === "default" ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
    <Heading className={styles.title}>{title}</Heading>
    {children ? <p className={styles.body}>{children}</p> : null}
    {action ? <div className={styles.action}>{action}</div> : null}
  </div>;
}
