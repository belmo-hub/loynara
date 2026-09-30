"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import type { NavIconName } from "./nav";

type IconName = NavIconName | "menu" | "close" | "check" | "plus" | "till" | "alert" | "info" | "phone" | "eye" | "pencil";
const PATHS: Record<IconName, ReactNode> = {
  home: <><path d="M4 11 12 4l8 7" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></>,
  loyalty: <><rect x="3" y="6" width="18" height="12" rx="3" /><circle cx="8.5" cy="12" r="1.6" /><circle cx="13" cy="12" r="1.6" /><path d="M17 12h.01" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><path d="M16 5.2a3 3 0 0 1 0 5.6" /><path d="M17.5 14.6c1.7.5 2.7 2 3 4.4" /></>,
  megaphone: <><path d="M4 10v4h3l7 4V6L7 10H4Z" /><path d="M17.5 9.5a3.5 3.5 0 0 1 0 5" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  till: <><rect x="4" y="9" width="16" height="10" rx="2" /><path d="M7 9V5h10v4" /><path d="M8 14h3" /></>,
  alert: <><path d="M12 4 3 19h18L12 4Z" /><path d="M12 10v4M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 18h2" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  pencil: <><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19l-4 1Z" /></>,
};

export function OwnerIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{PATHS[name]}</svg>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal dialog: focus moves in, Tab stays inside, Escape closes, focus returns to the trigger. */
export function OwnerDialog({ title, children, actions, onClose, tone = "default" }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void; tone?: "default" | "danger" }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box.current)?.focus();
    return () => { if (previous && document.contains(previous)) previous.focus(); };
  }, []);
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
    if (event.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return (
    <div className="ow-dialog-scrim" onKeyDown={onKeyDown} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={box} className="ow-dialog" role={tone === "danger" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        <div className="ow-stack" style={{ gap: 8 }}>{children}</div>
        <div className="ow-dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";
const SAVE_LABEL: Record<SaveState, string> = { clean: "", dirty: "Ungespeicherte Änderungen", saving: "Speichern …", saved: "Gespeichert", error: "Speichern fehlgeschlagen" };

/** Consistent save pattern: nothing material is saved silently, the state is always visible and announced. */
export function SaveBar({ state, onSave, onDiscard, canSave = true, saveLabel = "Speichern", detail }: { state: SaveState; onSave: () => void; onDiscard?: () => void; canSave?: boolean; saveLabel?: string; detail?: string }) {
  const busy = state === "saving";
  return (
    <div className="ow-savebar" data-idle={state === "clean" || undefined}>
      <span className="ow-savestate" data-state={state} role="status" aria-live="polite">
        {state !== "clean" && <><span className="ow-dot" aria-hidden="true" />{SAVE_LABEL[state]}</>}
        {state === "clean" && <span className="ow-muted">Keine Änderungen</span>}
        {detail && state !== "clean" && <span className="ow-muted" style={{ fontWeight: 500 }} role={state === "error" ? "alert" : undefined}>{detail}</span>}
      </span>
      <span className="ow-row">
        {onDiscard && <button type="button" className="ow-btn ow-btn--ghost" onClick={onDiscard} disabled={busy || state === "clean" || state === "saved"}>Verwerfen</button>}
        <button type="button" className="ow-btn ow-btn--primary" onClick={onSave} disabled={busy || !canSave || state === "clean" || state === "saved"} aria-busy={busy}>{busy ? "Speichern …" : saveLabel}</button>
      </span>
    </div>
  );
}

export function Notice({ tone = "info", children, actions, role }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode; actions?: ReactNode; role?: "alert" | "status" }) {
  const icon = tone === "danger" || tone === "warn" ? "alert" : tone === "ok" ? "check" : "info";
  return <div className={`ow-notice${tone === "info" ? "" : ` ow-notice--${tone}`}`} role={role ?? (tone === "danger" ? "alert" : undefined)}><span style={{ marginTop: 2 }}><OwnerIcon name={icon} size={18} /></span><div style={{ minWidth: 0 }}>{children}{actions && <div className="ow-notice-actions">{actions}</div>}</div></div>;
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) { return <div className="ow-skel" style={{ height, width }} aria-hidden="true" />; }

export const nf = new Intl.NumberFormat("de-DE");
export function germanDate(value: string, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", withTime ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
