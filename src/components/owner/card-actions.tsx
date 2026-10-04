"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useRef, useState } from "react";
import { ClientApiError, newRequestId, postJson } from "@/components/client-api";
import type { MerchantMemberDetail } from "@/lib/merchant-members";
import { Notice, OwnerDialog } from "./owner-ui";

type Entry = MerchantMemberDetail["timeline"][number];
type Unit = "Stempel" | "Punkte";

const CORRECTION_ERRORS: Record<string, string> = {
  ALREADY_REVERSED: "Dieser Vorgang wurde bereits korrigiert.",
  INSUFFICIENT_BALANCE: "Die Korrektur würde den Kontostand unter null bringen, weil ein Teil bereits eingelöst wurde. Korrigiere zuerst die spätere Einlösung oder lass den Vorgang stehen.",
  LIMIT_EXCEEDED: "Korrekturen über 100 Einheiten bucht nur die Inhaberin oder der Inhaber.",
  REFERRAL_REVIEW_REQUIRED: "Empfehlungsboni werden unter Empfehlungen geprüft und dort zurückgenommen.",
  FORBIDDEN: "Korrekturen sind der Leitung und der Inhaberin oder dem Inhaber vorbehalten.",
  NOT_FOUND: "Der Vorgang gehört nicht zum aktiven Standort oder die Karte ist geschlossen.",
};

/** Which ledger rows can be corrected here; the server enforces the same rules again. */
export function correctable(entry: Entry) {
  return (entry.kind === "award" || entry.kind === "redeem") && !entry.reversed && entry.source !== "referral_bonus";
}

export function sourceLabel(source: string) {
  return ({ staff_online: "Kasse", staff_offline: "Kasse, offline nachgebucht", staff_correction: "Korrektur", referral_bonus: "Empfehlungsbonus", nfc_tap: "NFC-Tap", synthetic_seed: "Demo-Daten", legacy_unclassified: "Altbestand" } as Record<string, string>)[source] ?? "Unbekannte Quelle";
}

/**
 * Books a linked compensating entry for one ledger row. The original row stays in the history; the reason and the
 * acting person are stored with the correction. An unclear network result keeps the same idempotency key, so
 * retrying cannot book the correction twice.
 */
export function CorrectionDialog({ entry, unit, locationId, onClose, onDone }: { entry: Entry; unit: Unit; locationId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "uncertain" | "error">("idle");
  const [error, setError] = useState("");
  const key = useRef(newRequestId());
  const effect = -entry.delta;
  const valid = reason.trim().length >= 10;

  async function submit() {
    if (!valid || state === "saving") return;
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
    <OwnerDialog title="Vorgang korrigieren" onClose={() => { if (state !== "saving") onClose(); }} actions={<>
      <button type="button" className="ow-btn ow-btn--secondary" onClick={onClose} disabled={state === "saving"}>Abbrechen</button>
      <button type="button" className="ow-btn ow-btn--primary" onClick={() => void submit()} disabled={!valid || state === "saving"} aria-busy={state === "saving"}>{state === "saving" ? "Wird gebucht …" : state === "uncertain" ? "Erneut senden" : "Korrektur buchen"}</button>
    </>}>
      <p>{entry.kind === "award" ? "Gutschrift" : "Einlösung"} vom {new Date(entry.createdAt).toLocaleString("de-DE")} · {entry.delta > 0 ? "+" : ""}{entry.delta} {unit}{entry.rewardTitle ? ` · ${entry.rewardTitle}` : ""}</p>
      <p className="ow-muted">Loynara bucht <strong>{effect > 0 ? "+" : ""}{effect} {unit}</strong> als verknüpfte Korrektur. Der ursprüngliche Vorgang bleibt im Verlauf sichtbar und zählt danach nicht mehr in Auswertungen{entry.kind === "award" ? " und nicht als Kassenvorgang für Empfehlungen" : ""}.</p>
      <div className="ow-field"><label htmlFor="corr-reason">Grund (Pflicht, mindestens 10 Zeichen)</label><textarea id="corr-reason" className="ow-textarea" data-autofocus rows={3} maxLength={240} value={reason} onChange={event => setReason(event.target.value)} placeholder="z. B. Versehentlich zwei Stempel statt einem vergeben" /></div>
      {error && <Notice tone={state === "uncertain" ? "warn" : "danger"} role="alert">{error}</Notice>}
    </OwnerDialog>
  );
}

const METHOD_LABEL = { card_link: "Vorhandener Kartenlink", stored_contact: "Hinterlegter Kontakt", other_check: "Andere nachvollziehbare Prüfung" } as const;
type Method = keyof typeof METHOD_LABEL;

/**
 * Issues a new link and QR code for the SAME card. The old link and QR stop working; balance, card number and history
 * stay. The merchant confirms entitlement explicitly and names how they checked; Loynara does not verify the person.
 * The new link is shown once, here, and is never sent anywhere by Loynara. The retry key survives an unclear network
 * result, so pressing the button again returns the same link instead of invalidating it with a second one.
 */
export function ReissueDialog({ membershipId, cardLocator, onClose, onDone }: { membershipId: string; cardLocator: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<Method | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState("");
  const key = useRef(newRequestId());
  const valid = reason.trim().length >= 10 && method !== "" && confirmed;

  async function submit() {
    if (!valid || state === "saving") return;
    setState("saving"); setError("");
    try {
      const result = await postJson<{ cardUrl: string }>(`/api/merchant/customers/${encodeURIComponent(membershipId)}/reissue`, { reason: reason.trim(), verificationMethod: method, entitlementConfirmed: true, idempotencyKey: key.current });
      setLink(result.cardUrl);
      setQr(await QRCode.toDataURL(result.cardUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" }));
      setState("done"); onDone();
    } catch (cause) {
      setState("error");
      setError(cause instanceof ClientApiError && cause.code === "FORBIDDEN" ? "Neu ausstellen dürfen nur die Leitung und die Inhaberin oder der Inhaber dieses Standorts."
        : cause instanceof ClientApiError && (cause.status === 0 || cause.status >= 500) ? "Ergebnis unklar. Erneut senden ist sicher: Ist die Karte schon neu ausgestellt, bekommst du denselben Link noch einmal."
        : cause instanceof Error ? cause.message : "Die Karte wurde nicht neu ausgestellt.");
    }
  }

  if (state === "done") {
    return (
      <OwnerDialog title={`Karte ${cardLocator} neu ausgestellt`} onClose={onClose} actions={<button type="button" className="ow-btn ow-btn--primary" data-autofocus onClick={onClose}>Fertig</button>}>
        <Notice tone="ok" role="status">Der alte Link und der alte QR-Code funktionieren nicht mehr. Guthaben, Kartennummer und Verlauf sind unverändert.</Notice>
        <p>Lass die Person diesen Code mit dem eigenen Handy scannen und die Karte speichern. Dieser Link wird nur jetzt angezeigt.</p>
        {qr && <div style={{ display: "grid", placeItems: "center" }}><Image unoptimized src={qr} alt={`QR-Code für den neuen Link von Karte ${cardLocator}`} width={200} height={200} /></div>}
        <p className="ow-hint">Eine bereits gespeicherte Wallet-Karte muss neu hinzugefügt werden.</p>
        <div className="ow-row"><button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied("Link kopiert."), () => setCopied("Kopieren nicht möglich.")); }}>Link kopieren</button>{copied && <span className="ow-hint" role="status">{copied}</span>}</div>
      </OwnerDialog>
    );
  }
  return (
    <OwnerDialog title={`Karte ${cardLocator} neu ausstellen`} tone="danger" onClose={() => { if (state !== "saving") onClose(); }} actions={<>
      <button type="button" className="ow-btn ow-btn--secondary" onClick={onClose} disabled={state === "saving"}>Abbrechen</button>
      <button type="button" className="ow-btn ow-btn--primary" onClick={() => void submit()} disabled={!valid || state === "saving"} aria-busy={state === "saving"}>{state === "saving" ? "Wird ausgestellt …" : state === "error" ? "Erneut senden" : "Neuen Link ausstellen"}</button>
    </>}>
      <p>Für Kundinnen und Kunden, die ihren Kartenlink verloren haben, etwa nach einem Handywechsel. Es entsteht keine zweite Karte und es wird nichts gebucht.</p>
      <fieldset className="ow-entitlement">
        <legend>Berechtigung geprüft</legend>
        <p>Stelle die Karte nur neu aus, wenn du geprüft hast, dass die Person zu dieser Karte gehört. Der bisherige Kartenlink und QR-Code werden sofort ungültig. Guthaben, Kartennummer und Verlauf bleiben erhalten.</p>
        <label className="ow-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} data-autofocus /> Berechtigung geprüft</label>
      </fieldset>
      <div className="ow-field"><label htmlFor="reissue-method">Wie hast du geprüft?</label>
        <select id="reissue-method" className="ow-select" value={method} onChange={event => setMethod(event.target.value as Method | "")}>
          <option value="">Bitte wählen</option>
          {(Object.keys(METHOD_LABEL) as Method[]).map(value => <option key={value} value={value}>{METHOD_LABEL[value]}</option>)}
        </select>
        <span className="ow-hint">Das ist dein Vermerk. Loynara prüft die Person nicht selbst; Vermerk, Grund und dein Name werden im Verlauf der Karte gespeichert.</span></div>
      <div className="ow-field"><label htmlFor="reissue-reason">Grund (Pflicht, mindestens 10 Zeichen)</label><textarea id="reissue-reason" className="ow-textarea" rows={3} maxLength={240} value={reason} onChange={event => setReason(event.target.value)} placeholder="z. B. Neues Handy, alten Kartenlink auf dem alten Gerät gezeigt" /></div>
      {error && <Notice tone={state === "error" ? "danger" : "warn"} role="alert">{error}</Notice>}
    </OwnerDialog>
  );
}
