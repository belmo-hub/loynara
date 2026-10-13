"use client";

import { Check, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./toast.module.css";

type Tone = "success" | "error" | "info";
type Toast = { id: number; message: ReactNode; tone: Tone; leaving?: boolean };
type Api = { show: (message: ReactNode, options?: { tone?: Tone }) => void };

const ToastContext = createContext<Api | null>(null);
const VISIBLE_MS = 5000;
const EXIT_MS = 160;
const icons = { success: Check, error: TriangleAlert, info: Info } as const;

/** Mount once per shell. Announces every toast through one polite live region. */
export function ToastProvider({ children, closeLabel = "Hinweis schließen" }: { children?: ReactNode; closeLabel?: string }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const paused = useRef(false);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const show = useCallback<Api["show"]>((message, options) => {
    const id = nextId.current++;
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

  const api = useMemo(() => ({ show }), [show]);
  return <ToastContext.Provider value={api}>
    {children}
    <div className={styles.live} role="status" aria-live="polite">{toasts.findLast((t) => !t.leaving)?.message}</div>
    <div className={styles.region} onPointerEnter={() => { paused.current = true; }} onPointerLeave={() => { paused.current = false; }} onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }}>
      {toasts.map((t) => { const Icon = icons[t.tone]; return <div key={t.id} className={cx(styles.toast, styles[t.tone], t.leaving && styles.leaving)}>
        <Icon size={18} aria-hidden="true" className={styles.icon} /><span className={styles.message} aria-hidden="true">{t.message}</span>
        <button type="button" className={styles.close} onClick={() => dismiss(t.id)} aria-label={closeLabel}><X size={18} aria-hidden="true" /></button>
      </div>; })}
    </div>
  </ToastContext.Provider>;
}

export function useToast(): Api {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a ToastProvider (mounted by every shell)");
  return api;
}
