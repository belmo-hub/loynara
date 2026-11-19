"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { ClipboardCheck, Link2, Users } from "lucide-react";
import { useRef, useState } from "react";
import { ClientApiError, newRequestId, postJson } from "@/components/client-api";
import type { MerchantMemberDetail } from "@/lib/merchant-members";
import { unitWord } from "@/lib/units";
import { Notice } from "./owner-ui";
import { Choices, QuestionForm } from "./question-form";
import { CopyLabel, useCopy } from "@/components/copy-text";

type Entry = MerchantMemberDetail["timeline"][number];
type Back = { label: string; onClick: () => void };

const CORRECTION_ERRORS: Record<string, string> = {
  ALREADY_REVERSED: "Dieser Vorgang wurde bereits korrigiert.",
  INSUFFICIENT_BALANCE: "Die Korrektur würde den Kontostand unter null bringen, weil ein Teil bereits eingelöst wurde. Korrigiere zuerst die spätere Einlösung oder lass den Vorgang stehen.",
  LIMIT_EXCEEDED: "Korrekturen über 100 Einheiten bucht nur die Inhaberin oder der Inhaber.",
  WELCOME_BONUS_WITH_AWARD: "Der Startbonus wird zusammen mit dem ersten Besuch korrigiert.",
  REFERRAL_REVIEW_REQUIRED: "Empfehlungsboni werden unter Empfehlungen geprüft und dort zurückgenommen.",
  FORBIDDEN: "Korrekturen sind der Leitung und der Inhaberin oder dem Inhaber vorbehalten.",
  NOT_FOUND: "Der Vorgang gehört nicht zum aktiven Standort oder die Karte ist geschlossen.",
};

/** Which ledger rows can be corrected here; the server enforces the same rules again. */
export function correctable(entry: Entry) {
  return (entry.kind === "award" || entry.kind === "redeem" || entry.kind === "expiry") && !entry.reversed && entry.source !== "referral_bonus" && entry.source !== "welcome_bonus" && entry.source !== "happy_hour" && entry.source !== "winback_bonus" && entry.source !== "birthday_bonus" && entry.source !== "challenge_bonus";
}

export function sourceLabel(source: string) {
  return ({ staff_online: "Kasse", staff_offline: "Kasse, offline nachgebucht", staff_correction: "Korrektur", referral_bonus: "Empfehlungsbonus", welcome_bonus: "Startbonus", happy_hour: "Happy Hour", expiry: "Verfall", winback_bonus: "Willkommen-zurück-Bonus", birthday_bonus: "Geburtstags-Bonus", challenge_bonus: "Monats-Challenge", nfc_tap: "NFC-Tap", synthetic_seed: "Demo-Daten", legacy_unclassified: "Altbestand" } as Record<string, string>)[source] ?? "Unbekannte Quelle";
}

/**
 * Kunden 04 (ENG-122a): books a linked compensating entry for one ledger row, as a screen instead of the old dialog. The
 * original row stays in the history; the reason and the acting person are stored with the correction. An unclear network
 * result keeps the same idempotency key, so retrying cannot book the correction twice.
 */
export function CorrectionStep({ entry, kind, locationId, balance, back, onDone }: { entry: Entry; kind: "stamp" | "points"; locationId: string; balance: number; back: Back; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "uncertain" | "error">("idle");
  const [error, setError] = useState("");
  const key = useRef(newRequestId());
  const effect = -entry.delta;
  const valid = reason.trim().length >= 10;
  const after = balance + effect;
  // Below zero the server refuses it (bonuses reversed with it only lower the balance further): say so before the tap.
  const blocked = after < 0;

  async function submit() {
    if (!valid || blocked || state === "saving") return;
    setState("saving"); setError("");
    try {
      await postJson("/api/transactions/reverse", { locationId, entryId: entry.id, reason: reason.trim(), idempotencyKey: key.current });
      onDone();
    } catch (cause) {
      const uncertain = cause instanceof ClientApiError && (cause.status === 0 || cause.status >= 500);
      setState(uncertain ? "uncertain" : "error");
      setError(uncertain ? "Ergebnis unklar. Erneut senden ist sicher: dieselbe Korrektur wird höchstens einmal gebucht."
        : cause instanceof ClientApiError && cause.code && CORRECTION_ERRORS[cause.code] ? CORRECTION_ERRORS[cause.code] : cause instanceof Error ? cause.message : "Die Korrektur wurde nicht gebucht.");
    }
  }

  return (
    <QuestionForm title="Vorgang korrigieren" back={back} busy={state === "saving"} busyLabel="Wird gebucht …" disabled={!valid || blocked} failed=""
      action={state === "uncertain" ? "Erneut senden" : "Korrektur buchen"} onSubmit={() => void submit()}>
      <div className="ow-qpanel ow-qcmp"><p>Vorgang</p><p>{entry.kind === "award" ? "Buchung" : entry.kind === "expiry" ? "Verfall" : "Einlösung"} vom {new Date(entry.createdAt).toLocaleString("de-DE")} · {entry.delta > 0 ? "+" : ""}{entry.delta} {unitWord(entry.delta, kind)}{entry.rewardTitle ? ` · ${entry.rewardTitle}` : ""}</p></div>
      <p className="ow-qpanel">Loynara bucht <strong>{effect > 0 ? "+" : ""}{effect} {unitWord(effect, kind)}</strong> als verknüpfte Korrektur. Der ursprüngliche Vorgang bleibt im Verlauf sichtbar und zählt danach nicht mehr in Auswertungen{entry.kind === "award" ? " und nicht als Buchung für Empfehlungen" : ""}.</p>
      <div className="ow-qpanel ow-qsum">
        <p className="ow-cardline-label">Rechnerische Auswirkung dieses Vorgangs</p>
        <dl>
          <div><dt>Stand jetzt</dt><dd>{balance} {unitWord(balance, kind)}</dd></div>
          <div><dt>Korrektur</dt><dd>{effect > 0 ? "+" : "−"}{Math.abs(effect)} {unitWord(effect, kind)}</dd></div>
          <div data-new=""><dt>Nach der Korrektur</dt><dd>{blocked ? "Nicht möglich" : `${after} ${unitWord(after, kind)}`}</dd></div>
        </dl>
        {blocked && <Notice tone="danger">{CORRECTION_ERRORS.INSUFFICIENT_BALANCE}</Notice>}
        {/* R6 names the balance after; this live sentence keeps it from reading as a promise (bonuses may go too). */}
        {!blocked && <p className="ow-hint">Das ist die rechnerische Auswirkung dieses Vorgangs. Bei einer ersten Buchung können zusätzlich Empfehlungsboni zurückgenommen werden. Den endgültigen Stand bestätigt der Server nach der Buchung.</p>}
      </div>
      <div className="ow-field ow-qpanel"><label htmlFor="corr-reason">Grund (Pflicht, mindestens 10 Zeichen)</label><textarea id="corr-reason" className="ow-textarea" rows={3} readOnly={state === "saving" || state === "uncertain"} maxLength={240} value={reason} onChange={event => setReason(event.target.value)} placeholder="z. B. Versehentlich zwei Stempel statt einem vergeben" aria-describedby="corr-reason-n" /><ReasonHint id="corr-reason-n" length={reason.trim().length} /></div>
      {state === "uncertain" && <p className="ow-hint">Für die Wiederholung bleibt der ursprünglich gesendete Grund unverändert.</p>}
      {error && <Notice tone={state === "uncertain" ? "warn" : "danger"} role="alert">{error}</Notice>}
    </QuestionForm>
  );
}

function ReasonHint({ id, length }: { id: string; length: number }) {
  return <span id={id} className="ow-hint ow-num">{length >= 10 ? "Grund reicht aus. Er wird mit deinem Namen im Kartenverlauf gespeichert." : `Noch ${10 - length} Zeichen bis zum Mindestumfang.`}</span>;
}

const METHODS = [
  { value: "card_link", label: "Vorhandener Kartenlink", icon: Link2 },
  { value: "stored_contact", label: "Hinterlegter Kontakt", icon: Users },
  { value: "other_check", label: "Andere nachvollziehbare Prüfung", icon: ClipboardCheck },
];

/**
 * Kunden 05/06 (ENG-122a): issues a new link and QR code for the SAME card. The old link and QR stop working; balance, card
 * number and history stay. The merchant confirms entitlement explicitly and names how they checked; Loynara does not verify
 * the person. The new link is shown once, on this screen, and is never sent anywhere by Loynara. The retry key survives an
 * unclear network result, so pressing the button again returns the same link instead of invalidating it with a second one.
 */
export function ReissueStep({ membershipId, cardLocator, back, onIssued }: { membershipId: string; cardLocator: string; back: Back; onIssued: () => void }) {
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [qr, setQr] = useState("");
  const { copied, copy } = useCopy();
  const [copyFailed, setCopyFailed] = useState(false);
  const key = useRef(newRequestId());
  const valid = reason.trim().length >= 10 && method !== "" && confirmed;

  async function submit() {
    if (!valid || state === "saving") return;
    setState("saving"); setError("");
    try {
      const result = await postJson<{ cardUrl: string }>(`/api/merchant/customers/${encodeURIComponent(membershipId)}/reissue`, { reason: reason.trim(), verificationMethod: method, entitlementConfirmed: true, idempotencyKey: key.current });
      setLink(result.cardUrl);
      setQr(await QRCode.toDataURL(result.cardUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" }));
      setState("done"); onIssued();
    } catch (cause) {
      setState("error");
      setError(cause instanceof ClientApiError && cause.code === "FORBIDDEN" ? "Neu ausstellen dürfen nur die Leitung und die Inhaberin oder der Inhaber dieses Standorts."
        : cause instanceof ClientApiError && (cause.status === 0 || cause.status >= 500) ? "Ergebnis unklar. Erneut senden ist sicher: Ist die Karte schon neu ausgestellt, bekommst du denselben Link noch einmal."
        : cause instanceof Error ? cause.message : "Die Karte wurde nicht neu ausgestellt.");
    }
  }

  if (state === "done") return (
    <QuestionForm title={`Karte ${cardLocator} neu ausgestellt`} back={back} busy={false} failed="" action="Fertig" onSubmit={back.onClick}>
      <div className="ow-qpanel ow-reissued">
        {qr && <Image unoptimized src={qr} alt={`QR-Code für den neuen Link von Karte ${cardLocator}`} width={200} height={200} />}
        <strong>{cardLocator}</strong>
        <p>Lass die Person diesen Code mit dem eigenen Handy scannen und die Karte speichern. Dieser Link wird nur jetzt angezeigt.</p>
      </div>
      <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void copy(link).then(ok => setCopyFailed(!ok))}><CopyLabel copied={copied} label="Link kopieren" /></button>
      <p className="ow-sr" role="status">{copied && "Link kopiert."}</p>
      {copyFailed && <p className="ow-error" role="alert">Kopieren nicht möglich.</p>}
      <p className="ow-hint">Der alte Link und der alte QR-Code funktionieren nicht mehr. Guthaben, Kartennummer und Verlauf sind unverändert. Eine bereits in Apple oder Google Wallet gespeicherte Karte wird ungültig. Die Person fügt sie über den neuen Link erneut hinzu.</p>
    </QuestionForm>
  );
  return (
    <QuestionForm title={`Karte ${cardLocator} neu ausstellen`} lead="Für Kundinnen und Kunden, die ihren Kartenlink verloren haben, etwa nach einem Handywechsel. Es entsteht keine zweite Karte und es wird nichts gebucht."
      back={back} busy={state === "saving"} busyLabel="Wird ausgestellt …" disabled={!valid} failed="" action={state === "error" ? "Erneut senden" : "Neuen Link ausstellen"} onSubmit={() => void submit()}>
      <Choices name="reissue-method" label="Wie hast du geprüft?" options={METHODS} value={method} onChange={setMethod} />
      <p className="ow-hint">Das ist dein Vermerk. Loynara prüft die Person nicht selbst; Vermerk, Grund und dein Name werden im Verlauf der Karte gespeichert.</p>
      <div className="ow-field ow-qpanel"><label htmlFor="reissue-reason">Grund (Pflicht, mindestens 10 Zeichen)</label><textarea id="reissue-reason" className="ow-textarea" rows={3} maxLength={240} value={reason} onChange={event => setReason(event.target.value)} placeholder="z. B. Neues Handy, alten Kartenlink auf dem alten Gerät gezeigt" aria-describedby="reissue-reason-n" /><ReasonHint id="reissue-reason-n" length={reason.trim().length} /></div>
      {/* Kept from the live dialog: the merchant confirms entitlement explicitly before the old link stops working. */}
      <div className="ow-qpanel ow-stack ow-stack--tight">
        <p>Stelle die Karte nur neu aus, wenn du geprüft hast, dass die Person zu dieser Karte gehört. Der bisherige Kartenlink und QR-Code werden sofort ungültig. Guthaben, Kartennummer und Verlauf bleiben erhalten.</p>
        <label className="ow-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Berechtigung geprüft</label>
      </div>
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
    </QuestionForm>
  );
}
