"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { cx } from "./cx";
import { merchantPalette } from "./merchant-color";
import { ToastProvider } from "./toast";
import styles from "./cashier-shell.module.css";

export type CashierState = "ready" | "open" | "busy" | "done" | "error";
type Props = { location: ReactNode; state: CashierState; stateLabel: ReactNode; stateDetail?: ReactNode; actions?: ReactNode; dock?: ReactNode; brandColor?: string | null; lang?: string;
  /** False when the page announces its own outcomes; the strip then only mirrors the state visually. */
  live?: boolean; /** Keeps the dock at least this tall (the Kasse holds the open dock's height through „Gebucht“). */ dockMinHeight?: number; /** On a phone (under 600 px) the dock is never shorter than this: the open Kasse makes room for the booked stack it will hold. */ dockFloor?: number; /** From 600 px: holds the group where it stands (a booking and its „Gebucht“), so only the dock's bottom edge moves. */ holdTop?: boolean; /** Names the dock as a region, so landmark navigation reaches the primary action. */ dockLabel?: string; /** The strip as a still placeholder while the counter waits (the Kasse's own shape, no words yet); "empty" keeps only its slot. */ placeholder?: boolean | "empty"; children?: ReactNode };

/** Dark, camera-first counter frame: location bar, one visible state, content, and the booking dock in thumb reach. */
export function CashierShell({ location, state, stateLabel, stateDetail, actions, dock, brandColor, lang, live = true, placeholder, dockMinHeight, dockFloor, dockLabel, holdTop, children }: Props) {
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
      {dock ? <Dock label={dockLabel} minHeight={dockMinHeight} floor={dockFloor} held={holdTop}>{dock}</Dock> : null}
    </ToastProvider>
  </div>;
}

/**
 * The booking dock. From 600 px wide the Kasse is a centred group with a floating panel only if it still fits when the
 * dock holds its booked stack (the larger of the open dock and the floor), with at least 24 px under it; otherwise, and
 * on a phone, it is the phone's layout: content from the top, the dock sticky and flat at the bottom, never shorter than
 * the floor (Design, 19 Nov). Decided when the card opens and kept through a booking, so the tap never changes the
 * layout. It is measured from the content's and the dock's own heights, which are the same in either layout, so the
 * choice cannot feed back into itself.
 */
function Dock({ label, minHeight, floor, held, children }: { label?: string; minHeight?: number; floor?: number; held?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const holding = useRef(false), recheck = useRef<() => void>(undefined);
  // A booking keeps the layout the open card was given until the card leaves (Design, 19 Nov). A centred group's auto
  // top margin becomes its measured value and the panel, no longer sticky, grows downward (past the bottom edge the
  // page scrolls); the phone's layout keeps its sticky dock and the held height. The next card decides afresh.
  useLayoutEffect(() => {
    const dock = ref.current, main = dock?.previousElementSibling as HTMLElement | null, shell = dock?.parentElement;
    if (!held || !dock || !main || !shell) return;
    holding.current = true;
    const pinned = dock.hasAttribute("data-floating") ? [shell.querySelector<HTMLElement>(`:scope > .${styles.status}`), main].filter(el => el !== null) : [];
    for (const el of pinned) el.style.marginTop = getComputedStyle(el).marginTop;
    if (pinned.length) shell.setAttribute("data-held", "");
    return () => { for (const el of pinned) el.style.marginTop = ""; shell.removeAttribute("data-held"); holding.current = false; recheck.current?.(); };
  }, [held]);
  // Set on the node itself, not through state: the layout effect and the observer run before paint, so the first painted
  // frame of an open card already has the dock it keeps (Design, 18 Nov: reduced motion showed the phone layout first).
  useLayoutEffect(() => {
    const dock = ref.current, main = dock?.previousElementSibling as HTMLElement | null | undefined, shell = dock?.parentElement;
    if (!dock || !main || !shell) return;
    const px = (el: Element, ...props: string[]) => props.reduce((sum, prop) => sum + parseFloat(getComputedStyle(el).getPropertyValue(prop)), 0);
    // Layout boxes (offsets, not transformed rects, so an entrance animation does not count); display: contents wrappers
    // are looked through.
    const boxes = (el: Element): HTMLElement[] => [...el.children].flatMap(child => getComputedStyle(child).display === "contents" ? boxes(child) : child instanceof HTMLElement && child.offsetHeight > 0 ? [child] : []);
    const extent = (el: HTMLElement, origin: number) => { const kids = boxes(el); return kids.length ? Math.max(...kids.map(kid => kid.offsetTop + kid.offsetHeight)) - origin : 0; };
    const fits = () => {
      if (!matchMedia("(min-width: 600px)").matches) return false;
      const head = shell.querySelector<HTMLElement>(":scope > header"), status = shell.querySelector<HTMLElement>(`:scope > .${styles.status}`);
      const content = (status ? status.offsetHeight + 12 : 0) + extent(main, main.offsetTop) + px(main, "padding-bottom");
      const kids = boxes(dock), first = kids.length ? Math.min(...kids.map(kid => kid.offsetTop)) : 0;
      const open = (kids.length ? extent(dock, first) : 0) + px(dock, "padding-top", "padding-bottom", "border-top-width", "border-bottom-width");
      const booked = Math.max(open, parseFloat(dock.style.getPropertyValue("--dock-floor")) || 0);
      const spare = innerHeight - (head ? head.offsetTop + head.offsetHeight : 0) - content - open;
      return spare / 2 - (booked - open) >= 24;
    };
    // A flip that would only undo the last one, with the window and the content unchanged, is the panel's own size
    // feeding back (a wrapped line inside the narrower panel): the dock keeps the state it has. New dock content (a
    // booking) or another window or column size decides afresh.
    let last: { back: boolean; key: string } | undefined;
    const check = () => {
      if (holding.current) return;
      const want = fits(), now = dock.hasAttribute("data-floating");
      const key = `${innerWidth}x${innerHeight}:${main.getBoundingClientRect().height}:${dock.textContent}`;
      if (want === now || (last && last.back === want && last.key === key)) return;
      last = { back: now, key };
      dock.toggleAttribute("data-floating", want);
    };
    recheck.current = check;
    const observer = new ResizeObserver(check);
    observer.observe(dock); observer.observe(main); observer.observe(shell); observer.observe(document.documentElement);
    window.addEventListener("resize", check);
    check();
    return () => { observer.disconnect(); window.removeEventListener("resize", check); };
  }, []);
  const style = { ...(minHeight ? { minHeight } : {}), ...(floor ? { "--dock-floor": `${floor}px` } : {}) } as CSSProperties;
  return <div ref={ref} className={styles.dock} data-dock="true" role={label ? "region" : undefined} aria-label={label} style={style}>{children}</div>;
}
