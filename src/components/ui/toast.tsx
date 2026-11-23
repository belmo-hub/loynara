"use client";

import { Check, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import styles from "./toast.module.css";

type Tone = "success" | "error" | "info";
type Toast = { id: number; message: ReactNode; tone: Tone; leaving?: boolean };
type Api = { show: (message: ReactNode, options?: { tone?: Tone }) => void };

const ToastContext = createContext<Api | null>(null);
const VISIBLE_MS = 5000;
const EXIT_MS = 160;
const icons = { success: Check, error: TriangleAlert, info: Info } as const;
const portal = (host: HTMLDialogElement | null, node: ReactNode) => host ? createPortal(node, host) : node;

/**
 * Mount once per shell. Announces every toast through one polite live region. The region has no status role, so a
 * page keeps exactly one status message of its own (specs and screen readers rely on that).
 * The region is a manual popover, open while it is mounted: it lives in the top layer, and nothing dismisses it but
 * its own timer or close button. While a modal Sheet or Dialog is open, the region moves into that modal (Design R4,
 * 23 Nov): the page under a modal is inert, so only there is the toast live, tappable and announced. The Kasse dock's
 * offset does not apply inside a modal.
 */
export function ToastProvider({ children, closeLabel = "Hinweis schließen" }: { children?: ReactNode; closeLabel?: string }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const paused = useRef(false);
  const region = useRef<HTMLDivElement>(null);
  // The open modal the region lives in, or null for the page.
  const [host, setHost] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    const el = region.current;
    if (!el || typeof el.showPopover !== "function") return; // no popover support: the fixed region as before
    el.showPopover();
    return () => { if (el.matches(":popover-open")) el.hidePopover(); };
  }, [host]);
  // Back to the page when the modal closes, or when it is unmounted while open (no close event then, Design r2).
  useEffect(() => {
    if (!host) return;
    const back = () => setHost(null);
    const gone = new MutationObserver(() => { if (!host.isConnected) back(); });
    host.addEventListener("close", back);
    gone.observe(document.body, { childList: true, subtree: true });
    return () => { host.removeEventListener("close", back); gone.disconnect(); };
  }, [host]);
  // The live text arrives a frame after the region (re)mounts, so a region that has just moved into a modal is already in
  // the accessibility tree when the first toast speaks (Design r2).
  const latest = toasts.findLast((t) => !t.leaving)?.message;
  const [live, setLive] = useState<ReactNode>(null);
  useEffect(() => {
    let next = 0;
    const first = requestAnimationFrame(() => { setLive(null); next = requestAnimationFrame(() => setLive(latest)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(next); };
  }, [latest, host]);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const show = useCallback<Api["show"]>((message, options) => {
    const id = nextId.current++;
    setHost(document.querySelector<HTMLDialogElement>("dialog:modal"));
    setToasts((all) => [...all.slice(-2), { id, message, tone: options?.tone ?? "success" }]);
  }, []);

  // One timer for the oldest toast; it waits while the region is hovered/focused or the tab is hidden.
  const oldest = toasts.find((t) => !t.leaving);
  useEffect(() => {
    if (!oldest) return;
    let remaining = VISIBLE_MS;
    let started = Date.now();
    const tick = window.setInterval(() => {
      const now = Date.now();
      if (!paused.current && document.visibilityState === "visible") remaining -= now - started;
      started = now;
      if (remaining <= 0) { window.clearInterval(tick); dismiss(oldest.id); }
    }, 250);
    return () => window.clearInterval(tick);
  }, [oldest, dismiss]);

  // After „×“ inside a modal the focus goes back to the modal's own first control, not to the page (Design r2).
  const returnFocus = () => {
    if (!host) return;
    const controls = host.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    [...controls].find(control => !region.current?.contains(control) && !control.hasAttribute("disabled"))?.focus();
  };
  const api = useMemo(() => ({ show }), [show]);
  return <ToastContext.Provider value={api}>
    {children}
    {/* Keyed by its host: moving between the page and a modal mounts the region afresh, shown again on top. */}
    {portal(host, <div key={host ? "modal" : "page"} ref={region} popover="manual" className={styles.region} style={host ? { "--toast-offset": "0px" } as CSSProperties : undefined} onPointerEnter={() => { paused.current = true; }} onPointerLeave={() => { paused.current = false; }} onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }}>
      {toasts.map((t) => { const Icon = icons[t.tone]; return <div key={t.id} className={cx(styles.toast, styles[t.tone], t.leaving && styles.leaving)}>
        <Icon size={20} aria-hidden="true" className={styles.icon} /><span className={styles.message} aria-hidden="true">{t.message}</span>
        <button type="button" className={styles.close} onClick={() => { dismiss(t.id); returnFocus(); }} aria-label={closeLabel}><X size={20} aria-hidden="true" /></button>
      </div>; })}
      <div className={styles.live} aria-live="polite" aria-atomic="true">{live}</div>
    </div>)}
  </ToastContext.Provider>;
}

export function useToast(): Api {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a ToastProvider (mounted by every shell)");
  return api;
}
