import { useId, type ReactNode } from "react";
import { Skeleton } from "./skeleton";
import styles from "./system-state.module.css";

const SUPPORT = "support@getloynara.com";

/** Error and not-found pages: one heading, one sentence on what to do, the ways out, and a code to quote to support. */
export function SystemState({ icon, title, children, actions, reference }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode; reference?: string }) {
  const titleId = useId();
  return <section className={styles.state} aria-labelledby={titleId}>
    {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
    <h1 id={titleId} className={styles.title}>{title}</h1>
    {children ? <p className={styles.body}>{children}</p> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
    {reference ? <p className={styles.reference}>Fehlercode <code>{reference}</code> · <a href={`mailto:${SUPPORT}?subject=${encodeURIComponent(`Fehler auf Loynara (${reference})`)}`}>Support anschreiben</a></p> : null}
  </section>;
}

/** Route-level loading placeholder shaped like the page it stands for. */
export function PageLoading({ variant }: { variant: "column" | "dashboard" }) {
  const placeholder = <div className={styles.loading} data-variant={variant} aria-busy="true">
    <span className={styles.srOnly}>Seite wird geladen</span>
    <Skeleton width="62%" height={34} radius={10} />
    <Skeleton width={variant === "column" ? "88%" : "40%"} height={18} />
    <div className={styles.cards}>
      <Skeleton height={variant === "column" ? 220 : 168} radius={20} />
      {variant === "dashboard" ? <Skeleton height={168} radius={20} /> : <Skeleton height={56} radius={999} />}
    </div>
  </div>;
  // The dashboard variant sits inside the owner shell; the column variant is a whole screen and brings its own theme.
  return variant === "column" ? <div className={`ly-theme-auto ${styles.screen}`}>{placeholder}</div> : placeholder;
}
