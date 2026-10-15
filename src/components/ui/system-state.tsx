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

/**
 * Route-level loading placeholder for the owner dashboard, shaped like a page header and two cards. There is no
 * app-wide loading.tsx on purpose: a Suspense boundary above a page turns its server redirect (/ → /login, /register
 * while registration is off) into a 200 with a client-side redirect.
 */
export function PageLoading() {
  return <div className={styles.loading} aria-busy="true">
    <span className={styles.srOnly}>Seite wird geladen</span>
    <Skeleton width="62%" height={34} radius={10} />
    <Skeleton width="40%" height={18} />
    <div className={styles.cards}>
      <Skeleton height={168} radius={20} />
      <Skeleton height={168} radius={20} />
    </div>
  </div>;
}
