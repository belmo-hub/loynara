import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./card.module.css";

type CardProps = HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" | "aside"; tone?: "surface" | "raised"; padding?: "md" | "lg" | "none" };

/** Bordered panel. Elevation is reserved for objects and overlays (see DESIGN.md). */
export function Card({ as: Tag = "div", tone = "surface", padding = "md", className, ...rest }: CardProps) {
  return <Tag className={cx(styles.card, styles[tone], styles[`pad-${padding}`], className)} {...rest} />;
}

type HeaderProps = { id?: string; title: ReactNode; description?: ReactNode; action?: ReactNode; level?: 2 | 3 };

export function CardHeader({ id, title, description, action, level = 2 }: HeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return <div className={styles.header}>
    <div className={styles.titles}><Heading id={id} className={styles.title}>{title}</Heading>{description ? <p className={styles.description}>{description}</p> : null}</div>
    {action ? <div className={styles.action}>{action}</div> : null}
  </div>;
}
