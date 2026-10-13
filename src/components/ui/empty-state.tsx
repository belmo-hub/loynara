import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./empty-state.module.css";

/** Says what this place is for and how to fill it. */
export function EmptyState({ icon, title, children, action, level = 2, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; level?: 2 | 3; className?: string }) {
  const Heading = level === 2 ? "h2" : "h3";
  return <div className={cx(styles.empty, className)}>
    {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
    <Heading className={styles.title}>{title}</Heading>
    {children ? <p className={styles.body}>{children}</p> : null}
    {action ? <div className={styles.action}>{action}</div> : null}
  </div>;
}
