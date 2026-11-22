"use client";

import { DEMO_PRIVACY_LINK, demoConsentStatus } from "@/lib/demo-texts";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiJson, postJson } from "./client-api";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import styles from "./customer/panels.module.css";

type Consent = { available: boolean; granted: boolean; givenAt: string | null; shop: string; text: string; /** Demo environment: Legal's demo wording, Loynara as the sender. */ demo?: boolean };
const LINK = "Mehr in den Datenschutzhinweisen.";

/** The lines around Legal's box; points programmes with an expiry rule (in force or pending) name the expiry notice, which needs no tick (Legal, ENG-130). */
export function consentLines(expiry: boolean) {
  return expiry
    ? { under: "Deinen neuen Kontostand, „Prämie bereit“ und den Hinweis, bevor Punkte verfallen, siehst du immer, auch ohne Häkchen.", off: "Kontostand, „Prämie bereit“ und der Hinweis vor dem Punkteverfall kommen weiter." }
    : { under: "Deinen neuen Kontostand und „Prämie bereit“ siehst du immer, auch ohne Häkchen.", off: "Kontostand und „Prämie bereit“ kommen weiter." };
}

/** After switching off, the panel keeps its off state even when the card no longer offers consent (its pass unreachable, ENG-162). */
export const panelShown = (available: boolean, switchedOff: boolean) => available || switchedOff;

/** On: also what a guest who ticked at the join sees, before any pass exists, so the off switch is always here (Legal, Art. 7(3)). */
/** The consent box's text and its privacy link; in the demo Legal's link to the demo notice (follow-up d). */
export const ConsentLabel = ({ lead, demo = false }: { lead: string; demo?: boolean }) =>
  demo ? <>{lead} <Link href="/datenschutz">{DEMO_PRIVACY_LINK}</Link></> : <>{lead}<Link href="/datenschutz">{LINK}</Link></>;

export function SwitchedOn({ shop, givenAt, busy, onSwitchOff, demo = false }: { shop: string; givenAt: string | null; busy: boolean; onSwitchOff: () => void; demo?: boolean }) {
  return <>
    <p>{demo ? demoConsentStatus(shop, true) : `Von ${shop} · Höchstens 2 pro Woche · an`}</p>
    {givenAt && <p className={styles.muted}>Erlaubt am {new Date(givenAt).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
    <Button variant="secondary" size="sm" loading={busy} onClick={onSwitchOff}>Abschalten</Button>
  </>;
}

/** Just switched off. The off line and „Einschalten“ only while the card still offers consent: an unreachable pass gets neither (Design, ENG-162). */
export function SwitchedOff({ shop, available, off, onSwitchOn, demo = false }: { shop: string; available: boolean; off: string; onSwitchOn: () => void; demo?: boolean }) {
  return <>
    <p>{demo ? demoConsentStatus(shop, false) : `Von ${shop} · Höchstens 2 pro Woche · aus`}</p>
    {available && <p className={styles.muted}>{off}</p>}
    {available && <Button variant="secondary" size="sm" onClick={onSwitchOn}>Einschalten</Button>}
  </>;
}

/**
 * Wallet-message consent (ENG-043): one unticked box with Legal's text, saved on the tap; unticking switches it off without
 * touching the pass. Legal's wording is German only. Renders nothing while the walletMessages surface is withheld (the
 * endpoint answers 404) or the card holds no pass that can get messages (Apple; Google too with ENG-054's marketing flag).
 * ENG-130: the unticked box has a heading; re-read when the page comes back into view (the return from Apple's sheet).
 * `onShown` tells the page whether it renders (the page places it under the card once, after the pass is saved).
 */
export function CardWalletMessages({ token, expiry = false, onShown }: { token: string; expiry?: boolean; onShown?: (shown: boolean) => void }) {
  const [state, setState] = useState<Consent | null>(null);
  const [busy, setBusy] = useState(false);
  const [switchedOff, setSwitchedOff] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/card/${encodeURIComponent(token)}/wallet-messages`;

  const shownRef = useRef(false); // = Boolean(state?.available), readable from the listener

  useEffect(() => {
    let active = true;
    const read = () => void apiJson<Consent>(url).then(result => { if (active) setState(result); }).catch(() => { /* the card works without this panel */ });
    // Only a panel not yet shown re-reads: the reads share their per-card and per-network limits with the tick itself.
    const visible = () => { if (document.visibilityState === "visible" && !shownRef.current) read(); };
    read();
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; document.removeEventListener("visibilitychange", visible); };
  }, [url]);
  const shown = panelShown(Boolean(state?.available), switchedOff);
  useEffect(() => { shownRef.current = shown; onShown?.(shown); }, [shown, onShown]);

  async function change(granted: boolean) {
    setBusy(true); setError("");
    try {
      await postJson(url, { granted });
      setState(await apiJson<Consent>(url)); setSwitchedOff(!granted);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Die Einstellung konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  if (!state || !shown) return null;
  const [lead] = state.text.split(LINK);
  const lines = consentLines(expiry);
  return <section className={styles.panel} aria-label="Nachrichten auf deiner Wallet-Karte">
    {(state.granted || switchedOff) && <h2 className={styles.title}>Nachrichten auf deiner Wallet-Karte</h2>}
    {state.granted ? <SwitchedOn demo={state.demo} shop={state.shop} givenAt={state.givenAt} busy={busy} onSwitchOff={() => void change(false)} /> : switchedOff ? <SwitchedOff demo={state.demo} shop={state.shop} available={state.available} off={lines.off} onSwitchOn={() => setSwitchedOff(false)} /> : <>
      {!state.demo && <h2 className={styles.title}>{`Darf dir ${state.shop} Nachrichten auf deine Karte schicken?`}</h2>}
      <Checkbox checked={busy} disabled={busy} onChange={() => void change(true)}><ConsentLabel lead={lead} demo={state.demo} /></Checkbox>
      <p className={styles.muted}>{lines.under}</p>
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
