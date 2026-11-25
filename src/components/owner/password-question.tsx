"use client";

import { useState } from "react";
import { CONNECTION_LOST, PASSWORD_MAX, PASSWORD_MIN } from "@/components/auth/auth-errors";
import { authClient } from "@/lib/auth-client";
import { useDirtyGuard } from "./owner-context";
import { MoreLabel } from "./owner-rows";
import { FieldError, QuestionForm, useBackToList, type QuestionHome } from "./question-form";

/** Konto's „Passwort ändern“ row and the list its saved outline and outcome line return to. */
export const PASSWORD_PATH = "/merchant/more/passwort";
export const MORE_HOME: QuestionHome = { href: "/merchant/more", label: <MoreLabel />, list: "owner-mehr-return" };

type Draft = { current: string; next: string; others: boolean };
const aria = (id: string, error: string, hint?: string) => ({ "aria-invalid": error ? true : undefined, "aria-describedby": [hint, error && `${id}-error`].filter(Boolean).join(" ") || undefined });

// Sign-up's words for the same limits (auth-errors); the field's maxLength keeps a typed password within the maximum.
const TOO_SHORT = `Das Passwort ist zu kurz. Es braucht mindestens ${PASSWORD_MIN} Zeichen.`;
const TOO_LONG = `Das Passwort ist zu lang. Es darf höchstens ${PASSWORD_MAX} Zeichen haben.`;

/** What is wrong with each field before anything is sent. */
const passwordProblems = (draft: Draft): Record<string, string> =>
  ({ "pw-current": draft.current ? "" : "Gib dein aktuelles Passwort ein.", "pw-next": draft.next.length < PASSWORD_MIN ? TOO_SHORT : "" });

/** Better Auth's refusal as a sentence: a wrong current password goes under its field, everything else above the button. */
function passwordFailure(error: { status?: number; code?: string }): { field?: string; text: string } {
  if (error.code === "INVALID_PASSWORD") return { field: "pw-current", text: "Das aktuelle Passwort stimmt nicht." };
  if (error.code === "PASSWORD_TOO_SHORT") return { field: "pw-next", text: TOO_SHORT };
  if (error.code === "PASSWORD_TOO_LONG") return { field: "pw-next", text: TOO_LONG };
  // No password on the account (none can be made without one today): the reset link sets one.
  if (error.code === "CREDENTIAL_ACCOUNT_NOT_FOUND") return { text: "Dein Konto hat noch kein Passwort. Melde dich ab und lege über „Passwort vergessen?“ eins fest." };
  if (error.status === 429) return { text: "Zu viele Versuche. Warte bitte etwas und versuche es erneut." };
  return { text: "Das Passwort wurde nicht geändert. Versuche es erneut." };
}

/** ENG-379: change the password while signed in, through Better Auth's own /change-password. This device stays signed in. */
export function PasswordQuestion() {
  const [draft, setDraft] = useState<Draft>({ current: "", next: "", others: true });
  const [busy, setBusy] = useState(false), [tried, setTried] = useState(false);
  const [refused, setRefused] = useState<{ field?: string; text: string } | null>(null);
  const done = useBackToList(MORE_HOME);
  useDirtyGuard("password", !busy && Boolean(draft.current || draft.next));
  const problems = passwordProblems(draft);
  const error = (id: string) => (tried && problems[id]) || (refused?.field === id ? refused.text : "");
  const set = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); if ("current" in patch || "next" in patch) setRefused(null); };

  async function save() {
    if (busy) return;
    const first = Object.keys(problems).find(id => problems[id]);
    if (first) { setTried(true); document.getElementById(first)?.focus(); return; }
    setBusy(true); setRefused(null);
    try {
      const { error: failed } = await authClient.changePassword({ currentPassword: draft.current, newPassword: draft.next, revokeOtherSessions: draft.others });
      if (!failed) { done(PASSWORD_PATH, draft.others ? "Dein Passwort ist geändert. Auf deinen anderen Geräten bist du abgemeldet." : "Dein Passwort ist geändert."); return; }
      const next = passwordFailure(failed);
      setRefused(next);
      if (next.field) document.getElementById(next.field)?.focus();
    } catch { setRefused({ text: CONNECTION_LOST }); }
    setBusy(false);
  }

  return (
    <QuestionForm title="Passwort ändern" home={MORE_HOME} busy={busy} busyLabel="Wird gespeichert …" action="Passwort speichern"
      failed={refused && !refused.field ? refused.text : ""} onSubmit={() => void save()}>
      <div className="ow-qpanel ow-stack">
        <div className="ow-field"><label htmlFor="pw-current">Aktuelles Passwort</label>
          <input id="pw-current" className="ow-input" type="password" autoComplete="current-password" maxLength={PASSWORD_MAX} value={draft.current} {...aria("pw-current", error("pw-current"))} onChange={event => set({ current: event.target.value })} />
          <FieldError id="pw-current-error">{error("pw-current")}</FieldError></div>
        <div className="ow-field"><label htmlFor="pw-next">Neues Passwort</label>
          <input id="pw-next" className="ow-input" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} value={draft.next} {...aria("pw-next", error("pw-next"), "pw-next-hint")} onChange={event => set({ next: event.target.value })} />
          <p id="pw-next-hint" className="ow-hint">Mindestens {PASSWORD_MIN}, höchstens {PASSWORD_MAX} Zeichen.</p>
          <FieldError id="pw-next-error">{error("pw-next")}</FieldError></div>
        <label className="ow-check"><input type="checkbox" checked={draft.others} onChange={event => set({ others: event.target.checked })} /> Auf anderen Geräten abmelden</label>
      </div>
    </QuestionForm>
  );
}
