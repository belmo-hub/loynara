"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { prepareAppleWallet, walletMessage } from "./wallet-preparation";
import styles from "./customer/wallet-step.module.css";

/**
 * ENG-130: the Wallet step is offered once per card on this device. "pending" = the join handed over to a tap
 * continuation and the tap page offers it after the stamp; "shown" = offered; "saved" = the card page has shown its
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

/** Where a successful join goes: a pending tap continues first, then the Wallet step on an iPhone where the location has Apple Wallet. */
export function afterJoin({ tap, ios, appleWallet, mark }: { tap: boolean; ios: boolean; appleWallet: boolean; mark: WalletStepMark | null }): { go: "tap" | "step" | "card"; mark?: "pending" } {
  const offer = ios && appleWallet && mark === null;
  if (tap) return offer ? { go: "tap", mark: "pending" } : { go: "tap" };
  return { go: offer ? "step" : "card" };
}

/** The tap page offers the step after a booked stamp, only for a card the join handed over; it then asks the location for Apple Wallet again. */
export const tapOffersWalletStep = ({ done, ios, mark }: { done: boolean; ios: boolean; mark: WalletStepMark | null }) => done && ios && mark === "pending";

type Props = { token: string; businessName: string; programType: "stamp" | "points"; messages: boolean; band?: boolean };

/** Screens 03–07: why Wallet, a lock-screen picture (the example owner message only while walletMessages is on), the Apple button and the skip link. */
export function WalletStep({ token, businessName, programType, messages, band }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  const cardHref = `/card/${encodeURIComponent(token)}`;
  const initial = Array.from(businessName)[0];

  useEffect(() => {
    markWalletStep(token, "shown");
    return () => operation.current?.abort();
  }, [token]);

  async function add() {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError("");
    try {
      const url = await prepareAppleWallet(token, controller.signal);
      if (controller.signal.aborted) return;
      window.location.assign(url);
      // Apple's sheet opens over this page; the card is underneath when the customer comes back (screen 08).
      setTimeout(() => router.replace(cardHref), 4000);
    } catch (cause) {
      if (!controller.signal.aborted) { setError(walletMessage(cause, false)); setBusy(false); }
      operation.current = null;
    }
  }

  const Heading = band ? "h2" : "h1";
  return <section className={styles.step} data-band={band || undefined} aria-labelledby="wallet-step-title">
    <Heading id="wallet-step-title" className={styles.title}>Deine Karte ist fertig. Leg sie in Apple Wallet.</Heading>
    <p className={styles.lead}>Dann ist sie immer griffbereit, bei deinen anderen Karten. Kein Link, den du suchen musst.</p>
    <div className={styles.lock} role="group" aria-label="So sieht das auf dem Sperrbildschirm aus">
      <p className={styles.alert}><span className={styles.mono} aria-hidden="true">{initial}</span><span className={styles.from}><strong>{businessName}</strong><small>jetzt</small></span><span className={styles.text}>Deine Prämie ist bereit. Du kannst sie an der Kasse einlösen.</span></p>
      {messages && <p className={styles.alert}><span className={styles.mono} aria-hidden="true">{initial}</span><span className={styles.from}><strong>{businessName}</strong><em className={styles.example}>Beispiel</em><small>gestern</small></span><span className={styles.text}>Heute bis 17 Uhr: Kuchen zum Kaffee für 2 €.</span></p>}
    </div>
    {messages && <p className={styles.muted}>Angebote vom Laden nur, wenn du es erlaubst: höchstens 2 pro Woche, jederzeit abschaltbar.</p>}
    {/* shortcut: house black button with Apple's wording until Apple's German badge artwork is in public/wallet. */}
    <button type="button" className={styles.apple} onClick={() => void add()} disabled={busy} aria-busy={busy}>{busy ? "Wird vorbereitet …" : "Zu Apple Wallet hinzufügen"}</button>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.skip}><Link href={cardHref}>Später, zuerst meine Karte ansehen</Link></p>
    <p className={styles.muted}>{programType === "points" ? "Punkte" : "Stempel"} sammelst du auch ohne Wallet. Speichern kannst du die Karte später unter „In Wallet speichern“.</p>
  </section>;
}
