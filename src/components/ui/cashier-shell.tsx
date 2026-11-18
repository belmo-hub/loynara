"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { cx } from "./cx";
import { merchantPalette } from "./merchant-color";
import { ToastProvider } from "./toast";
import styles from "./cashier-shell.module.css";

export type CashierState = "ready" | "open" | "busy" | "done" | "error";
type Props = { location: ReactNode; state: CashierState; stateLabel: ReactNode; stateDetail?: ReactNode; actions?: ReactNode; dock?: ReactNode; brandColor?: string | null; lang?: string;
  /** False when the page announces its own outcomes; the strip then only mirrors the state visually. */
  live?: boolean; /** Keeps the dock at least this tall (the Kasse holds the open dock's height through „Gebucht“). */ dockMinHeight?: number; /** Names the dock as a region, so landmark navigation reaches the primary action. */ dockLabel?: string; /** The strip as a still placeholder while the counter waits (the Kasse's own shape, no words yet); "empty" keeps only its slot. */ placeholder?: boolean | "empty"; children?: ReactNode };

/** Dark, camera-first counter frame: location bar, one visible state, content, and the booking dock in thumb reach. */
export function CashierShell({ location, state, stateLabel, stateDetail, actions, dock, brandColor, lang, live = true, placeholder, dockMinHeight, dockLabel, children }: Props) {
  const palette = merchantPalette(brandColor ?? "", "dark");
  return <div className={cx("ly-theme-dark", styles.shell)} style={palette.cssVars as CSSProperties} data-has-dock={dock ? true : undefined} lang={lang}>
    <ToastProvider>
      <header className={styles.bar}>
        <BrandMark word={false} />
        <strong className={styles.location}>{location}</strong>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      {/* No label, no strip: a screen that states its own result (the counter's „Gebucht“) leaves it out. */}
      {stateLabel == null ? null : <div className={styles.status} data-state={state} data-placeholder={placeholder === "empty" ? "empty" : placeholder || undefined} aria-hidden={placeholder ? true : undefined} role={live ? "status" : undefined} aria-live={live ? "polite" : undefined}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.stateText}>
          <strong className={styles.stateLabel}>{stateLabel}</strong>
          {stateDetail ? <span className={styles.detail}>{stateDetail}</span> : null}
        </span>
      </div>}
      <main id="inhalt" className={styles.main}>{children}</main>
      {dock ? <Dock label={dockLabel} minHeight={dockMinHeight}>{dock}</Dock> : null}
    </ToastProvider>
  </div>;
}

/**
 * The booking dock. Where it runs off the screen's bottom edge (a phone, a group too tall to centre) its lower edge is
 * flat, as drawn; where it stops short of the edge (a centred counter tablet) it is a panel and every corner takes its
 * top radius (Design, 18 Nov). Which one it is depends on the rendered position, so it is measured, not guessed.
 */
function Dock({ label, minHeight, children }: { label?: string; minHeight?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    const dock = ref.current;
    if (!dock) return;
    const check = () => setFloating(dock.getBoundingClientRect().bottom < window.innerHeight - 1);
    const observer = new ResizeObserver(check);
    observer.observe(dock); observer.observe(document.documentElement);
    window.addEventListener("resize", check); window.addEventListener("scroll", check, { passive: true });
    check();
    return () => { observer.disconnect(); window.removeEventListener("resize", check); window.removeEventListener("scroll", check); };
  }, []);
  return <div ref={ref} className={styles.dock} data-dock="true" data-floating={floating || undefined} role={label ? "region" : undefined} aria-label={label} style={minHeight ? { minHeight } : undefined}>{children}</div>;
}
