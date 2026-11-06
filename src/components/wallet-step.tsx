"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ClientApiError, type PublicProgram } from "./client-api";
import { prepareAppleWallet, waitForSheet, walletMessage } from "./wallet-preparation";
import styles from "./customer/wallet-step.module.css";

/**
 * ENG-130: the Wallet step is offered once per card on this device. "pending" = the join handed over to a tap
 * continuation and the tap page offers it while the team confirms or after the stamp (ENG-160); "shown" = offered; "saved" = the card page has shown its
 * return from Wallet (screen 08).
 */
export type WalletStepMark = "pending" | "shown" | "saved";
const key = (token: string) => `loynara_wallet_step:${token}`;
export function readWalletStep(token: string): WalletStepMark | null {
  try { return localStorage.getItem(key(token)) as WalletStepMark | null; } catch { return null; }
}
export function markWalletStep(token: string, mark: WalletStepMark) {
  try { localStorage.setItem(key(token), mark); } catch { /* private mode: the step may show again, nothing breaks */ }
}

/** ENG-130 (01): on an iPhone where this location has Apple Wallet, the join names the iPhone and offers the Wallet step (German shops only). */
export const iphoneJoin = (platform: "ios" | "android" | "other", program: Pick<PublicProgram, "appleWallet" | "locale">) => platform === "ios" && program.appleWallet === true && program.locale !== "fr";

const TAP_URL = /^\/tap\/[A-Za-z0-9_-]{24}\?e=[a-fA-F0-9]{32}&c=[a-fA-F0-9]{16}$/;

/**
 * Where a successful join goes and the mark it leaves: a stored tap continues first (the tap page then offers the step),
 * else the Wallet step once where `offer` holds (iPhone, the location's Apple Wallet, a German shop: iphoneJoin).
 */
export function afterJoin({ continuation, offer, mark }: { continuation: string | null; offer: boolean; mark: WalletStepMark | null }): { go: "tap" | "step" | "card"; mark?: WalletStepMark } {
  const first = offer && mark === null;
  if (continuation && TAP_URL.test(continuation)) return first ? { go: "tap", mark: "pending" } : { go: "tap" };
  return first ? { go: "step", mark: "shown" } : { go: "card" };
}

/**
 * The tap page asks the location again, only for a card the join handed over: while the customer waits for the team
 * (founder, ENG-160: alone at the counter nobody may confirm) or once the stamp is booked.
 */
export const tapAsksForWalletStep = ({ done, waiting, ios, mark }: { done: boolean; waiting: boolean; ios: boolean; mark: WalletStepMark | null }) => (done || waiting) && ios && mark === "pending";
/** With the location's answer the hand-over ends either way ("shown"); the band shows only where the join would have offered it. */
export const tapWalletStep = (program: Pick<PublicProgram, "appleWallet" | "locale">) => ({ show: iphoneJoin("ios", program), mark: "shown" as const });

/** The step's error line. Nobody pressed anything on the unprompted run, so „Zu viele Versuche“ waits for a real press. */
export const walletStepError = (cause: unknown, unprompted: boolean) => unprompted && cause instanceof ClientApiError && cause.code === "RATE_LIMIT" ? "" : walletMessage(cause, false);

type Props = { token: string; program: Pick<PublicProgram, "businessName" | "programType" | "walletMessages">; band?: boolean;
  /** As a band on the tap page until the stamp is booked: stay there after Apple's sheet, so a rejected or expired
   *  request still shows its state (ENG-160). */
  stay?: boolean;
  /** Told once Apple's sheet opens, so the tap page leaves the stamp's scroll to the sheet's return. */
  onAdd?: () => void;
  /** ENG-172: open Apple's sheet on arrival, as if the button was pressed; this screen or band stays as the fallback. */
  auto?: boolean };

/** Screens 03–07: why Wallet, a lock-screen picture (the example owner message only while walletMessages is on), the Apple button and the skip link. */
export function WalletStep({ token, program: { businessName, programType, walletMessages }, band, stay = false, onAdd, auto = false }: Props) {
  const messages = walletMessages === true;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  // The unprompted run after the hand-over: it only watches for the sheet, and a press takes over from it.
  const watching = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const cardHref = `/card/${encodeURIComponent(token)}`;
  const initial = Array.from(businessName)[0];
  // Read when Apple's sheet has had its 4 s: the stamp may have landed meanwhile.
  const stayRef = useRef(stay);
  useEffect(() => { stayRef.current = stay; }, [stay]);
  // Back from Apple's sheet on the waiting tap page: once the stamp lands, the card takes over (ENG-130 screen 08).
  const [back, setBack] = useState(false);
  useEffect(() => { if (back && !stay) router.replace(cardHref); }, [back, stay, router, cardHref]);

  useEffect(() => () => { operation.current?.abort(); operation.current = null; watching.current?.abort(); }, []);

  async function add(unprompted = false) {
    if (operation.current) return;
    watching.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    // A second add starts afresh: an earlier return from the sheet must not send this one to the card early.
    setBusy(true); setError(""); setBack(false);
    try {
      const url = await prepareAppleWallet(token, controller.signal);
      if (controller.signal.aborted) return;
      window.location.assign(url);
      // Nothing is being prepared any more, and a press is what rescues a refused sheet (ENG-172).
      if (unprompted) {
        operation.current = null; watching.current = controller; setBusy(false);
        if (!await waitForSheet(token, controller.signal)) return;
        onAdd?.();
        // As after a press: the waiting tap page stays until the stamp lands.
        if (stayRef.current) setBack(true); else router.replace(cardHref);
        return;
      }
      // Only an add that reached Apple's sheet counts: a failed prepare keeps the band and its error on the tap page.
      onAdd?.();
      // Apple's sheet opens over this page; the card is underneath when the customer comes back (screen 08). While the
      // tap page still waits for the team it stays there instead, so the customer sees the stamp confirmed (ENG-160).
      setTimeout(() => {
        if (!stayRef.current) { router.replace(cardHref); return; }
        operation.current = null; setBusy(false); setBack(true);
      }, 4000);
    } catch (cause) {
      if (!controller.signal.aborted) { setError(walletStepError(cause, unprompted)); setBusy(false); }
      if (operation.current === controller) operation.current = null;
    }
  }
  const addRef = useRef(add);
  useEffect(() => {
    if (!auto) return;
    // The step replaces the join in place: bring its heading to the top and give it focus, as CustomerState does.
    // The band sits under the tap page's state, which keeps the screen and the focus.
    if (!band) {
      heading.current?.scrollIntoView({ block: "start" });
      heading.current?.focus({ preventScroll: true });
    }
    void addRef.current(true);
  }, [auto, band]);

  const Heading = band ? "h2" : "h1";
  return <section className={styles.step} data-band={band || undefined} aria-labelledby="wallet-step-title">
    <Heading id="wallet-step-title" ref={heading} tabIndex={auto && !band ? -1 : undefined} className={styles.title}>Deine Karte ist fertig. Leg sie in Apple Wallet.</Heading>
    <p className={styles.lead}>Dann ist sie immer griffbereit, bei deinen anderen Karten. Kein Link, den du suchen musst.</p>
    <div className={styles.lock} role="group" aria-label="So sieht das auf dem Sperrbildschirm aus">
      <p className={styles.alert}><span className={styles.mono} aria-hidden="true">{initial}</span><span className={styles.from}><strong>{businessName}</strong><small>jetzt</small></span><span className={styles.text}>Deine Prämie ist bereit. Du kannst sie an der Kasse einlösen.</span></p>
      {messages && <p className={styles.alert}><span className={styles.mono} aria-hidden="true">{initial}</span><span className={styles.from}><strong>{businessName}</strong><em className={styles.example}>Beispiel</em><small>gestern</small></span><span className={styles.text}>Heute bis 17 Uhr: Kuchen zum Kaffee für 2 €.</span></p>}
    </div>
    {messages && <p className={styles.muted}>Angebote vom Laden nur, wenn du es erlaubst: höchstens 2 pro Woche, jederzeit abschaltbar.</p>}
    {/* Apple's German badge as supplied (ENG-132), named as it reads; never dimmed while busy, the status line says so. */}
    <button type="button" className={styles.apple} onClick={() => void add()} disabled={busy} aria-busy={busy}><Image unoptimized src="/wallet/apple-add-de.svg" alt="Hinzufügen zu Apple Wallet" width={166} height={52} /></button>
    <p className={styles.busy} role="status">{busy ? "Wird vorbereitet …" : ""}</p>
    {error && <p className={styles.error} role="alert"><TriangleAlert size={16} aria-hidden="true" />{error}</p>}
    <p className={styles.skip}><Link href={cardHref}>Später, zuerst meine Karte ansehen</Link></p>
    <p className={styles.muted}>{programType === "points" ? "Punkte" : "Stempel"} sammelst du auch ohne Wallet. Speichern kannst du die Karte später unter „In Wallet speichern“.</p>
  </section>;
}
