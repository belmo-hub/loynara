"use client";

import { useState } from "react";
import { postJson } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "./owner-context";
import { CardLinePreview, Notice, NumberStepper, SaveBar, type SaveState } from "./owner-ui";
import { copyFor } from "@/components/customer/customer-card-copy";
import { useLoad } from "./use-load";
import { almostText, birthdayText, WINBACK_DAYS, winbackRule, winbackText } from "@/lib/wallet-message-rules";

export type Winback = { enabled: boolean; days: number; bonus: number; bonusMax: number; type: "stamp" | "points"; almost: boolean };
type Draft = { enabled: boolean; days: string; bonus: string };
const DAY = { one: "Tag", many: "Tage" }, POINT = { one: "Punkt", many: "Punkte" };
const CARD = copyFor("de");
const fromSaved = (w: Winback): Draft => ({ enabled: w.enabled, days: String(w.days), bonus: String(w.bonus) });

/** „Kunden zurückholen“ (ENG-044): the owner picks N and the bonus; the text is fixed. The server checks every value again. */
export function WinbackCard({ slug, shop, initial, reminders }: { slug: string; shop: string; initial: Winback; reminders: boolean }) {
  const [saved, setSaved] = useState<Draft>(() => fromSaved(initial));
  const [draft, setDraft] = useState<Draft>(saved);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const days = Number(draft.days), bonus = Number(draft.bonus);
  const daysValid = /^\d+$/.test(draft.days) && days >= WINBACK_DAYS.min && days <= WINBACK_DAYS.max;
  const bonusValid = /^\d+$/.test(draft.bonus) && bonus <= initial.bonusMax;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  const rules = bonusValid && bonus > 0 ? winbackRule(initial.type, daysValid ? days : WINBACK_DAYS.default, bonus, reminders) : undefined;
  useDirtyGuard("winback", changed);
  const edit = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); if (state === "saved" || state === "error") setState("clean"); };
  // A real example instead of a placeholder (Head of Design): the last day for a card that comes back today.
  const [exampleDay] = useState(() => new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "Europe/Berlin" }).format(new Date(Date.now() + 14 * 86_400_000)));

  async function save() {
    setState("saving"); setError("");
    try {
      await postJson("/api/merchant/program/winback", { programSlug: slug, winback: { enabled: draft.enabled, days, bonus } });
      setSaved(draft); setState("saved");
    } catch (cause) { setState("error"); setError(cause instanceof Error ? cause.message : "Die Einstellungen konnten nicht gespeichert werden."); }
  }

  return (
    <section className="ow-card ow-stack" aria-labelledby="winback-title">
      <h2 id="winback-title">Willkommen-zurück-Bonus</h2>
      <label className="ow-check"><input type="checkbox" role="switch" checked={draft.enabled} onChange={event => edit({ enabled: event.target.checked })} /> Eingeschaltet</label>
      <div className="ow-field">
        <label htmlFor="winback-days">Tage ohne Buchung</label>
        <NumberStepper id="winback-days" value={draft.days} onChange={value => edit({ days: value })} min={WINBACK_DAYS.min} max={WINBACK_DAYS.max} unit={DAY} invalid={!daysValid} describedBy="winback-days-hint" />
        <p id="winback-days-hint" className={daysValid ? "ow-hint" : "ow-error"}>{WINBACK_DAYS.min} bis {WINBACK_DAYS.max} Tage</p>
      </div>
      {initial.type === "stamp"
        ? <div className="ow-field"><span id="winback-bonus-label" className="ow-label">Bonus</span>
          <div className="ow-seg" role="group" aria-labelledby="winback-bonus-label">
            <button type="button" aria-pressed={bonus === 0} onClick={() => edit({ bonus: "0" })}>Kein Bonus</button>
            <button type="button" aria-pressed={bonus === 1} onClick={() => edit({ bonus: "1" })}>+1 Stempel</button>
          </div>
        </div>
        : <div className="ow-field">
          <label htmlFor="winback-bonus">Bonus</label>
          <NumberStepper id="winback-bonus" value={draft.bonus} onChange={value => edit({ bonus: value })} min={0} max={initial.bonusMax} unit={POINT} bonus offAtZero invalid={!bonusValid} describedBy="winback-bonus-hint" />
          <p id="winback-bonus-hint" className={bonusValid ? "ow-hint" : "ow-error"}>1 bis {initial.bonusMax} Punkte: höchstens ein Viertel deiner günstigsten Prämie.</p>
        </div>}
      {reminders
        ? <p className="ow-hint">Wer {daysValid ? days : "[N]"} Tage nicht da war und in den 14 Tagen danach wiederkommt, bekommt den Bonus; er wird beim Bestätigen des Besuchs mitgebucht. Kundinnen und Kunden mit Wallet-Nachrichten bekommen dazu einmal eine Erinnerung, montags bis samstags zwischen 10 und 18 Uhr.</p>
        : <p className="ow-hint">Wer {daysValid ? days : "[N]"} Tage nicht da war und in den 14 Tagen danach wiederkommt, bekommt den Bonus einmal. Er kommt beim Bestätigen an der Kasse automatisch dazu. Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.</p>}
      {reminders
        ? <CardLinePreview label="So sieht die Erinnerung aus" shop={shop}>{winbackText(initial.type, bonusValid ? bonus : 0, exampleDay)}</CardLinePreview>
        : rules && <CardLinePreview label="So steht es auf der Karte" shop={shop} rules={rules}>
          {/* The card line of ENG-089 part B, with its „Bedingungen“ link shown as text here. */}
          {CARD.winback(initial.type === "points", bonus, exampleDay)} <u>{CARD.conditions}</u>
        </CardLinePreview>}
      {/* The reminder is not the card, so with reminders the rules keep their own line. */}
      {reminders && rules && <p className="ow-hint">Steht auf der Karte: {rules}</p>}
      <SaveBar state={shown} onSave={() => void save()} onDiscard={() => { setDraft(saved); setState("clean"); }} canSave={changed && daysValid && bonusValid} saveLabel="Speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : undefined} />
    </section>
  );
}

/** The win-back set-up on Programm (ENG-089): loads its own settings; the reminder parts show only while Wallet messages are offered. */
export function ProgramWinbackCard({ slug }: { slug: string }) {
  const owner = useOwner();
  const [data, reload] = useLoad<Winback>(`/api/merchant/program/winback?programSlug=${encodeURIComponent(slug)}`);
  if (data.state === "error") return <Notice tone="danger" role="alert" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={reload}>Erneut laden</button>}>{data.message}</Notice>;
  if (data.state !== "ok") return null;
  return <WinbackCard slug={slug} shop={owner.me?.businessName ?? ""} initial={data.data} reminders={!owner.hiddenSurfaces.includes("walletMessages")} />;
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
          <input id="birthday-bonus" className="ow-input" inputMode="numeric" style={{ maxWidth: 120 }} value={draft.bonus} aria-invalid={!bonusValid} onChange={event => edit({ bonus: event.target.value.replace(/[^0-9]/g, "") })} />
          <p className="ow-hint">1 bis {initial.bonusMax} Punkte: höchstens ein Viertel deiner günstigsten Prämie.</p>
        </div>}
      <p className="ow-hint">Kundinnen und Kunden können auf ihrer Karte Tag und Monat ihres Geburtstags eintragen. In ihrer Geburtstagswoche wird der Bonus beim Bestätigen eines Besuchs mitgebucht, einmal im Jahr. Mit Wallet-Nachrichten bekommen sie dazu eine Erinnerung. {initial.cards} {initial.cards === 1 ? "Karte hat" : "Karten haben"} einen Geburtstag eingetragen.</p>
      <div className="ow-card" role="group" aria-label="Vorschau der Erinnerung"><p>{birthdayText(type, bonusValid ? bonus : 0, "[Datum]")}</p></div>
      <SaveBar state={shown} onSave={() => void save()} onDiscard={() => { setDraft(saved); setState("clean"); }} canSave={changed && bonusValid} saveLabel="Speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : undefined} />
    </section>
  );
}
