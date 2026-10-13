"use client";

import { useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";

/** Opens and closes a native <dialog> as a modal (focus trap, Esc, inert page) to match `open`. */
export function useModal(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [ref, open]);
}

/** Backdrop click that ignores text selections which merely end outside the panel. */
export function useBackdropClose(onClose: () => void) {
  const pressedOnBackdrop = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => { pressedOnBackdrop.current = event.target === event.currentTarget; },
    onClick: (event: MouseEvent<HTMLDialogElement>) => { if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose(); pressedOnBackdrop.current = false; },
  };
}
