"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson, ClientApiError, type CardResponse } from "./client-api";
import { CardContact } from "./card-contact";
import { CheckCircle2, Clock3, Nfc, TriangleAlert } from "lucide-react";
import { CardFace, nearestReward } from "./customer/card-face";
import { LegalLinks } from "./customer/customer-state";
import { buttonClassName } from "./ui/button";
import { CustomerShell } from "./ui/customer-shell";
import styles from "./customer/tap.module.css";

type Preview = { merchantName: string; locationName: string; programName: string; programSlug: string; programType?: "stamp" | "points"; brandColor: string; mode: "disabled" | "automatic_fixed" | "staff_confirmed"; hasMembership: boolean; cardLocator?: string; requiresSelection?: boolean; recoveryRequired?: boolean; cardPath?: string };
export type TapState = "awarded" | "already_processed" | "confirmed" | "cooldown" | "pending_staff" | "expired" | "cancelled" | "needs_enrollment" | "disabled";
type Result = { state: TapState; balance?: number; expiresAt?: string; cardLocator?: string; requestId?: string; statusRef?: string; credited?: number };
/** States in which the server also returns the card number, so the cashier can match the right request. */
const STATES_WITH_CARD_NUMBER: ReadonlyArray<TapState> = ["pending_staff", "confirmed", "awarded", "already_processed"];

const POLL_MS = 4000;
export const TAP_RETURN_KEY = "loynara_tap_return";
const TAP_URL = /^\/tap\/[A-Za-z0-9_-]{24}\?e=[a-fA-F0-9]{32}&c=[a-fA-F0-9]{16}$/;

/** What the customer is told for each state of the same tap. Reloading never produces an error for a request that exists. */
export function tapCopy(state: TapState | "loading" | "error", error?: ClientApiError | Error, points = false): { title: string; detail: string } {
  if (points) switch (state) {
    case "needs_enrollment": return { title: "Deine Karte erstellen", detail: "Mit einer kostenlosen Karte im Browser sammelst du Punkte. Du brauchst keine App." };
    case "pending_staff": return { title: "Warte auf das Team", detail: "Das Team an der Kasse trägt deine Punkte ein und bestätigt sie. Du musst nichts weiter tun." };
    case "confirmed": return { title: "Punkte erhalten", detail: "Das Team hat deine Punkte bestätigt. Sie sind auf deiner Karte gebucht." };
    case "cooldown": return { title: "Gerade erst gebucht", detail: "Auf deiner Karte wurden gerade erst Punkte gebucht. Beim nächsten Besuch kannst du das Schild wieder berühren." };
  }
  switch (state) {
    case "loading": return { title: "NFC-Berührung wird geprüft", detail: "Einen Moment bitte." };
    case "needs_enrollment": return { title: "Deine Karte erstellen", detail: "Mit einer kostenlosen Karte im Browser sammelst du Stempel. Du brauchst keine App." };
    case "pending_staff": return { title: "Warte auf das Team", detail: "Das Team an der Kasse bestätigt deinen Stempel. Du musst nichts weiter tun." };
    case "confirmed": return { title: "Stempel erhalten", detail: "Das Team hat deinen Stempel bestätigt. Er ist auf deiner Karte gebucht." };
    case "awarded": return { title: "Stempel erhalten", detail: "Ein Stempel wurde bestätigt und auf deiner Karte gebucht." };
    case "already_processed": return { title: "Schon erledigt", detail: "Diese Berührung wurde bereits verarbeitet. Es wurde nichts doppelt gebucht." };
    case "cooldown": return { title: "Gerade erst gestempelt", detail: "Auf deiner Karte wurde gerade erst ein Stempel gebucht. Beim nächsten Besuch kannst du das Schild wieder berühren." };
    case "expired": return { title: "Anfrage abgelaufen", detail: "Das Team hat diese Anfrage nicht rechtzeitig bestätigt. Berühre das Schild noch einmal, um es erneut zu versuchen." };
    case "cancelled": return { title: "Nicht bestätigt", detail: "Das Team hat diese Anfrage nicht bestätigt. Frage bitte an der Kasse nach." };
    case "disabled": return { title: "NFC ist hier aus", detail: "Für dieses Programm ist die NFC-Berührung gerade ausgeschaltet. Zeige stattdessen deinen Kartencode an der Kasse." };
    case "error":
      if (error instanceof ClientApiError && error.status === 404) return { title: "Dieses Schild ist gerade nicht aktiv", detail: "Bitte nutze den QR-Code an der Kasse oder frage das Team." };
      if (error instanceof ClientApiError && error.status === 429) return { title: "Zu viele Versuche", detail: "Bitte warte einen Moment und berühre das Schild erneut." };
      if (error instanceof ClientApiError && error.status === 0) return { title: "Keine Verbindung", detail: error.message };
      return { title: "Berührung nicht bestätigt", detail: "Die Berührung konnte nicht geprüft werden. Bitte berühre das Schild erneut." };
  }
}

/**
 * The stamp moment plays for a stamp booked while this page watched: an automatic award, or a confirmation after
 * waiting. Reloading a confirmed tap shows the same result without a second "+1".
 */
export function playsStampMoment(state: TapState, waited: boolean) {
  return state === "awarded" || (state === "confirmed" && waited);
}

/** What the status line announces once a stamp (or the team's points) is booked. */
export function stampAnnouncement(state: TapState | "loading" | "error", balance?: number, points = false) {
  return (state === "confirmed" || state === "awarded") && typeof balance === "number" ? `${points ? "Punkte" : "Stempel"} erhalten, neuer Stand ${balance}.` : null;
}

/** The guest's card with the booked balance; during the stamp moment its new stamp lands. */
export function TapCardFace({ card, balance, moment }: { card: CardResponse; balance: number; moment: boolean }) {
  const rewards = card.rewards.map(({ id, title, cost }) => ({ id, title, cost }));
  return <CardFace className={styles.card} businessName={card.merchantName} locationName={card.locationName} programType={card.programType === "stamp" ? "stamps" : "points"} balance={balance} rewards={rewards} selected={nearestReward(rewards, balance)} landed={moment ? balance : undefined} />;
}

export function TapClient({ refId }: { refId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [card, setCard] = useState<CardResponse | null>(null);
  const [error, setError] = useState<Error | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  const [selectionRequired, setSelectionRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [moment, setMoment] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pollingController: AbortController | undefined;
    let waited = false;
    const path = `/api/tap/${encodeURIComponent(refId)}${window.location.search}`;
    function report(processed: Result, info: Preview, boundRef = refId) {
      if (!active) return;
      if (processed.state === "pending_staff") waited = true;
      setMoment(playsStampMoment(processed.state, waited));
      setResult(processed);
      if (processed.state === "pending_staff") {
        if (!processed.requestId) throw new Error("Die wartende Anfrage konnte nicht geladen werden.");
        // Waiting is a card-authorized read, so it never spends the shared allowance for a fresh physical tap.
        const requestId = processed.requestId;
        timer = setTimeout(() => void poll(info, requestId, processed.statusRef ?? boundRef), POLL_MS);
      }
    }
    async function poll(info: Preview, requestId: string, boundRef: string) {
      if (!active) return;
      const controller = new AbortController();
      pollingController = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const processed = await apiJson<Result>(`/api/tap/${encodeURIComponent(boundRef)}/status/${encodeURIComponent(requestId)}`, { signal: controller.signal });
        report(processed, info, boundRef);
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ClientApiError && (cause.status === 0 || cause.status === 429 || cause.status >= 500)) {
          // Keep waiting across temporary failures; the server will still decide confirmation, cancellation and expiry.
          const delay = Math.min(15 * 60_000, Math.max(POLL_MS, cause.retryAfterMs ?? POLL_MS));
          timer = setTimeout(() => void poll(info, requestId, boundRef), delay);
        } else setError(cause instanceof Error ? cause : new Error("Berührung nicht bestätigt"));
      } finally { clearTimeout(timeout); }
    }
    async function process(info: Preview) {
      // Only the initial submission verifies the chip and creates a request. Retrying that submission remains idempotent.
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const interaction = document.visibilityState === "visible" && (selected || navigation?.type === "navigate");
      report(await apiJson<Result>(path, { method: "POST", headers: {
        ...(selected ? { "X-Loynara-Card-Selected": selected } : {}),
        ...(interaction ? { "X-Loynara-Customer-Interaction": "nfc_visit" } : {}),
      } }), info);
    }
    void apiJson<Preview>(path).then(async info => {
      if (!active) return;
      setPreview(info);
      if (!info.hasMembership) { setResult({ state: "needs_enrollment" }); return; }
      if (info.mode === "disabled") { setResult({ state: "disabled" }); return; }
      if (info.requiresSelection && info.cardLocator !== selected) { setSelectionRequired(true); return; }
      // Read the card while the tap is processed, so it is on screen without a jump when the stamp is booked.
      if (info.cardPath) void apiJson<CardResponse>(`/api${info.cardPath}`).then(value => { if (active) setCard(value); }).catch(() => {});
      await process(info);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause : new Error("Berührung nicht bestätigt")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (timer) clearTimeout(timer); pollingController?.abort(); };
  }, [refId, selected]);

  const state: TapState | "loading" | "error" = loading ? "loading" : error ? "error" : (result?.state ?? "loading");
  // A card created or opened later in this tab continues this tap (the join page and the card page read the stored path).
  useEffect(() => {
    const here = `${window.location.pathname}${window.location.search}`;
    if ((state === "needs_enrollment" || selectionRequired) && TAP_URL.test(here)) sessionStorage.setItem(TAP_RETURN_KEY, here);
  }, [state, selectionRequired]);

  const points = preview?.programType === "points";
  const { title, detail } = selectionRequired ? { title: "Welche Karte gehört zu diesem Besuch?", detail: "Dieses Gerät wird geteilt. Bestätige deine gespeicherte Karte oder öffne deinen eigenen privaten Kartenlink." } : preview?.recoveryRequired && state === "needs_enrollment" ? { title: "Deine Karte wiederfinden", detail: "Der gespeicherte Zugang ist abgelaufen oder wurde widerrufen. Öffne deinen aktuellen privaten Kartenlink oder nutze die sichere Wiederherstellung." } : tapCopy(state, error, points);
  const waiting = state === "pending_staff";
  const recoveryCard = preview?.cardPath?.match(/^\/card\/(card_[A-Za-z0-9_-]{32,80})$/)?.[1];
  const done = state === "confirmed" || state === "awarded" || state === "already_processed";
  const celebrate = moment && done;
  const announcement = stampAnnouncement(state, result?.balance, points);
  const plus = !celebrate ? null : points ? (result?.credited ? `+${result.credited}` : null) : card?.programType === "stamp" ? "+1" : null;
  const tone = state === "error" || state === "cancelled" || state === "expired" ? "error" : done ? "done" : waiting ? "waiting" : "info";
  const Icon = tone === "error" ? TriangleAlert : done ? CheckCircle2 : waiting ? Clock3 : Nfc;
  const header = preview ? <div className={styles.merchant}><span className={styles.mono} aria-hidden="true">{Array.from(preview.merchantName)[0]}</span><p><strong>{preview.merchantName}</strong><span>{preview.locationName} · {preview.programName}</span></p></div> : null;
  return <CustomerShell brandColor={preview?.brandColor} header={header} footer={<LegalLinks locale="de" />}>
    <section className={`card-state-page ${styles.state}`} data-tone={tone} data-moment={celebrate || undefined}>
      <span className={styles.icon} aria-hidden="true"><Icon size={28} />{plus && <span className={styles.plus}>{plus}</span>}</span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.detail} role={state === "error" ? "alert" : "status"} aria-live="polite">{announcement && <span className={styles.srOnly}>{announcement} </span>}{detail}</p>
      {done && card && typeof result?.balance === "number" && <TapCardFace card={card} balance={result.balance} moment={celebrate} />}
      {result?.cardLocator && STATES_WITH_CARD_NUMBER.includes(state as TapState) && <p className={styles.number}><span>Deine Kartennummer (das Team sieht sie an der Kasse):</span> <strong translate="no">{result.cardLocator}</strong></p>}
      {waiting && <p className={styles.muted}>Die Seite aktualisiert sich automatisch, sobald das Team bestätigt hat.</p>}
      {typeof result?.balance === "number" && state !== "needs_enrollment" && !(done && card) && <p className={styles.balance}>Aktueller Stand: {result.balance} {points ? "Punkte" : "Stempel"}</p>}
      {selectionRequired && preview?.cardPath && <div className={styles.actions}>
        <button className={buttonClassName({ size: "lg", block: true })} onClick={() => { setSelectionRequired(false); setSelected(preview.cardLocator ?? null); setLoading(true); }}>Mit meiner gespeicherten Karte fortfahren</button>
        <a className={buttonClassName({ variant: "secondary", block: true })} href={preview.cardPath} onClick={() => sessionStorage.removeItem(TAP_RETURN_KEY)}>Gespeicherte Karte {preview.cardLocator} ansehen</a>
      </div>}
      {preview && state === "needs_enrollment" && <div className={styles.actions}>
        <Link prefetch={false} className={buttonClassName({ size: "lg", block: true })} href={`/join/${encodeURIComponent(preview.programSlug)}`}>Karte erstellen</Link>
        <p className={styles.muted}><strong>Du hast schon eine Karte?</strong> Öffne deinen gespeicherten Kartenlink in diesem Browser-Tab. Danach geht es hier automatisch weiter. Eine Kartennummer allein reicht nicht als Nachweis.</p>
        <p className={styles.link}><Link href="/recover">Karte sicher wiederherstellen</Link></p>
      </div>}
      {preview?.cardPath && state !== "needs_enrollment" && <Link className={buttonClassName({ variant: "secondary", block: true })} href={preview.cardPath}>Karte und Prämien ansehen</Link>}
      {state === "error" && <p className={styles.muted}>Du kannst jederzeit stattdessen den QR-Code an der Kasse zeigen.</p>}
    </section>
    {recoveryCard && !selectionRequired && ["pending_staff", "confirmed", "awarded", "already_processed"].includes(state) && <CardContact key={recoveryCard} token={recoveryCard} locale={card?.locale === "fr" ? "fr" : "de"} recoveryOnly />}
  </CustomerShell>;
}
