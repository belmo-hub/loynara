"use client";

import { useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";

/**
 * After a dialog disappeared while open: back to the opener if it can take focus; if it is disabled while its action
 * runs, park on <main> and return to the opener once it is usable again (unless the user has moved on); if it is gone,
 * stay on <main>. Focus that something else already placed is left alone. Self-contained (no outer references), so
 * e2e/focus-restore.spec.ts can run this exact function in a bare page.
 */
export function restoreFocus(opener: HTMLElement | null) {
  const unusable = (element: HTMLElement) => (element as HTMLButtonElement).disabled === true || element.getAttribute("aria-disabled") === "true";
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  if (opener?.isConnected && !unusable(opener)) { opener.focus(); return; }
  // Park on the page's main region (made focusable for this) so keyboard users are not left on <body>.
  const parked = document.querySelector<HTMLElement>("main");
  if (parked) {
    if (!parked.hasAttribute("tabindex")) parked.setAttribute("tabindex", "-1");
    parked.focus({ preventScroll: true });
  }
  if (!opener?.isConnected) return;
  const observer = new MutationObserver(() => {
    if (!opener.isConnected) { observer.disconnect(); return; }
    if (unusable(opener)) return;
    observer.disconnect();
    const now = document.activeElement;
    if (!now || now === document.body || now === parked) opener.focus();
  });
  observer.observe(opener, { attributes: true, attributeFilter: ["disabled", "aria-disabled"] });
  window.setTimeout(() => observer.disconnect(), 30_000);
}

/**
 * Opens and closes a native <dialog> as a modal (focus trap, Esc, inert page) to match `open`. close() hands focus back
 * to the control that opened it; a dialog that is unmounted while open (rendered conditionally, as the cashier's
 * confirmation is) never gets there, so the hook remembers the opener and calls restoreFocus.
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
  useEffect(() => () => restoreFocus(opener.current), []);
}

/** Backdrop click that ignores text selections which merely end outside the panel. */
export function useBackdropClose(onClose: () => void) {
  const pressedOnBackdrop = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => { pressedOnBackdrop.current = event.target === event.currentTarget; },
    onClick: (event: MouseEvent<HTMLDialogElement>) => { if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose(); pressedOnBackdrop.current = false; },
  };
}
