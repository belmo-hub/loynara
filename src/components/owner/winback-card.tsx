"use client";

import { useState } from "react";
import { postJson, type MeResponse, type PublicProgram } from "@/components/client-api";
import { useDirtyGuard } from "./owner-context";
import { CardLinePreview, NumberStepper, SaveBar, type SaveState } from "./owner-ui";
import { copyFor } from "@/components/customer/customer-card-copy";
import { Control, QuestionForm, rangeError, SwitchRow, useQuestion, wholeIn } from "./question-form";
import { almostText, birthdayText, WINBACK_DAYS, winbackRule, winbackText } from "@/lib/wallet-message-rules";

export type Winback = { enabled: boolean; days: number; bonus: number; bonusMax: number; type: "stamp" | "points"; almost: boolean };
const DAY = { one: "Tag", many: "Tage" }, POINT = { one: "Punkt", many: "Punkte" };
const CARD = copyFor("de");

/** „Kunden zurückholen“ (ENG-044): the owner picks N and the bonus; the text is fixed. The server checks every value again. */
const points = (n: number) => `${n} ${n === 1 ? "Punkt" : "Punkte"}`;
/** The allowed bonus as owners read it: "1 Punkt" when one is the most, never "1 bis 1 Punkte". */
export const bonusRange = (max: number) => max <= 1 ? points(1) : `1 bis ${points(max)}`;

/** „Willkommen zurück“ (screen 09, ENG-089): the switch, the days, the bonus and the line customers see; the reminder parts
 *  show only while Wallet messages are offered. Saving returns to the Programm list like every other question. */
export function WinbackQuestion({ me, program, initial, reminders }: { me: MeResponse; program: PublicProgram; initial: Winback; reminders: boolean }) {
  const saved = { enabled: initial.enabled, days: String(initial.days), bonus: String(initial.bonus) };
  const [draft, setDraft] = useState(saved);
  const daysOk = (value: string) => wholeIn(value, WINBACK_DAYS.min, WINBACK_DAYS.max), bonusOk = (value: string) => wholeIn(value, 0, initial.bonusMax);
  // The texts below keep the last valid values while a field is out of range; only the field shows the error.
  const [last, setLast] = useState({ days: initial.days, bonus: initial.bonus });
  const q = useQuestion("winback", JSON.stringify(draft) !== JSON.stringify(saved), draft.enabled ? { "winback-days": daysOk(draft.days) ? "" : rangeError(WINBACK_DAYS.min, WINBACK_DAYS.max), "winback-bonus": bonusOk(draft.bonus) ? "" : rangeError(0, initial.bonusMax) } : {});
  const edit = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setLast(prev => ({ days: daysOk(next.days) ? Number(next.days) : prev.days, bonus: bonusOk(next.bonus) ? Number(next.bonus) : prev.bonus }));
  };
  // A real example instead of a placeholder (Head of Design): the last day for a card that comes back today.
  const [exampleDay] = useState(() => new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "Europe/Berlin" }).format(new Date(Date.now() + 14 * 86_400_000)));
  const rules = last.bonus > 0 ? winbackRule(initial.type, last.days, last.bonus, reminders) : undefined;
  const preview = { shop: program.businessName, brandColor: program.brandColor };
  return (
    <QuestionForm title="Willkommen zurück" lead="Ein kleiner Bonus für Kunden, die länger nicht da waren." busy={q.busy} failed={q.failed}
      onSubmit={() => void q.save("/api/merchant/program/winback", { programSlug: me.programSlug, winback: { enabled: draft.enabled, days: last.days, bonus: last.bonus } })}>
      <SwitchRow label="Willkommen-zurück-Bonus" sub="Kommt an der Kasse automatisch dazu" checked={draft.enabled} onChange={enabled => edit({ enabled })} />
      {draft.enabled && <>
        <Control id="winback-days" label="Tage ohne Buchung" hint={`${WINBACK_DAYS.min} bis ${WINBACK_DAYS.max} Tage`} error={q.error("winback-days")}>
          <NumberStepper id="winback-days" value={draft.days} onChange={days => edit({ days })} min={WINBACK_DAYS.min} max={WINBACK_DAYS.max} unit={DAY} invalid={Boolean(q.error("winback-days"))} describedBy="winback-days-hint" />
        </Control>
        {initial.type === "stamp"
          ? <div className="ow-qpanel ow-qcontrol"><div><span id="winback-bonus-label" className="ow-label">Bonus</span>
            <div className="ow-seg" role="group" aria-labelledby="winback-bonus-label">
              <button type="button" aria-pressed={draft.bonus === "0"} onClick={() => edit({ bonus: "0" })}>Kein Bonus</button>
              <button type="button" aria-pressed={draft.bonus === "1"} onClick={() => edit({ bonus: "1" })}>+1 Stempel</button>
            </div>
          </div></div>
          : <Control id="winback-bonus" label="Bonus" hint={`${bonusRange(initial.bonusMax)}: höchstens ein Viertel deiner günstigsten Prämie.`} error={q.error("winback-bonus")}>
            <NumberStepper id="winback-bonus" value={draft.bonus} onChange={bonus => edit({ bonus })} min={0} max={initial.bonusMax} unit={POINT} bonus offAtZero invalid={Boolean(q.error("winback-bonus"))} describedBy="winback-bonus-hint" />
          </Control>}
        {(reminders || rules) && <div className="ow-qpanel">{reminders
          ? <CardLinePreview label="So sieht die Erinnerung aus" {...preview}>{winbackText(initial.type, last.bonus, exampleDay)}</CardLinePreview>
          : <CardLinePreview label="So steht es auf der Karte" {...preview} rules={rules}>
            {/* The card line of ENG-089 part B, with its „Bedingungen“ link shown as text here. */}
            {CARD.winback(initial.type === "points", last.bonus, exampleDay)} <u>{CARD.conditions}</u>
          </CardLinePreview>}</div>}
        {/* When the reminder goes out (WINBACK_SEND_WINDOW, once per card). */}
        {reminders && <p className="ow-hint">Geht höchstens einmal raus, wenn eine Karte {last.days} Tage lang keine Buchung hatte, Mo–Sa zwischen 10 und 18 Uhr. Nur an Kunden mit Apple Wallet, die Nachrichten erlaubt haben.</p>}
        {/* The reminder is not the card, so with reminders the rules keep their own line. */}
        {reminders && rules && <p className="ow-hint">Steht auf der Karte: {rules}</p>}
      </>}
    </QuestionForm>
  );
}

/** „Fast geschafft“ (ENG-045): one switch; the text is fixed. Saved at once, like the card's consent box. */
export function AlmostCard({ slug, initial }: { slug: string; initial: Winback }) {
  const [enabled, setEnabled] = useState(initial.almost);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle(next: boolean) {
    setBusy(true); setError("");
    try { await postJson("/api/merchant/wallet-messages", { programSlug: slug, almost: next }); setEnabled(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Das hat nicht geklappt. Versuche es noch einmal."); }
    finally { setBusy(false); }
  }
  return (
    <section className="ow-card ow-stack" aria-labelledby="almost-title">
      <h2 id="almost-title">Fast geschafft</h2>
      <label className="ow-check"><input type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={event => void toggle(event.target.checked)} /> Eingeschaltet</label>
      <p className="ow-hint">Fehlt einer Karte nach einem Besuch nur noch {initial.type === "stamp" ? "1 Stempel" : "wenige Punkte (bis 10)"} bis zur nächsten Prämie, bekommt sie einmal eine Erinnerung, sofern Nachrichten erlaubt sind. Nicht zwischen 21 und 8 Uhr.</p>
      <div className="ow-card" role="group" aria-label="Vorschau der Erinnerung"><p>{almostText(initial.type, 10, "[Prämie]")}</p></div>
      {error && <p role="alert" className="ow-error">{error}</p>}
    </section>
  );
}

export type Birthday = { enabled: boolean; bonus: number; bonusMax: number; cards: number };

/** Geburtstags-Bonus (ENG-049): switch and bonus; the owner sees how many cards have a birthday, never which or when. */
export function BirthdayCard({ slug, type, initial }: { slug: string; type: "stamp" | "points"; initial: Birthday }) {
  const [saved, setSaved] = useState({ enabled: initial.enabled, bonus: String(initial.bonus) });
  const [draft, setDraft] = useState(saved);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const bonus = Number(draft.bonus);
  const bonusValid = /^\d+$/.test(draft.bonus) && bonus <= initial.bonusMax;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("birthday", changed);
  const edit = (patch: Partial<typeof draft>) => { setDraft({ ...draft, ...patch }); if (state === "saved" || state === "error") setState("clean"); };
  async function save() {
    setState("saving"); setError("");
    try { await postJson("/api/merchant/wallet-messages", { programSlug: slug, birthday: { enabled: draft.enabled, bonus } }); setSaved(draft); setState("saved"); }
    catch (cause) { setState("error"); setError(cause instanceof Error ? cause.message : "Die Einstellungen konnten nicht gespeichert werden."); }
  }
  return (
    <section className="ow-card ow-stack" aria-labelledby="birthday-title">
      <h2 id="birthday-title">Geburtstags-Bonus</h2>
      <label className="ow-check"><input type="checkbox" role="switch" checked={draft.enabled} onChange={event => edit({ enabled: event.target.checked })} /> Eingeschaltet</label>
      {type === "stamp"
        ? <fieldset className="ow-stack" style={{ border: 0, padding: 0, margin: 0 }}><legend>Bonus</legend>
          <label><input type="radio" name="birthday-bonus" checked={bonus === 0} onChange={() => edit({ bonus: "0" })} /> Kein Bonus</label>
          <label><input type="radio" name="birthday-bonus" checked={bonus === 1} onChange={() => edit({ bonus: "1" })} /> +1 Stempel</label>
        </fieldset>
        : <div className="ow-field">
          <label htmlFor="birthday-bonus">Bonus in Punkten (0 = kein Bonus)</label>
          <input id="birthday-bonus" className="ow-input ow-field--narrow" inputMode="numeric" value={draft.bonus} aria-invalid={!bonusValid} onChange={event => edit({ bonus: event.target.value.replace(/[^0-9]/g, "") })} />
          <p className="ow-hint">{bonusRange(initial.bonusMax)}: höchstens ein Viertel deiner günstigsten Prämie.</p>
        </div>}
      <p className="ow-hint">Kundinnen und Kunden können auf ihrer Karte Tag und Monat ihres Geburtstags eintragen. In ihrer Geburtstagswoche wird der Bonus beim Bestätigen eines Besuchs mitgebucht, einmal im Jahr. Mit Wallet-Nachrichten bekommen sie dazu eine Erinnerung. {initial.cards} {initial.cards === 1 ? "Karte hat" : "Karten haben"} einen Geburtstag eingetragen.</p>
      <div className="ow-card" role="group" aria-label="Vorschau der Erinnerung"><p>{birthdayText(type, bonusValid ? bonus : 0, "[Datum]")}</p></div>
      <SaveBar section="Geburtstags-Bonus" state={shown} onSave={() => void save()} onDiscard={() => { setDraft(saved); setState("clean"); }} canSave={changed && bonusValid} saveLabel="Speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : undefined} />
    </section>
  );
}
