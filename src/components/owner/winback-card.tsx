"use client";

import { useState } from "react";
import type { MeResponse, PublicProgram } from "@/components/client-api";
import { germanDate, keepUnits } from "@/lib/german-date";
import { CardLinePreview, MoreInfo, NumberStepper } from "./owner-ui";
import { copyFor } from "@/components/customer/customer-card-copy";
import { Control, QuestionForm, rangeError, SwitchRow, useQuestion, wholeIn } from "./question-form";
import { almostGap, almostText, birthdayText, WINBACK_DAYS, winbackRule, winbackText } from "@/lib/wallet-message-rules";

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
        {reminders && <p className="ow-hint">Höchstens einmal je Pause von {last.days} Tagen ohne Buchung, Mo–Sa 10–18 Uhr. Nur an Kunden mit Apple Wallet, die Nachrichten erlaubt haben.</p>}
        {/* The reminder is not the card, so with reminders the rules keep their own line. */}
        {reminders && rules && <p className="ow-hint">Steht auf der Karte: {rules}</p>}
      </>}
    </QuestionForm>
  );
}

export type Birthday = { enabled: boolean; bonus: number; bonusMax: number; cards: number };
/** The wallet-messages read these two pages need: the switch of „Erinnerung vor der Prämie“ and the birthday set-up. */
export type MessageSettings = { winback: Winback; birthday: Birthday };

const SAVE = "/api/merchant/wallet-messages";
/** The reward a reminder names: the cheapest one on the card, as the server picks it. */
const cheapest = (program: PublicProgram) => [...program.rewards].sort((a, b) => a.cost - b.cost)[0]?.title ?? "";
const cards = (n: number) => `${n}\u00a0${n === 1 ? "Karte hat" : "Karten haben"} einen Geburtstag eingetragen.`;

/** Geburtstags-Bonus (ENG-049, `birthday-draft`): switch, bonus, the reminder and the consent line; the facts in the fold.
 *  The owner sees how many cards have a birthday, never which or when. */
export function BirthdayQuestion({ me, program, initial }: { me: MeResponse; program: PublicProgram; initial: MessageSettings }) {
  const { type } = initial.winback, birthday = initial.birthday;
  const saved = { enabled: birthday.enabled, bonus: String(birthday.bonus) };
  const [draft, setDraft] = useState(saved);
  const valid = wholeIn(draft.bonus, 0, birthday.bonusMax);
  const q = useQuestion("birthday", JSON.stringify(draft) !== JSON.stringify(saved), draft.enabled && !valid ? { "birthday-bonus": rangeError(0, birthday.bonusMax) } : {});
  // A real example instead of a placeholder: the end of a birthday week that starts today.
  const [day] = useState(() => germanDate(new Date(Date.now() + 6 * 86_400_000), "long"));
  const bonus = valid ? Number(draft.bonus) : birthday.bonus;
  return (
    <QuestionForm title="Geburtstags-Bonus" busy={q.busy} failed={q.failed}
      onSubmit={() => void q.save(SAVE, { programSlug: me.programSlug, birthday: { enabled: draft.enabled, bonus } })}>
      <SwitchRow label="Bonus in der Geburtstagswoche" sub="Kommt an der Kasse dazu" checked={draft.enabled} onChange={enabled => setDraft({ ...draft, enabled })} />
      {draft.enabled && <>
        {type === "stamp"
          ? <div className="ow-qpanel ow-qcontrol ow-qstack"><div><span id="birthday-bonus-label" className="ow-label">Bonus</span>
            <div className="ow-seg" role="group" aria-labelledby="birthday-bonus-label">
              <button type="button" aria-pressed={draft.bonus === "0"} onClick={() => setDraft({ ...draft, bonus: "0" })}>Kein Bonus</button>
              <button type="button" aria-pressed={draft.bonus === "1"} onClick={() => setDraft({ ...draft, bonus: "1" })}>+1{"\u00a0"}Stempel</button>
            </div></div>
            <p className="ow-hint">{cards(birthday.cards)}</p>
          </div>
          : <Control id="birthday-bonus" stack label="Bonus" hint={keepUnits(`Höchstens ${points(birthday.bonusMax)}. ${cards(birthday.cards)}`)} error={q.error("birthday-bonus")}>
            <NumberStepper id="birthday-bonus" value={draft.bonus} onChange={value => setDraft({ ...draft, bonus: value })} min={0} max={birthday.bonusMax} unit={POINT} bonus offAtZero invalid={Boolean(q.error("birthday-bonus"))} describedBy="birthday-bonus-hint" />
          </Control>}
        <div className="ow-qpanel"><CardLinePreview label="So sieht die Erinnerung aus" shop={program.businessName} brandColor={program.brandColor}>{keepUnits(birthdayText(type, bonus, day))}</CardLinePreview></div>
        {/* Legal (7 Nov): all three facts stay; the consent sentence stays visible, the other two may fold. */}
        <p className="ow-hint">Wer Nachrichten erlaubt hat, bekommt eine Erinnerung.</p>
        <MoreInfo>
          <p>Kunden können Tag und Monat ihres Geburtstags auf ihrer Karte eintragen. In ihrer Geburtstagswoche kommt der Bonus bei der nächsten Buchung dazu, einmal im Jahr.</p>
          {type === "points" && <p>Der Bonus ist höchstens ein Viertel deiner günstigsten Prämie.</p>}
        </MoreInfo>
      </>}
    </QuestionForm>
  );
}

/** Erinnerung vor der Prämie (ENG-045, `almost-draft`): one switch, the reminder, the consent line; rule and quiet hours in
 *  the fold. Retiring the reminder waits for the founder (Q-97): the send itself is unchanged. */
export function AlmostQuestion({ me, program, initial }: { me: MeResponse; program: PublicProgram; initial: MessageSettings }) {
  const { type, almost } = initial.winback;
  const [enabled, setEnabled] = useState(almost);
  const q = useQuestion("almost", enabled !== almost);
  return (
    <QuestionForm title="Erinnerung vor der Prämie" busy={q.busy} failed={q.failed} onSubmit={() => void q.save(SAVE, { programSlug: me.programSlug, almost: enabled })}>
      <SwitchRow label="Erinnerung senden" sub="Wenn nur noch wenig fehlt" checked={enabled} onChange={setEnabled} />
      {enabled && <>
        <div className="ow-qpanel"><CardLinePreview label="So sieht die Erinnerung aus" shop={program.businessName} brandColor={program.brandColor}>{keepUnits(almostText(type, almostGap(type), cheapest(program)))}</CardLinePreview></div>
        {/* Legal (7 Nov): the consent clause stays visible; the quiet hours may move to the help. */}
        <p className="ow-hint">Nur an Kunden, die Nachrichten erlaubt haben.</p>
        <MoreInfo><p>{keepUnits(type === "stamp"
          ? "Fehlt nach einer Buchung nur noch 1 Stempel, kommt eine Erinnerung, höchstens einmal bis zur nächsten Einlösung. Nicht zwischen 21 und 8 Uhr."
          : "Fehlen nach einer Buchung nur noch bis zu 10 Punkte, kommt eine Erinnerung, höchstens einmal bis zur nächsten Einlösung. Nicht zwischen 21 und 8 Uhr.")}</p></MoreInfo>
      </>}
    </QuestionForm>
  );
}
