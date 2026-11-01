"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Check, Mail } from "lucide-react";
import { apiJson, ClientApiError, postJson } from "./client-api";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { TextField } from "./ui/field";
import { Sheet } from "./ui/sheet";
import { CardStatusLine, useCardStatus } from "./customer/card-status";
import styles from "./customer/card-email.module.css";
import { EMAIL_CONSENT_TEXT_VERSION, emailConsentText } from "@/lib/email-consent-text";

// ENG-165: the e-mail offer under the card (once), the „E-Mail“ row in „Deine Karte“ and its sheet. One confirmation
// link confirms the address and, with the tick, the marketing consent (double opt-in). German only: French cards keep
// CardContact. While marketing mail is off the row is „Karte sichern“ and holds the address part only.

export type EmailStatus = {
  available: boolean; marketingAvailable: boolean; contactPresent: boolean; emailVerified: boolean; marketingEmail: boolean;
  maskedEmail: string | null; pending: "recovery" | "marketing" | null; linkExpired: boolean; marketingSince: string | null; recoverUrl: string; offer: boolean;
};
type Shop = { shop: string; location: string };

const INVALID = "Bitte gib eine gültige E-Mail-Adresse ein.";
const SEND_FAILED = "Konnte nicht gesendet werden. Versuch es gleich noch einmal.";
const SENT = "Wir haben dir einen Link geschickt.";
const HINT = "Mit dieser Adresse finde ich meine Karte wieder, falls ich den Link verliere. Sie wird nur dafür genutzt, nicht für Werbung.";
const consentLead = ({ shop, location }: Shop) => emailConsentText(shop, location);
const since = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
// The rate limit and a changed consent text bring their own German text; anything else is a failed send.
const sendError = (cause: unknown) => cause instanceof ClientApiError && (cause.status === 429 || cause.code === "CONSENT_TEXT_CHANGED") ? cause.message : SEND_FAILED;

/** The card's contact state, loaded once and after every change. Null until loaded or when the API fails (the card works without it). */
export function useEmailStatus(token: string) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const url = `/api/card/${encodeURIComponent(token)}/contact`;
  const reload = useCallback(async () => { setStatus(await apiJson<EmailStatus>(url)); }, [url]);
  useEffect(() => {
    let active = true;
    apiJson<EmailStatus>(url).then(result => { if (active) setStatus(result); }).catch(() => { /* the card stays usable without e-mail */ });
    return () => { active = false; };
  }, [url]);
  return { status, reload };
}

/** The „Deine Karte“ row: title and the state as its sub-line (E27–E29). */
export function emailRow(status: EmailStatus) {
  const marketing = status.marketingAvailable;
  const title = marketing ? "E-Mail" : "Karte sichern";
  const sub = status.emailVerified && status.maskedEmail ? `${status.maskedEmail} · ${marketing ? status.marketingEmail ? "Nachrichten an" : "Nachrichten aus" : "bestätigt"}`
    : status.contactPresent ? status.pending && !status.linkExpired ? "Bestätigung offen" : "Link abgelaufen"
    : marketing ? "Für Erinnerungen und zum Wiederfinden" : "Mit E-Mail wiederfinden";
  return { title, sub };
}

/** The field, Legal's hint, the optional tick and „Bestätigungslink schicken“; checks on tap, never a browser bubble. */
function AddressForm({ token, shop, consent, initialTick = false, onSent }: { token: string; shop: Shop; consent: boolean; initialTick?: boolean; onSent: (address: string, ticked: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [tick, setTick] = useState(initialTick);
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem("card-email") as HTMLInputElement;
    if (!email.trim() || !field.checkValidity()) { setFieldError(INVALID); field.focus(); return; }
    setBusy(true); setError("");
    try {
      await postJson(`/api/card/${encodeURIComponent(token)}/contact`, { email, ...(consent && tick ? { marketing: true, noticeVersion: EMAIL_CONSENT_TEXT_VERSION } : {}) });
      onSent(email.trim(), consent && tick);
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 400 && cause.code !== "CONSENT_TEXT_CHANGED") { setFieldError(INVALID); field.focus(); }
      else setError(sendError(cause));
    } finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={send} onInput={() => setFieldError("")} noValidate>
    <TextField id="card-email" name="card-email" label="E-Mail-Adresse" type="email" autoComplete="email" inputMode="email" placeholder="name@beispiel.de" maxLength={320}
      value={email} onChange={event => setEmail(event.target.value)} hint={HINT} error={fieldError || undefined} />
    {consent && <Checkbox checked={tick} onChange={event => setTick(event.target.checked)}>{consentLead(shop)}<Link href="/datenschutz">Mehr in den Datenschutzhinweisen.</Link></Checkbox>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <Button type="submit" variant="secondary" block loading={busy}>Bestätigungslink schicken</Button>
  </form>;
}

/** K03/K03b and the pending sheet's actions: resend to the stored address, or type another one. */
function Pending({ token, text, onOther, announce }: { token: string; text: ReactNode; onOther: () => void; announce: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function resend() {
    setBusy(true); setError("");
    try { await postJson(`/api/card/${encodeURIComponent(token)}/contact`, {}); announce(SENT); }
    catch (cause) { setError(sendError(cause)); }
    finally { setBusy(false); }
  }
  return <>
    {text}
    <p className={styles.muted}>Nichts angekommen? Schau im Spam-Ordner nach oder schick den Link noch einmal.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      <Button variant="secondary" block loading={busy} onClick={() => void resend()}>Link noch einmal schicken</Button>
      <Button variant="quiet" size="sm" className={styles.quiet} disabled={busy} onClick={onOther}>Andere Adresse eingeben</Button>
    </div>
  </>;
}

const sentLines = (ticked: boolean, offersSwitch: boolean) => ticked
  ? <p className={styles.text}>Erst wenn du ihn anklickst, bekommst du Nachrichten.</p>
  : <><p className={styles.text}>Erst wenn du ihn anklickst, ist deine Adresse bestätigt.</p>
    <p className={styles.muted}>Angebote und Erinnerungen bekommst du damit nicht.{offersSwitch ? " Du kannst sie unter „E-Mail“ auf deiner Karte einrichten." : ""}</p></>;

/** K01–K03: shown once under the card; stays as the pending panel for this view after sending. */
export function EmailOffer({ token, shop, onSent, onClose, reload }: { token: string; shop: Shop; onSent: () => void; onClose: () => void; reload: () => Promise<void> }) {
  const [sent, setSent] = useState<{ address: string; ticked: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { text: status, live, announce } = useCardStatus("email-offer");
  async function decline() {
    setBusy(true); setError("");
    try { await postJson(`/api/card/${encodeURIComponent(token)}/contact/marketing`, { granted: false }); onClose(); void reload().catch(() => {}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : SEND_FAILED); }
    finally { setBusy(false); }
  }
  if (sent) return <section className={styles.offer} aria-label="Fast geschafft">
    <h2 className={styles.title}>Fast geschafft</h2>
    <Pending token={token} announce={announce} onOther={() => setSent(null)} text={<div className={styles.sent}><Mail size={18} aria-hidden="true" /><div className={styles.form}>
      <p className={styles.text}>Wir haben dir einen Link an <strong>{sent.address}</strong> geschickt.</p>
      {sentLines(sent.ticked, true)}
    </div></div>} />
    <CardStatusLine text={status} live={live} className={styles.muted} />
  </section>;
  return <section className={styles.offer} aria-label="Erinnerungen per E-Mail?">
    <h2 className={styles.title}>Erinnerungen per E-Mail?</h2>
    <p className={styles.muted}>{shop.shop} sagt dir Bescheid, wenn deine Prämie bereitliegt oder du länger nicht da warst. Freiwillig: Deine Karte funktioniert ohne E-Mail genauso.</p>
    <AddressForm token={token} shop={shop} consent onSent={(address, ticked) => { setSent({ address, ticked }); onSent(); announce(SENT); void reload().catch(() => {}); }} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <Button variant="quiet" size="sm" className={styles.quiet} disabled={busy} onClick={() => void decline()}>Nein, danke</Button>
  </section>;
}

/** K06–K09c and, while marketing mail is off, K17–K19: the sheet behind the row. */
export function EmailSheet({ token, shop, status, reload, open, onClose }: { token: string; shop: Shop; status: EmailStatus; reload: () => Promise<void>; open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<"view" | "change" | "remove">("view");
  const [sent, setSent] = useState<{ address: string; ticked: boolean } | null>(null);
  const [tick, setTick] = useState(false);
  const [tickError, setTickError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { text: message, live, announce } = useCardStatus("email-sheet");
  const marketing = status.marketingAvailable;
  const title = emailRow(status).title;
  const url = `/api/card/${encodeURIComponent(token)}/contact`;
  const close = () => { setStep("view"); setSent(null); setTickError(""); setError(""); onClose(); };

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setError("");
    try { await action(); await reload(); announce(done); }
    catch (cause) { setError(cause instanceof ClientApiError && (cause.status === 429 || cause.code === "CONSENT_TEXT_CHANGED") ? cause.message : cause instanceof Error ? cause.message : SEND_FAILED); }
    finally { setBusy(false); }
  }
  function setUp() {
    if (!tick) { setTickError(`Setze das Häkchen, wenn du E-Mails von ${shop.shop} bekommen möchtest.`); document.getElementById("card-email-tick")?.focus(); return; }
    setTickError("");
    void run(async () => { await postJson(url, { marketing: true, noticeVersion: EMAIL_CONSENT_TEXT_VERSION }); setSent({ address: status.maskedEmail ?? "", ticked: true }); }, SENT);
  }
  const onSent = (address: string, ticked: boolean) => { setSent({ address, ticked }); setStep("view"); announce(SENT); void reload().catch(() => {}); };

  let body: ReactNode;
  if (step === "remove") body = <div className={styles.row}>
    <p className={styles.text}><strong>Adresse entfernen?</strong> Deine Karte bleibt nutzbar.</p>
    {status.marketingEmail && <p className={styles.muted}>Nachrichten von {shop.shop} bekommst du dann auch nicht mehr.</p>}
    <p className={styles.muted}>Ohne Adresse kannst du die Karte nicht mehr per E-Mail wiederfinden.</p>
    <Button variant="secondary" size="sm" loading={busy} onClick={() => void run(async () => { await apiJson(url, { method: "DELETE" }); setStep("view"); }, "Adresse entfernt.")}>Adresse entfernen</Button>
    <Button variant="quiet" size="sm" disabled={busy} onClick={() => setStep("view")}>Abbrechen</Button>
  </div>;
  else if (step === "change" || !status.contactPresent) body = <>
    {!status.contactPresent && <p className={styles.muted}>{marketing ? `${shop.shop} sagt dir Bescheid, wenn deine Prämie bereitliegt oder du länger nicht da warst. Freiwillig: Deine Karte funktioniert ohne E-Mail genauso.` : "Mit einer bestätigten E-Mail-Adresse findest du deine Karte wieder, falls du diesen Link verlierst."}</p>}
    <AddressForm token={token} shop={shop} consent={marketing} initialTick={false} onSent={onSent} />
    {step === "change" && <Button variant="quiet" size="sm" className={styles.quiet} onClick={() => setStep("view")}>Abbrechen</Button>}
  </>;
  else if (sent || !status.emailVerified || status.pending) {
    // Pending: the typed address right after sending in this sheet, masked on every later view.
    const ticked = sent ? sent.ticked : status.pending === "marketing";
    const expired = !sent && (status.linkExpired || !status.pending);
    body = <div className={styles.row}>
      <strong>{sent?.address || status.maskedEmail}</strong>
      <Pending token={token} announce={announce} onOther={() => { setSent(null); setStep("change"); }} text={expired
        ? <p className={styles.text}>Der Link ist abgelaufen. Fordere einen neuen an, er gilt 30 Minuten.</p>
        : <p className={styles.text}>Noch nicht bestätigt. Erst wenn du den Link in der E-Mail anklickst, {ticked ? "bekommst du Nachrichten" : "ist deine Adresse bestätigt"}.</p>} />
      <Button variant="quiet" size="sm" disabled={busy} onClick={() => setStep("remove")}>Adresse entfernen</Button>
    </div>;
  } else body = <>
    <div className={styles.row}>
      <strong>{status.maskedEmail}</strong>
      <p className={styles.muted}>Bestätigt · zum Wiederfinden der Karte</p>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => setStep("change")}>Ändern</Button>
    </div>
    {marketing ? <div className={styles.row}>
      <strong>Nachrichten von {shop.shop}</strong>
      <p className={styles.muted}>Angebote, Neuigkeiten, Erinnerungen</p>
      {status.marketingEmail ? <>
        <p className={styles.on}><Check size={16} aria-hidden="true" /> An{status.marketingSince ? ` · seit ${since(status.marketingSince)}` : ""}</p>
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void run(() => postJson(`${url}/marketing`, { granted: false }), "Abbestellt. Deine Adresse zum Wiederfinden der Karte bleibt.")}>Abbestellen</Button>
      </> : <>
        <p className={styles.off}>Aus</p>
        <Checkbox id="card-email-tick" checked={tick} aria-describedby={tickError ? "card-email-tick-error" : undefined} onChange={event => { setTick(event.target.checked); setTickError(""); }}>{consentLead(shop)}<Link href="/datenschutz">Mehr in den Datenschutzhinweisen.</Link></Checkbox>
        {tickError && <p id="card-email-tick-error" className={styles.error}>{tickError}</p>}
        <Button variant="secondary" size="sm" loading={busy} onClick={setUp}>Einrichten</Button>
      </>}
    </div> : <p className={styles.muted}>Mit dieser Adresse findest du deine Karte unter {status.recoverUrl} wieder.</p>}
    <Button variant="quiet" size="sm" className={styles.quiet} disabled={busy} onClick={() => setStep("remove")}>Adresse entfernen</Button>
  </>;

  return <Sheet open={open} onClose={close} title={title}>
    <div className={styles.form}>
      {body}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <CardStatusLine text={message} live={live} className={styles.muted} />
    </div>
  </Sheet>;
}
