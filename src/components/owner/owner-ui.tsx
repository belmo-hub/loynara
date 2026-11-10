"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Check, Eye, House, Info, Megaphone, Menu, Minus, Pencil, Plus, ScanLine, Settings, SlidersHorizontal, Smartphone, TriangleAlert, Users, X, type LucideIcon } from "lucide-react";
import type { NavIconName } from "./nav";

// The dashboard draws the same lucide set as the guest, cashier and sign-in pages, at lucide's default stroke (2);
// only the current sidebar item and tab draw theirs at 2.5 (owner.css), since lucide has no filled variants.
type IconName = NavIconName | "menu" | "close" | "check" | "plus" | "minus" | "till" | "alert" | "info" | "phone" | "eye" | "pencil";
const ICONS: Record<IconName, LucideIcon> = {
  home: House, loyalty: SlidersHorizontal, users: Users, megaphone: Megaphone, gear: Settings,
  menu: Menu, close: X, check: Check, plus: Plus, minus: Minus, till: ScanLine, alert: TriangleAlert, info: Info, phone: Smartphone, eye: Eye, pencil: Pencil,
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
        <div className="ow-stack ow-stack--tight">{children}</div>
        <div className="ow-dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";
const SAVE_LABEL: Record<SaveState, string> = { clean: "", dirty: "Ungespeicherte Änderungen", saving: "Speichern …", saved: "Gespeichert", error: "Speichern fehlgeschlagen" };

/** Consistent save pattern: nothing material is saved silently, the state is always visible and announced. */
export function SaveBar({ state, errorLabel, onSave, onDiscard, canSave = true, saveLabel = "Speichern", detail, asSubmit = false, alwaysDiscard = false, discardLabel = "Verwerfen", section }: { state: SaveState; /** Names the card while unsaved, where several cards share a page. */ section?: string; errorLabel?: string; onSave?: () => void; onDiscard?: () => void; canSave?: boolean; saveLabel?: string; detail?: string; asSubmit?: boolean; alwaysDiscard?: boolean; discardLabel?: string }) {
  const busy = state === "saving", shown = state !== "clean";
  // On phones the bar pins over the page's foot with the first change: the field being edited moves above it (owner.css).
  useEffect(() => { const field = document.activeElement; if (shown && field instanceof HTMLElement && field !== document.body) field.scrollIntoView({ block: "nearest" }); }, [shown]);
  return (
    <div className="ow-savebar" data-idle={state === "clean" || undefined}>
      <span className="ow-savestate" data-state={state} role="status" aria-live="polite">
        {state !== "clean" && <><span className="ow-dot" aria-hidden="true" /><span className="ow-savestate-label">{state === "error" && errorLabel ? errorLabel : state === "dirty" && section ? `${SAVE_LABEL.dirty}: ${section}` : SAVE_LABEL[state]}</span></>}
        {state === "clean" && <span className="ow-muted">Keine Änderungen</span>}
        {detail && state !== "clean" && <span className="ow-muted ow-savestate-detail" role={state === "error" ? "alert" : undefined}>{detail}</span>}
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
  return <div className={`ow-notice${tone === "info" ? "" : ` ow-notice--${tone}`}`} role={role ?? (tone === "danger" ? "alert" : undefined)}><span><OwnerIcon name={icon} size={18} /></span><div>{children}{actions && <div className="ow-notice-actions">{actions}</div>}</div></div>;
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) { return <div className="ow-skel" style={{ height, width }} aria-hidden="true" />; }

export const nf = new Intl.NumberFormat("de-DE");

/** Inside a plain `Link` row: marks the row from the tap until its screen shows, as `GuardedLink` does by itself (owner.css). */
export function LinkPending() {
  return useLinkStatus().pending ? <span data-pending="" hidden /> : null;
}
export { germanDate } from "@/lib/german-date";

/** Secondary detail behind one tap, so the page leads with its action. Text inside stays word for word. */
export function MoreInfo({ summary = "Mehr dazu", children }: { summary?: string; children: ReactNode }) {
  return <details className="ow-more"><summary>{summary}</summary><div className="ow-more-body">{children}</div></details>;
}

/** `back`: the link to the list a page was opened from („‹ Aktionen“), above the heading; no eyebrow or kicker (SF-5). */
export function PageHead({ title, lead, actions, back }: { title: string; lead?: string; actions?: ReactNode; back?: ReactNode }) {
  return <header className="ow-pagehead"><div>{back}<h1>{title}</h1>{lead && <p>{lead}</p>}</div>{actions && <div className="ow-row">{actions}</div>}</header>;
}

/** Shared read-failure block: says what failed, keeps the page usable and offers one retry. */
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <Notice tone="danger" role="alert" actions={onRetry ? <button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={onRetry}>Erneut laden</button> : undefined}>{message}</Notice>;
}

export function LoadingBlock({ rows = 2, height = 96 }: { rows?: number; height?: number }) {
  return <div className="ow-stack" role="status" aria-label="Wird geladen">{Array.from({ length: rows }, (_, index) => <Skeleton key={index} height={height} />)}</div>;
}

export type NumberUnit = { one: string; many: string };
type NumberShape = { min: number; max: number; unit: NumberUnit; bonus?: boolean; offAtZero?: boolean };

/** What the stepper shows for a typed draft: „30 Tage“, „+1 Stempel“, „Aus“. Null while the draft is not a whole number. */
export function numberText(draft: string, { unit, bonus = false, offAtZero = false }: NumberShape) {
  if (!/^\d+$/.test(draft)) return null;
  const n = Number(draft);
  if (offAtZero && n === 0) return { value: "Aus", unit: "", text: "Aus" };
  const value = bonus && n > 0 ? `+${n}` : String(n), name = n === 1 ? unit.one : unit.many;
  return { value, unit: name, text: `${value} ${name}` };
}

/** One step from a typed draft, kept inside the limits; a draft that is not a number starts from the lower limit. */
export const stepValue = (draft: string, by: number, { min, max }: { min: number; max: number }) =>
  String(Math.min(max, Math.max(min, (/^\d+$/.test(draft) ? Number(draft) : min) + by)));

/** − value + (owner-fields spec §3): the value stays a typed field, the buttons step by `stepSize` (one unless given) and stop at the limits. */
export function NumberStepper({ id, value, onChange, describedBy, invalid = false, stepSize = 1, ...shape }: NumberShape & { id: string; value: string; onChange: (next: string) => void; describedBy?: string; invalid?: boolean; stepSize?: number }) {
  const { min, max, unit } = shape;
  const shown = numberText(value, shape);
  const n = shown ? Number(value) : null;
  const step = (direction: 1 | -1) => onChange(stepValue(value, direction * stepSize, shape));
  const by = `${stepSize} ${stepSize === 1 ? unit.one : unit.many}`; // „1 Tag“, „10 Punkte“
  // The field keeps showing „+2“ or „Aus“ while it is typed in; only its digits count, so typing over either works.
  const display = shown ? shown.value : value, unitShown = shown ? shown.unit : unit.many;
  return (
    <div className="ow-number" data-invalid={invalid || undefined}>
      <button type="button" aria-label={`${by} weniger`} aria-controls={id} disabled={n !== null && n <= min} onClick={() => step(-1)}><OwnerIcon name="minus" /></button>
      <span className="ow-number-value">
        <input id={id} role="spinbutton" inputMode="numeric" autoComplete="off" value={display} style={{ "--ow-number-chars": Math.max(1, display.length) } as React.CSSProperties}
          aria-valuemin={min} aria-valuemax={max} aria-valuenow={n ?? undefined} aria-valuetext={shown?.text} aria-invalid={invalid} aria-describedby={describedBy}
          onFocus={event => event.currentTarget.select()}
          onChange={event => onChange(event.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); step(event.key === "ArrowUp" ? 1 : -1); } }} />
        {unitShown && <span aria-hidden="true">{unitShown}</span>}
      </span>
      <button type="button" aria-label={`${by} mehr`} aria-controls={id} disabled={n !== null && n >= max} onClick={() => step(1)}><OwnerIcon name="plus" /></button>
    </div>
  );
}

/** „So steht es auf der Karte“ (owner-fields spec §6): the line as the customer sees it, on a mini card in a grey inset. */
export function CardLinePreview({ label, shop, brandColor, children, rules }: { label: string; shop: string; brandColor?: string; children: ReactNode; rules?: string }) {
  const labelId = useId();
  return (
    <div className="ow-cardline" role="group" aria-labelledby={labelId}>
      <p id={labelId} className="ow-cardline-label">{label}</p>
      <div className="ow-cardline-ground">
        <div className="ow-cardline-card">
          {/* The shop's own colour, as on the customer card: the one value here that is not a token. */}
          <p className="ow-cardline-shop"><i aria-hidden="true" style={brandColor ? { backgroundColor: brandColor } : undefined} />{shop}</p>
          <p className="ow-cardline-text">{children}</p>
          {rules && <p className="ow-cardline-rules">{rules}</p>}
        </div>
      </div>
    </div>
  );
}
