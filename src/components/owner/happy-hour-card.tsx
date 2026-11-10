"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { MeResponse } from "@/components/client-api";
import { MoreInfo, Notice, OwnerIcon } from "./owner-ui";
import { PROGRAM_HOME, QuestionForm, SwitchRow, useQuestion, type QuestionHome } from "./question-form";
import { HAPPY_HOUR_MAX_WINDOWS, happyHourProblem, happyHourSentence, type HappyHourWindow } from "@/lib/happy-hour";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DEFAULT_WINDOW: HappyHourWindow = { days: [1, 2, 3, 4, 5], start: "14:00", end: "17:00" };
// Live words, Design's drafts (copy-drafts.md, Happy Hour) and Marketing's C-05 (30 Oct) for a list left empty.
export const HAPPY_HOUR_PROBLEM = {
  NONE: "Lege mindestens ein Zeitfenster fest oder schalte Happy Hour aus.",
  SHAPE: "Keine Tage gewählt",
  TIME: "Bitte Beginn und Ende angeben.",
  MIDNIGHT: "Das Ende muss nach dem Beginn liegen. Für eine Zeit über Mitternacht lege zwei Zeitfenster an.",
} as const;

export type HappyHourDraft = { enabled: boolean; windows: HappyHourWindow[] };

/** What stops a save: no window left while on, else the first window that is wrong, with its problem. Off saves as it is. */
export function happyHourDraftProblem(draft: HappyHourDraft): { window: number; problem: keyof typeof HAPPY_HOUR_PROBLEM } | null {
  if (!draft.enabled) return null;
  if (draft.windows.length === 0) return { window: -1, problem: "NONE" };
  for (const [index, w] of draft.windows.entries()) {
    const problem = happyHourProblem([w]);
    if (problem === "SHAPE" || problem === "TIME" || problem === "MIDNIGHT") return { window: index, problem };
  }
  return null;
}

/** Switching on with no window starts with the default one (Design's audit), so the editor never opens empty. */
export const switchHappyHour = (draft: HappyHourDraft, enabled: boolean): HappyHourDraft =>
  ({ enabled, windows: enabled && draft.windows.length === 0 ? [DEFAULT_WINDOW] : draft.windows });

/**
 * Happy Hour (Design's audit, 6 Nov): the switch, one panel per window with the seven days and the two times, then the
 * pinned Speichern. The server books it only for purchase-amount awards (loyalty.ts), so a manual-points shop gets the
 * notice instead of an editor. The server checks every value again.
 */
export function HappyHourQuestion({ me, home = PROGRAM_HOME }: { me: MeResponse; home?: QuestionHome }) {
  const saved: HappyHourDraft = { enabled: me.happyHourEnabled ?? false, windows: me.happyHourWindows ?? [] };
  const [draft, setDraft] = useState(saved);
  const problem = happyHourDraftProblem(draft);
  const q = useQuestion("happy-hour", JSON.stringify(draft) !== JSON.stringify(saved), {}, home);
  if (me.earningMode !== "purchase") return (
    <QuestionForm title="Happy Hour" home={home} busy={false} failed="" action="" onSubmit={() => {}}>
      <Notice>Happy Hour geht nur, wenn Punkte nach Einkaufswert entstehen.</Notice>
      <div><Link className="ow-btn ow-btn--secondary ow-btn--sm" href="/merchant/program/earning">So entstehen Punkte</Link></div>
    </QuestionForm>
  );
  const setWindow = (index: number, patch: Partial<HappyHourWindow>) => setDraft({ ...draft, windows: draft.windows.map((w, i) => i === index ? { ...w, ...patch } : w) });
  const toggleDay = (index: number, day: number) => { const days = draft.windows[index].days; setWindow(index, { days: days.includes(day) ? days.filter(d => d !== day) : [...days, day].sort() }); };
  return (
    <QuestionForm title="Happy Hour" home={home} busy={q.busy} failed={q.failed} disabled={problem !== null}
      onSubmit={() => void q.save("/api/merchant/program/happy-hour", { programId: me.programId, happyHourEnabled: draft.enabled, happyHourWindows: draft.windows })}>
      <SwitchRow label="Doppelte Punkte" sub="Zu ruhigen Zeiten, automatisch" checked={draft.enabled} onChange={enabled => setDraft(switchHappyHour(draft, enabled))} />
      {draft.enabled && <>
        {draft.windows.map((w, index) => {
          const own = problem?.window === index ? problem.problem : null, label = happyHourSentence(w), error = own === "TIME" || own === "MIDNIGHT" ? `hh-error-${index}` : undefined;
          return (
            // A group, not a fieldset: WebKit draws a fieldset's legend outside a grid panel.
            <div key={index} className="ow-qpanel ow-window" role="group" aria-labelledby={`hh-window-${index}`}>
              {own === "SHAPE" ? <p id={`hh-window-${index}`} className="ow-window-title" data-problem aria-live="polite"><OwnerIcon name="alert" size={16} />{HAPPY_HOUR_PROBLEM.SHAPE}</p> : <p id={`hh-window-${index}`} className="ow-window-title" aria-live="polite">{label}</p>}
              {draft.windows.length > 1 && <button type="button" className="ow-iconbtn" aria-label={`Zeitfenster ${index + 1} entfernen`} onClick={() => setDraft({ ...draft, windows: draft.windows.filter((_, i) => i !== index) })}><Trash2 aria-hidden="true" /></button>}
              <div className="ow-days" role="group" aria-label="Wochentage">
                {DAYS.map((name, d) => <button key={name} type="button" aria-pressed={w.days.includes(d + 1)} onClick={() => toggleDay(index, d + 1)}>{name}</button>)}
              </div>
              <div className="ow-times">
                <label>Von<input className="ow-input" type="time" value={w.start} aria-invalid={own === "TIME" || undefined} aria-describedby={own === "TIME" ? error : undefined} onChange={event => setWindow(index, { start: event.target.value })} /></label>
                <label>Bis<input className="ow-input" type="time" value={w.end} aria-invalid={own === "TIME" || own === "MIDNIGHT" || undefined} aria-describedby={error} onChange={event => setWindow(index, { end: event.target.value })} /></label>
              </div>
              {(own === "TIME" || own === "MIDNIGHT") && <p id={error} className="ow-sent-warn" role="alert"><OwnerIcon name="alert" size={16} />{HAPPY_HOUR_PROBLEM[own]}</p>}
            </div>
          );
        })}
        {problem?.problem === "NONE" && <p className="ow-error ow-qerror" role="alert"><OwnerIcon name="alert" size={18} />{HAPPY_HOUR_PROBLEM.NONE}</p>}
        {draft.windows.length < HAPPY_HOUR_MAX_WINDOWS && <div><button type="button" className="ow-add" onClick={() => setDraft({ ...draft, windows: [...draft.windows, DEFAULT_WINDOW] })}><Plus aria-hidden="true" />Zeitfenster hinzufügen</button></div>}
        <MoreInfo><p>Nicht für offline gebuchte Einkäufe.</p></MoreInfo>
      </>}
    </QuestionForm>
  );
}
