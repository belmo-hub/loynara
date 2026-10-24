"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Check, CircleAlert, Eye, House, Info, Megaphone, Menu, Pencil, Plus, ScanLine, Settings, Smartphone, Stamp, Users, X, type LucideIcon } from "lucide-react";
import type { NavIconName } from "./nav";

// The dashboard draws the same lucide set as the guest, cashier and sign-in pages, at lucide's default stroke.
type IconName = NavIconName | "menu" | "close" | "check" | "plus" | "till" | "alert" | "info" | "phone" | "eye" | "pencil";
const ICONS: Record<IconName, LucideIcon> = {
  home: House, loyalty: Stamp, users: Users, megaphone: Megaphone, gear: Settings,
  menu: Menu, close: X, check: Check, plus: Plus, till: ScanLine, alert: CircleAlert, info: Info, phone: Smartphone, eye: Eye, pencil: Pencil,
};

export function OwnerIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const Icon = ICONS[name];
  return <Icon size={size} aria-hidden="true" focusable="false" />;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal dialog: focus moves in, Tab stays inside, Escape closes, focus returns to the trigger. */
export function OwnerDialog({ title, children, actions, onClose, tone = "default" }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void; tone?: "default" | "danger" }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box.current)?.focus({ preventScroll: true });
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
export function SaveBar({ state, errorLabel, onSave, onDiscard, canSave = true, saveLabel = "Speichern", detail, asSubmit = false, alwaysDiscard = false, discardLabel = "Verwerfen" }: { state: SaveState; errorLabel?: string; onSave?: () => void; onDiscard?: () => void; canSave?: boolean; saveLabel?: string; detail?: string; asSubmit?: boolean; alwaysDiscard?: boolean; discardLabel?: string }) {
  const busy = state === "saving";
  return (
    <div className="ow-savebar" data-idle={state === "clean" || undefined}>
      <span className="ow-savestate" data-state={state} role="status" aria-live="polite">
        {state !== "clean" && <><span className="ow-dot" aria-hidden="true" />{state === "error" && errorLabel ? errorLabel : SAVE_LABEL[state]}</>}
        {state === "clean" && <span className="ow-muted">Keine Änderungen</span>}
        {detail && state !== "clean" && <span className="ow-muted" style={{ fontWeight: 500 }} role={state === "error" ? "alert" : undefined}>{detail}</span>}
      </span>
      <span className="ow-row">
        {onDiscard && <button type="button" className="ow-btn ow-btn--ghost" onClick={onDiscard} disabled={busy || (!alwaysDiscard && (state === "clean" || state === "saved"))}>{discardLabel}</button>}
        <button type={asSubmit ? "submit" : "button"} className="ow-btn ow-btn--primary" onClick={asSubmit ? undefined : onSave} disabled={busy || !canSave || state === "clean" || state === "saved"} aria-busy={busy}>{busy ? "Speichern …" : saveLabel}</button>
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

/** Secondary detail behind one tap, so the page leads with its action. Text inside stays word for word. */
export function MoreInfo({ summary = "Mehr dazu", children }: { summary?: string; children: ReactNode }) {
  return <details className="ow-more"><summary>{summary}</summary><div className="ow-more-body">{children}</div></details>;
}

export function PageHead({ eyebrow, title, lead, actions }: { eyebrow?: string; title: string; lead?: string; actions?: ReactNode }) {
  return <header className="ow-pagehead"><div>{eyebrow && <p className="ow-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{lead && <p>{lead}</p>}</div>{actions && <div className="ow-row">{actions}</div>}</header>;
}

/** Shared read-failure block: says what failed, keeps the page usable and offers one retry. */
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <Notice tone="danger" role="alert" actions={onRetry ? <button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={onRetry}>Erneut laden</button> : undefined}>{message}</Notice>;
}

export function LoadingBlock({ rows = 2, height = 96 }: { rows?: number; height?: number }) {
  return <div className="ow-stack" role="status" aria-label="Wird geladen">{Array.from({ length: rows }, (_, index) => <Skeleton key={index} height={height} />)}</div>;
}
