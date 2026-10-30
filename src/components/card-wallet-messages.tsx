"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiJson, postJson } from "./client-api";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import styles from "./customer/panels.module.css";

type Consent = { available: boolean; granted: boolean; givenAt: string | null; shop: string; text: string };
const LINK = "Mehr in den Datenschutzhinweisen.";

/** The lines around Legal's box; points programmes with an expiry rule (in force or pending) name the expiry notice, which needs no tick (Legal, ENG-130). */
export function consentLines(expiry: boolean) {
  return expiry
    ? { under: "Deinen neuen Kontostand, „Prämie bereit“ und den Hinweis, bevor Punkte verfallen, siehst du immer, auch ohne Häkchen.", off: "aus. Kontostand, „Prämie bereit“ und der Hinweis vor dem Punkteverfall kommen weiter." }
    : { under: "Deinen neuen Kontostand und „Prämie bereit“ siehst du immer, auch ohne Häkchen.", off: "aus. Kontostand und „Prämie bereit“ kommen weiter." };
}

/**
 * Wallet-message consent (ENG-043): one unticked box with Legal's text, saved on the tap; unticking switches it off without
 * touching the pass. Legal's wording is German only. Renders nothing while the walletMessages surface is withheld (the
 * endpoint answers 404) or the card holds no pass that can get messages (Apple; Google too with ENG-054's marketing flag).
 * ENG-130: re-read when the page comes back into view (the return from Apple's sheet); `first` = the first card view after
 * the pass is saved, where the panel sits under the card with a heading. `onShown` tells the page whether it renders.
 */
export function CardWalletMessages({ token, expiry = false, first = false, onShown }: { token: string; expiry?: boolean; first?: boolean; onShown?: (shown: boolean) => void }) {
  const [state, setState] = useState<Consent | null>(null);
  const [busy, setBusy] = useState(false);
  const [switchedOff, setSwitchedOff] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/card/${encodeURIComponent(token)}/wallet-messages`;

  useEffect(() => {
    let active = true;
    const read = () => void apiJson<Consent>(url).then(result => { if (active) setState(result); }).catch(() => { /* the card works without this panel */ });
    const visible = () => { if (document.visibilityState === "visible") read(); };
    read();
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; document.removeEventListener("visibilitychange", visible); };
  }, [url]);
  const shown = Boolean(state?.available);
  useEffect(() => { onShown?.(shown); }, [shown, onShown]);

  async function change(granted: boolean) {
    setBusy(true); setError("");
    try {
      await postJson(url, { granted });
      setState(await apiJson<Consent>(url)); setSwitchedOff(!granted);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Die Einstellung konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  if (!state?.available) return null;
  const [lead] = state.text.split(LINK);
  const lines = consentLines(expiry);
  const switchOff = <Button variant="secondary" size="sm" loading={busy} onClick={() => void change(false)}>Abschalten</Button>;
  return <section className={styles.panel} aria-label="Nachrichten auf der Wallet-Karte">
    {state.granted ? <>
      <p>Von {state.shop} · Höchstens 2 pro Woche · an</p>
      {state.givenAt && <p className={styles.muted}>Erlaubt am {new Date(state.givenAt).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
      {switchOff}
    </> : switchedOff ? <>
      <p>{lines.off}</p>
      <Button variant="secondary" size="sm" onClick={() => setSwitchedOff(false)}>Einschalten</Button>
    </> : <>
      {first && <h2 className={styles.title}>{`Darf dir ${state.shop} Nachrichten auf deine Karte schicken?`}</h2>}
      <Checkbox checked={false} disabled={busy} onChange={() => void change(true)}>{lead}<Link href="/datenschutz">{LINK}</Link></Checkbox>
      <p className={styles.muted}>{lines.under}</p>
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
