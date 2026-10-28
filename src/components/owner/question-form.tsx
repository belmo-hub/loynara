"use client";

import { Check, ChevronLeft, type LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClientApiError, postJson } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "./owner-context";
import { GuardedLink } from "./owner-shell";
import { Notice, OwnerIcon } from "./owner-ui";
import { markSaved } from "./program-list";

/** After a save: fresh account values, then back on the list with `row` outlined (Design rule 10), by default this page's,
 *  and the toast's words if the save was more than a save. */
export function useBackToList() {
  const owner = useOwner(), router = useRouter(), path = usePathname();
  return (row = path, toast?: string) => void owner.refresh().then(() => { markSaved(row, path, toast); router.push("/merchant/program", { scroll: false }); });
}

// Server diagnostics stay off the page: a lost connection or a rate limit says what to do (client-api), and the server's
// German checks of a challenge or levels name the field to fix. Anything else is the live W25 text.
const failure = (cause: unknown) => cause instanceof ClientApiError && (cause.status === 0 || cause.status === 429 || cause.code === "INVALID_CHALLENGE" || cause.code === "INVALID_LEVELS")
  ? cause.message : "Die Einstellungen konnten nicht gespeichert werden.";

/** The setup's own wording for a whole number out of range („Bitte eine ganze Zahl von 1 bis 1000 eingeben.“). */
export const rangeError = (min: number, max: number) => `Bitte eine ganze Zahl von ${min} bis ${max} eingeben.`;
export const wholeIn = (draft: string, min: number, max: number) => /^\d+$/.test(draft) && Number(draft) >= min && Number(draft) <= max;

/**
 * One question's save (N-3): it posts only its own fields, and an unchanged answer goes back to the list without a save.
 * `problems` maps a field id to what is wrong with it; the first one takes the focus, and each shows under its field from
 * the first tap on the button on (screen 18). The leave guard holds while the answer is changed and not being saved.
 */
export function useQuestion(key: string, changed: boolean, problems: Record<string, string> = {}) {
  const done = useBackToList(), router = useRouter();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(""), [tried, setTried] = useState(false);
  useDirtyGuard(key, !busy && changed);
  const leave = () => router.push("/merchant/program", { scroll: false });
  /** True when every field is fine; else the first problem takes the focus. */
  function check() {
    const first = Object.keys(problems).find(id => problems[id]);
    if (first) { setTried(true); document.getElementById(first)?.focus(); }
    return !first;
  }
  /** `action` is a save that replaces the answer („Neuigkeit entfernen“): it saves as it stands, and the toast says `action`. */
  async function save(url: string, body: object, action?: string) {
    if (busy) return;
    if (!action && !changed) { leave(); return; }
    if (!action && !check()) return;
    setBusy(true); setFailed("");
    try { await postJson(url, body); done(undefined, action); } catch (cause) { setFailed(failure(cause)); setBusy(false); }
  }
  return { busy, failed, check, save, leave, error: (id: string) => (tried && problems[id]) || "" };
}

/** A question page (Wegweiser 08–16, 18, 19): the question as the heading, the answer on panels, one button at the thumb. */
export function QuestionForm({ title, lead, back, busy, failed, action = "Speichern", onSubmit, children }: {
  title: string; lead?: ReactNode; /** A review step goes back to its question instead of the list. */ back?: { label: string; onClick: () => void };
  busy: boolean; failed: string; action?: string; onSubmit: () => void; children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null), fail = useRef<HTMLDivElement>(null), shown = useRef(title);
  useEffect(() => { if (shown.current !== title) { shown.current = title; heading.current?.focus(); } }, [title]);
  useEffect(() => { if (failed) fail.current?.scrollIntoView({ block: "nearest" }); }, [failed]);
  const arrow = <ChevronLeft size={20} aria-hidden="true" />;
  return (
    <div className="ow-page ow-qpage">
      <header className="ow-pagehead"><div className="ow-qhead">
        {back ? <button type="button" className="ow-back" onClick={back.onClick}>{arrow}{back.label}</button> : <GuardedLink href="/merchant/program" className="ow-back">{arrow}Programm</GuardedLink>}
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
        {lead && <p>{lead}</p>}
      </div></header>
      <form className="ow-q" noValidate onSubmit={event => { event.preventDefault(); onSubmit(); }}>
        {children}
        {failed && <div ref={fail} className="ow-qfail"><Notice tone="danger" role="alert"><strong>Speichern fehlgeschlagen</strong>{failed} Deine Änderungen sind noch da.</Notice></div>}
        {/* Not disabled while saving: the button keeps the focus, and a second tap does nothing (`busy`). */}
        <div className="ow-qsave"><button type="submit" className="ow-btn ow-btn--primary" aria-busy={busy}>{busy ? "Speichern …" : action}</button></div>
      </form>
    </div>
  );
}

export const FieldError = ({ id, children }: { id: string; children: string }) =>
  children ? <p id={id} className="ow-error ow-qerror" role="alert"><OwnerIcon name="alert" size={18} />{children}</p> : null;

export type Choice = { value: string; label: string; sub?: string; icon: LucideIcon };
/** One answer out of a few, as rows (screens 08, 16, 33). The picked row says „Wie bisher“, or „Neu gewählt“ before it is saved (W25). */
export function Choices({ name, label, options, value, saved, onChange }: { name: string; label: string; options: Choice[]; value: string; saved: string; onChange: (value: string) => void }) {
  return (
    <fieldset className="ow-qchoices">
      <legend className="ow-sr">{label}</legend>
      {options.map(({ icon: Icon, ...option }) => {
        const sub = option.sub ?? (option.value !== value ? "" : value === saved ? "Wie bisher" : "Neu gewählt");
        return <label key={option.value} className="ow-qchoice">
          <input type="radio" className="ow-sr" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
          <span className="ow-prog-icon"><Icon size={22} aria-hidden="true" /></span>
          <span className="ow-prog-text"><strong>{option.label}</strong>{sub && <small>{sub}</small>}</span>
          {option.value === value && <Check className="ow-qchoice-check" size={22} aria-hidden="true" />}
        </label>;
      })}
    </fieldset>
  );
}

/** On or off for a whole setting (screens 09–11); what it switches shows below only while it is on. */
export const SwitchRow = ({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (on: boolean) => void }) =>
  <label className="ow-qpanel ow-check ow-qswitch"><span className="ow-prog-text"><strong>{label}</strong><small>{sub}</small></span><input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} /></label>;

/** A labelled value on a panel: the label and its control share a line while they fit, the limit or the error under them. */
export const Control = ({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error: string; children: ReactNode }) => (
  <div className="ow-qpanel ow-qcontrol">
    <div><label htmlFor={id}>{label}</label>{children}</div>
    {error ? <FieldError id={`${id}-hint`}>{error}</FieldError> : hint && <p id={`${id}-hint`} className="ow-hint">{hint}</p>}
  </div>
);
