"use client";

import { useEffect, useId, useRef, type ReactNode, type SyntheticEvent } from "react";
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
  // data-guard also takes the panel out of hit-testing for that time, so a test robot waits for it like a person would.
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    openedAt.current = performance.now();
    dialog.dataset.guard = "";
    const timer = window.setTimeout(() => { delete dialog.dataset.guard; }, 400);
    return () => window.clearTimeout(timer);
  }, [open]);
  // A keyboard activation (a click with detail 0) is a deliberate key press, not the second half of a double tap.
  const swallowEarly = (event: SyntheticEvent) => {
    if (event.type === "click" && (event.nativeEvent as MouseEvent).detail === 0) return;
    if (performance.now() - openedAt.current < 400) { event.preventDefault(); event.stopPropagation(); }
  };
  return <dialog ref={ref} className={cx(styles.dialog, className)} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}
    onPointerDownCapture={swallowEarly} onMouseDownCapture={swallowEarly} onClickCapture={swallowEarly} {...backdrop}>
    <div className={styles.body}>
      <h2 id={titleId} className={styles.title}>{title}</h2>
      {description ? <p id={descriptionId} className={styles.description}>{description}</p> : null}
      {children}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  </dialog>;
}
