"use client";

import { useId, useRef, type ReactNode } from "react";
import { useBackdropClose } from "./use-modal";
import { cx } from "./cx";
import { useModal } from "./use-modal";
import styles from "./dialog.module.css";

type Props = { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string };

/** Centred modal for decisions (confirm a redemption, discard changes). Closes on Esc and on a backdrop click. */
export function Dialog({ open, onClose, title, description, children, actions, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModal(ref, open);
  const backdrop = useBackdropClose(onClose);
  return <dialog ref={ref} className={cx(styles.dialog, className)} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}
    {...backdrop}>
    <div className={styles.body}>
      <h2 id={titleId} className={styles.title}>{title}</h2>
      {description ? <p id={descriptionId} className={styles.description}>{description}</p> : null}
      {children}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  </dialog>;
}
