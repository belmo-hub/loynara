"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useBackdropClose } from "./use-modal";
import { cx } from "./cx";
import { useModal } from "./use-modal";
import styles from "./dialog.module.css";

type Props = { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string };

/**
 * Centred modal for decisions (confirm a redemption, discard changes). Closes on Esc and on a backdrop click, except a
 * press within 400 ms of opening: the second tap of a double tap on the button that opened it.
 */
export function Dialog({ open, onClose, title, description, children, actions, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModal(ref, open);
  const backdrop = useBackdropClose(onClose);
  const openedAt = useRef(0);
  useEffect(() => { if (open) openedAt.current = performance.now(); }, [open]);
  return <dialog ref={ref} className={cx(styles.dialog, className)} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}
    onClick={backdrop.onClick} onPointerDown={event => { if (performance.now() - openedAt.current >= 400) backdrop.onPointerDown(event); }}>
    <div className={styles.body}>
      <h2 id={titleId} className={styles.title}>{title}</h2>
      {description ? <p id={descriptionId} className={styles.description}>{description}</p> : null}
      {children}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  </dialog>;
}
