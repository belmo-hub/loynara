"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiJson, ClientApiError, type CardResponse, type PublicProgram } from "./client-api";
import { CardContact } from "./card-contact";
import { Gift, TriangleAlert } from "lucide-react";
import { CardFace, cardGoal, nearestReward } from "./customer/card-face";
import { markSeen, TAP_MARK_SLACK_MS } from "./customer/booking-moment";
import { CustomerState, StateLink } from "./customer/customer-state";
import { buttonClassName } from "./ui/button";
import styles from "./customer/tap.module.css";
import { walletPlatform } from "./wallet-preparation";
import { markWalletStep, readWalletStep, tapAsksForWalletStep, tapWalletStep, WalletStep } from "./wallet-step";

type Preview = { merchantName: string; locationName: string; programName: string; programSlug: string; programType?: "stamp" | "points"; brandColor: string; mode: "disabled" | "automatic_fixed" | "staff_confirmed"; hasMembership: boolean; cardLocator?: string; requiresSelection?: boolean; recoveryRequired?: boolean; cardPath?: string; /** Present only while STAMP_ANIMATION_ENABLED is on (ENG-206). */ stampMoment?: true };
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
    case "confirmed": return { title: "Punkte erhalten", detail: "Das Team hat deine Punkte bestätigt. Sie sind jetzt auf deiner Karte." };
    case "cooldown": return { title: "Gerade erst gesammelt", detail: "Auf deiner Karte sind gerade erst Punkte dazugekommen. Beim nächsten Besuch kannst du das Schild wieder berühren." };
  }
  switch (state) {
    case "loading": return { title: "NFC-Berührung wird geprüft", detail: "Einen Moment bitte." };
    case "needs_enrollment": return { title: "Deine Karte erstellen", detail: "Mit einer kostenlosen Karte im Browser sammelst du Stempel. Du brauchst keine App." };
    case "pending_staff": return { title: "Warte auf das Team", detail: "Das Team an der Kasse bestätigt deinen Stempel. Du musst nichts weiter tun." };
    case "confirmed": return { title: "Stempel erhalten", detail: "Das Team hat deinen Stempel bestätigt. Er ist jetzt auf deiner Karte." };
    case "awarded": return { title: "Stempel erhalten", detail: "Ein Stempel wurde bestätigt und ist jetzt auf deiner Karte." };
    case "already_processed": return { title: "Schon erledigt", detail: "Diese Berührung wurde bereits verarbeitet. Es wurde nichts doppelt gezählt." };
    case "cooldown": return { title: "Gerade erst gestempelt", detail: "Auf deiner Karte ist gerade erst ein Stempel dazugekommen. Beim nächsten Besuch kannst du das Schild wieder berühren." };
    case "expired": return { title: "Anfrage abgelaufen", detail: "Das Team hat diese Anfrage nicht rechtzeitig bestätigt. Berühre das Schild noch einmal, um es erneut zu versuchen." };
    case "cancelled": return { title: "Nicht bestätigt", detail: "Das Team hat diese Anfrage nicht bestätigt. Frage bitte an der Kasse nach." };
    case "disabled": return { title: "NFC ist hier aus", detail: "Für dieses Programm ist die NFC-Berührung gerade ausgeschaltet. Zeige stattdessen deinen Kartencode an der Kasse." };
    case "error":
      if (error instanceof ClientApiError && error.code === "PLATE_UNLINKED") return { title: "Dieses Schild ist gerade keinem Geschäft zugeordnet.", detail: "Hier wird nichts gutgeschrieben. Bitte frag das Team an der Kasse." };
      if (error instanceof ClientApiError && error.status === 404) return { title: "Dieses Schild ist gerade nicht aktiv.", detail: "Bitte nutze den QR-Code an der Kasse oder frage das Team." };
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
export function stampAnnouncement(state: TapState | "loading" | "error", balance?: number, points = false, credited?: number) {
  if ((state !== "confirmed" && state !== "awarded") || typeof balance !== "number") return null;
  // Screen readers hear the amount the booked pill shows (Design, 31 Oct).
  const what = points && credited ? `${credited} ${credited === 1 ? "Punkt" : "Punkte"}` : points ? "Punkte" : "Stempel";
  return `${what} erhalten, neuer Stand ${balance}.`;
}

/** „Aktueller Stand: 1 Punkt“, „… 2 Punkte“; stamps read the same in both numbers. */
export const currentBalance = (balance: number, points: boolean) => `Aktueller Stand: ${balance} ${points ? (balance === 1 ? "Punkt" : "Punkte") : "Stempel"}`;

const scrollToTop = () => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

/** The guest's card with the booked balance; during the stamp moment its new stamp lands. */
export function TapCardFace({ card, balance, moment }: { card: CardResponse; balance: number; moment: boolean }) {
  const rewards = card.rewards.map(({ id, title, cost }) => ({ id, title, cost }));
  return <CardFace businessName={card.merchantName} locationName={card.locationName} programType={card.programType === "stamp" ? "stamps" : "points"} balance={balance} rewards={rewards} selected={nearestReward(rewards, balance)}
    // The grid counts to the next reward not reached, held at the one before the landing stamp while it plays (Design, #300).
    goal={cardGoal(rewards, moment ? balance - 1 : balance)} landed={moment ? balance : undefined} />;
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
  const [walletProgram, setWalletProgram] = useState<PublicProgram | null>(null);

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
  // ENG-130: a card the join handed over to this tap gets the Wallet step after its stamp, asked of the location again.
  useEffect(() => {
    const locator = preview?.cardLocator;
    if (!preview || !locator || !recoveryCard || !tapAsksForWalletStep({ done, waiting, ios: walletPlatform() === "ios", mark: readWalletStep(locator) })) return;
    let active = true;
    void apiJson<PublicProgram>(`/api/program/${encodeURIComponent(preview.programSlug)}`).then(value => {
      if (!active) return;
      const step = tapWalletStep(value);
      markWalletStep(locator, step.mark);
      if (step.show) setWalletProgram(value);
    }).catch(() => {});
    return () => { active = false; };
  }, [preview, recoveryCard, done, waiting]);

  // The card page plays its own booking moment for bookings this device has not shown; this page just showed this one.
  const cardLocator = preview?.stampMoment ? preview.cardLocator : undefined;
  useEffect(() => { if (done && cardLocator) markSeen(cardLocator, new Date(Date.now() + TAP_MARK_SLACK_MS).toISOString()); }, [done, cardLocator]);
  const celebrate = moment && done;
  const cardRef = useRef<HTMLDivElement>(null);
  // Apple's sheet opened from the band (ENG-160): the band, not this page, then follows the stamp to the card.
  const [walletAdding, setWalletAdding] = useState(false);
  // A new state lands above a customer who scrolled down to the band: back to the top, as the page arrives (Design,
  // 31 Oct). The stamp only when the card is out of view and Apple's sheet did not open (the card page takes over then);
  // a request that ended (expired, rejected, failed) always, since those stay on this page.
  const ended = state === "expired" || state === "cancelled" || state === "error";
  useEffect(() => {
    const card = cardRef.current;
    if (celebrate && !walletAdding && card !== null && card.getBoundingClientRect().top < 0) scrollToTop();
  }, [celebrate, walletAdding]);
  // Its own effect, so an add on an already ended page does not scroll again behind Apple's sheet.
  useEffect(() => { if (ended && window.scrollY > 0) scrollToTop(); }, [ended]);
  const announcement = stampAnnouncement(state, result?.balance, points, result?.credited);
  // The 404 already says to use the QR code; every other error keeps the one path that still works (Design, 31 Oct).
  const inactivePlate = error instanceof ClientApiError && error.status === 404 && error.code !== "PLATE_UNLINKED";
  const number = result?.cardLocator && STATES_WITH_CARD_NUMBER.includes(state as TapState) ? result.cardLocator : null;
  // Mock 27–29 (G-07): the tap states on the guest state screen; an error carries the danger tile.
  return <CustomerState merchant={preview?.merchantName} brandColor={preview?.brandColor} title={title} tone={state === "error" ? "error" : "info"} live loading={state === "loading"}
    icon={state === "error" ? <TriangleAlert size={24} /> : undefined}
    message={<>{announcement && <span className={styles.srOnly}>{announcement} </span>}{detail}</>}>
    {/* A points visit's amount depends on what the cashier entered, so the booked state says what it brought (CTO, 31 Oct). */}
    {done && points && result?.credited ? <p className={styles.credited}><span>+{result.credited}</span> {result.credited === 1 ? "Punkt" : "Punkte"}</p> : null}
    {done && card && typeof result?.balance === "number" && <div ref={cardRef} className={styles.card} data-moment={celebrate || undefined}><TapCardFace card={card} balance={result.balance} moment={celebrate} /></div>}
    {number && waiting && <div className={styles.number}>
      <p><span>Deine Kartennummer (das Team sieht sie an der Kasse):</span> <strong translate="no">{number}</strong></p>
      <p className={styles.note}>Die Seite aktualisiert sich automatisch, sobald das Team bestätigt hat.</p>
    </div>}
    {typeof result?.balance === "number" && state !== "needs_enrollment" && !(done && card) && <p className={styles.balance}>{currentBalance(result.balance, points)}</p>}
    {selectionRequired && preview?.cardPath && <div className={styles.actions}>
      <button className={buttonClassName({ block: true })} onClick={() => { setSelectionRequired(false); setSelected(preview.cardLocator ?? null); setLoading(true); }}>Mit meiner gespeicherten Karte fortfahren</button>
      <a className={buttonClassName({ variant: "secondary", block: true })} href={preview.cardPath} onClick={() => sessionStorage.removeItem(TAP_RETURN_KEY)}>Gespeicherte Karte {preview.cardLocator} ansehen</a>
    </div>}
    {preview && state === "needs_enrollment" && <div className={styles.actions}>
      <Link prefetch={false} className={buttonClassName({ block: true })} href={`/join/${encodeURIComponent(preview.programSlug)}`}>Karte erstellen</Link>
      <p className={styles.muted}><strong>Du hast schon eine Karte?</strong> Öffne deinen gespeicherten Kartenlink in diesem Browser-Tab. Danach geht es hier automatisch weiter. Eine Kartennummer allein reicht nicht als Nachweis.</p>
      <p className={styles.link}><Link href="/recover">Karte sicher wiederherstellen</Link></p>
    </div>}
    {/* Keyed by where it stands: under the waiting words, under the state's blocks, or as the green next step under
        the booked card. In each place it arrives instead of jumping there. */}
    {preview?.cardPath && state !== "needs_enrollment" && <StateLink key={done ? "booked" : state === "loading" ? "wait" : "open"} href={preview.cardPath} icon={<Gift size={22} />} primary={done}>Karte und Prämien ansehen</StateLink>}
    {(waiting || state === "expired" || state === "cancelled" || (state === "error" && !inactivePlate)) && <p className={styles.muted}>Du kannst jederzeit stattdessen den QR-Code an der Kasse zeigen.</p>}
    {walletProgram && recoveryCard && <WalletStep band stay={!done} onAdd={() => setWalletAdding(true)} token={recoveryCard} program={walletProgram} />}
    {recoveryCard && !selectionRequired && ["pending_staff", "confirmed", "awarded", "already_processed"].includes(state) && <CardContact key={recoveryCard} token={recoveryCard} locale={card?.locale === "fr" ? "fr" : "de"} recoveryOnly />}
  </CustomerState>;
}
