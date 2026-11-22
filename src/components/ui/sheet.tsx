"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { useBackdropClose, useModal } from "./use-modal";
import styles from "./sheet.module.css";

type Props = { open: boolean; onClose: () => void; title: ReactNode; children?: ReactNode; footer?: ReactNode; side?: "bottom" | "end" | "auto"; closeLabel?: string; className?: string; keepHeight?: boolean };

/** Modal panel: from the bottom on phones ("Mehr", details), from the side on desktop (row details). */
export function Sheet({ open, onClose, title, children, footer, side = "auto", closeLabel = "Schließen", className, keepHeight = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ y: number; t: number } | null>(null);
  const titleId = useId();
  useModal(ref, open);
  const backdrop = useBackdropClose(onClose);
  // `keepHeight` (ENG-331): the sheet holds its height for the length of a press, so a list closing on blur cannot pull
  // „Schließen“ or a row out from under the finger; after the press it settles to its content. No transition: the hold
  // must be there at once. Released on click, cancel or context menu, not pointerup (on touch the blur comes after pointerup); a press
  // on a disabled control gets no click, so it takes no hold, and opening or closing clears any.
  useEffect(() => { if (ref.current) ref.current.style.minHeight = ""; }, [open]);
  const hold = keepHeight ? {
    onPointerDownCapture: (event: PointerEvent<HTMLDialogElement>) => {
      if (event.button !== 0) return; // a right or middle press gets no click to release it; touch and pen report 0
      if (ref.current && !(event.target as Element).closest(":disabled")) ref.current.style.minHeight = `${ref.current.offsetHeight}px`;
    },
    onClickCapture: () => setTimeout(() => { if (ref.current) ref.current.style.minHeight = "0px"; }),
    onPointerCancelCapture: () => setTimeout(() => { if (ref.current) ref.current.style.minHeight = "0px"; }),
    onContextMenuCapture: () => setTimeout(() => { if (ref.current) ref.current.style.minHeight = "0px"; }), // a macOS Ctrl+click: pointerdown, then this, never a click
  } : {};

  // Drag down on the handle to dismiss; a quick flick is enough (velocity), slow drags need 120 px.
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    drag.current = { y: event.clientY, t: performance.now() };
    if (ref.current) ref.current.style.transition = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !ref.current) return;
    const dy = Math.max(0, event.clientY - drag.current.y);
    ref.current.style.transform = `translateY(${dy}px)`;
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !ref.current) return;
    const dy = Math.max(0, event.clientY - drag.current.y);
    const velocity = dy / Math.max(1, performance.now() - drag.current.t);
    drag.current = null;
    ref.current.style.transition = "";
    ref.current.style.transform = "";
    if (dy > 120 || velocity > 0.5) onClose();
  }

  return <dialog ref={ref} className={cx(styles.sheet, className)} data-side={side} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}
    {...backdrop} {...hold}>
    <div className={styles.handle} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} aria-hidden="true"><span /></div>
    <header className={styles.header}>
      <h2 id={titleId} className={styles.title}>{title}</h2>
      <button type="button" className={styles.close} onClick={onClose} aria-label={closeLabel}><X size={22} aria-hidden="true" /></button>
    </header>
    <div className={styles.content}>{children}</div>
    {footer ? <footer className={styles.footer}>{footer}</footer> : null}
  </dialog>;
}
