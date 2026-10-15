"use client";

import { useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";

/**
 * Opens and closes a native <dialog> as a modal (focus trap, Esc, inert page) to match `open`. close() hands focus back
 * to the control that opened it; a dialog that is unmounted while open (rendered conditionally, as the cashier's
 * confirmation is) never gets there, so the hook remembers the opener and returns focus itself.
 */
export function useModal(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [ref, open]);
  useEffect(() => () => {
    const target = opener.current, active = document.activeElement;
    if (target?.isConnected && (!active || active === document.body || !active.isConnected)) target.focus();
  }, []);
}

/** Backdrop click that ignores text selections which merely end outside the panel. */
export function useBackdropClose(onClose: () => void) {
  const pressedOnBackdrop = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => { pressedOnBackdrop.current = event.target === event.currentTarget; },
    onClick: (event: MouseEvent<HTMLDialogElement>) => { if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose(); pressedOnBackdrop.current = false; },
  };
}
