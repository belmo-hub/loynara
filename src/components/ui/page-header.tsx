import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./page-header.module.css";

/** One h1 per page: a short title, one line of context, page-level actions. */
export function PageHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return <header className={cx(styles.header, className)}>
    <div className={styles.titles}><h1 className={styles.title}>{title}</h1>{description ? <p className={styles.description}>{description}</p> : null}</div>
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </header>;
}
