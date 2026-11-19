"use client";

import { useEffect, useId, useRef, type MouseEvent, type PointerEvent, type ReactNode, type SyntheticEvent } from "react";
import { useBackdropClose } from "./use-modal";
import { cx } from "./cx";
import { useModal } from "./use-modal";
import styles from "./dialog.module.css";

type Props = { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string };

/**
 * Centred modal for decisions (confirm a redemption, discard changes). Closes on Esc and on a backdrop click. Every press
 * within 400 ms of opening is swallowed, on the backdrop and on the actions alike: the second tap of a double tap on the
 * button that opened it must neither close the dialog nor confirm it, wherever the page had scrolled that button.
 */
export function Dialog({ open, onClose, title, description, children, actions, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModal(ref, open);
  const backdrop = useBackdropClose(onClose);
  const openedAt = useRef(0);
  // A press is judged by its start: one that began in the first 400 ms is swallowed to its end (its pointerup, the
  // compatibility mouse events and its click), even when the finger lifts later, because Chrome hit-tests a touch at
  // release and would fire its click on „Ja“. The next pointerdown or a pointercancel ends it; a fresh press works.
  // data-guard keeps the panel out of hit-testing meanwhile (it also makes a test robot wait like a person).
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    openedAt.current = performance.now();
    dialog.dataset.guard = "";
    const timer = window.setTimeout(() => { delete dialog.dataset.guard; }, 400);
    return () => window.clearTimeout(timer);
  }, [open]);
  const held = useRef<number | null>(null);
  const early = () => performance.now() - openedAt.current < 400;
  const swallow = (event: SyntheticEvent) => { event.preventDefault(); event.stopPropagation(); };
  const onPointerDownCapture = (event: PointerEvent<HTMLDialogElement>) => { held.current = early() ? event.pointerId : null; if (held.current !== null) swallow(event); };
  const onPointerUpCapture = (event: PointerEvent<HTMLDialogElement>) => { if (held.current === event.pointerId) swallow(event); };
  const onPointerCancelCapture = (event: PointerEvent<HTMLDialogElement>) => { if (held.current === event.pointerId) held.current = null; };
  const onMouseCapture = (event: MouseEvent<HTMLDialogElement>) => { if (held.current !== null || early()) swallow(event); };
  // A keyboard activation (a click with detail 0) is a deliberate key press, not the end of an early press.
  const onClickCapture = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.detail === 0) return;
    if (held.current !== null || early()) swallow(event);
    held.current = null;
  };
  return <dialog ref={ref} className={cx(styles.dialog, className)} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}
    onPointerDownCapture={onPointerDownCapture} onPointerUpCapture={onPointerUpCapture} onPointerCancelCapture={onPointerCancelCapture}
    onMouseDownCapture={onMouseCapture} onMouseUpCapture={onMouseCapture} onClickCapture={onClickCapture} {...backdrop}>
    <div className={styles.body}>
      <h2 id={titleId} className={styles.title}>{title}</h2>
      {description ? <p id={descriptionId} className={styles.description}>{description}</p> : null}
      {children}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  </dialog>;
}
