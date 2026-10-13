import type { CSSProperties, ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { cx } from "./cx";
import { merchantPalette } from "./merchant-color";
import { ToastProvider } from "./toast";
import styles from "./cashier-shell.module.css";

export type CashierState = "ready" | "open" | "busy" | "done" | "error";
type Props = { location: ReactNode; state: CashierState; stateLabel: ReactNode; stateDetail?: ReactNode; actions?: ReactNode; dock?: ReactNode; brandColor?: string | null; children?: ReactNode };

/** Dark, camera-first counter frame: location bar, one visible state, content, and the booking dock in thumb reach. */
export function CashierShell({ location, state, stateLabel, stateDetail, actions, dock, brandColor, children }: Props) {
  const palette = merchantPalette(brandColor ?? "", "dark");
  return <div className={cx("ly-theme-dark", styles.shell)} style={palette.cssVars as CSSProperties} data-has-dock={dock ? true : undefined}>
    <ToastProvider>
      <header className={styles.bar}>
        <BrandMark word={false} />
        <strong className={styles.location}>{location}</strong>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <div className={styles.status} data-state={state} role="status" aria-live="polite">
        <span className={styles.dot} aria-hidden="true" />
        <strong className={styles.stateLabel}>{stateLabel}</strong>
        {stateDetail ? <span className={styles.detail}>{stateDetail}</span> : null}
      </div>
      <main id="inhalt" className={styles.main}>{children}</main>
      {dock ? <div className={styles.dock} data-dock="true">{dock}</div> : null}
    </ToastProvider>
  </div>;
}
