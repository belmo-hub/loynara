"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiJson, postJson } from "./client-api";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import styles from "./customer/panels.module.css";

type Consent = { available: boolean; granted: boolean; givenAt: string | null; shop: string; text: string };
const LINK = "Mehr in den Datenschutzhinweisen.";

/**
 * Wallet-message consent (ENG-043): one unticked box with Legal's text, saved on the tap; unticking switches it off without
 * touching the pass. Legal's wording is German only. Renders nothing while the walletMessages surface is withheld (the
 * endpoint answers 404) or the card holds no Apple pass.
 */
export function CardWalletMessages({ token }: { token: string }) {
  const [state, setState] = useState<Consent | null>(null);
  const [busy, setBusy] = useState(false);
  const [switchedOff, setSwitchedOff] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/card/${encodeURIComponent(token)}/wallet-messages`;

  useEffect(() => {
    let active = true;
    void apiJson<Consent>(url).then(result => { if (active) setState(result); }).catch(() => { /* the card works without this panel */ });
    return () => { active = false; };
  }, [url]);

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
  const switchOff = <Button variant="secondary" size="sm" loading={busy} onClick={() => void change(false)}>Abschalten</Button>;
  return <section className={styles.panel} aria-label="Nachrichten auf der Wallet-Karte">
    {state.granted ? <>
      <p>Von {state.shop} · Höchstens 2 pro Woche · an</p>
      {state.givenAt && <p className={styles.muted}>Erlaubt am {new Date(state.givenAt).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
      {switchOff}
    </> : switchedOff ? <>
      <p>aus. Kontostand und „Prämie bereit“ kommen weiter.</p>
      <Button variant="secondary" size="sm" onClick={() => setSwitchedOff(false)}>Einschalten</Button>
    </> : <>
      <Checkbox checked={false} disabled={busy} onChange={() => void change(true)}>{lead}<Link href="/datenschutz">{LINK}</Link></Checkbox>
      <p className={styles.muted}>Deinen neuen Kontostand und „Prämie bereit“ siehst du immer, auch ohne Häkchen.</p>
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
