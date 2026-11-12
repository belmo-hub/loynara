"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Check, Mail } from "lucide-react";
import { apiJson, ClientApiError, GERMAN_SERVER_TEXT, postJson } from "./client-api";
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
// The server's own German text (rate limit, e-mail off, changed consent text); anything else is a failed send.
const sendError = (cause: unknown) => cause instanceof ClientApiError && (cause.status === 429 || (cause.code !== undefined && GERMAN_SERVER_TEXT.has(cause.code))) ? cause.message : SEND_FAILED;
/** What a confirmation link asks for: with the consent it carries the box text's version, or the resend would turn it into a recovery-only link. */
// A failed setting (decline, unsubscribe, remove) sent nothing: the server's own German text, else Marketing's line, never "not sent".
const SAVE_FAILED = "Das konnten wir gerade nicht speichern. Es bleibt alles wie vorher. Versuche es gleich noch einmal.";
export const actionError = (cause: unknown) => cause instanceof ClientApiError && (cause.status === 429 || (cause.code !== undefined && GERMAN_SERVER_TEXT.has(cause.code))) ? cause.message : SAVE_FAILED;
export const linkRequest = (marketing: boolean) => marketing ? { marketing: true, noticeVersion: EMAIL_CONSENT_TEXT_VERSION } : {};

/** Moves focus to the step's `[data-focus]` element whenever `step` changes, so it never falls back to the page. */
function useStepFocus(step: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    ref.current?.querySelector<HTMLElement>("[data-focus]")?.focus();
  }, [step]);
  return ref;
}

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

/** The consent box with Legal's text; the privacy link sits inside the label, as on the Wallet panel. */
function ConsentBox({ shop, id, checked, invalid, describedBy, onChange }: { shop: Shop; id?: string; checked: boolean; invalid?: boolean; describedBy?: string; onChange: (checked: boolean) => void }) {
  return <Checkbox id={id} checked={checked} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={event => onChange(event.target.checked)}>{consentLead(shop)}<Link href="/datenschutz">Mehr in den Datenschutzhinweisen.</Link></Checkbox>;
}

/** The field, Legal's hint, the optional tick and „Bestätigungslink schicken“; checks on tap, never a browser bubble. */
function AddressForm({ token, shop, consent, onSent }: { token: string; shop: Shop; consent: boolean; onSent: (address: string, ticked: boolean) => void }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [tick, setTick] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem("card-email") as HTMLInputElement;
    if (!email.trim() || !field.checkValidity()) { setFieldError(INVALID); field.focus(); return; }
    setBusy(true); setError("");
    try {
      await postJson(`/api/card/${encodeURIComponent(token)}/contact`, { email, ...linkRequest(consent && tick) });
      onSent(email.trim(), consent && tick);
    } catch (cause) {
      // A refused address (schema check, no code) belongs to the field; everything else to the line above the button.
      if (cause instanceof ClientApiError && cause.status === 400 && !cause.code) { setFieldError(INVALID); field.focus(); }
      else setError(sendError(cause));
    } finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={send} noValidate>
    <TextField id={id} name="card-email" data-focus label="E-Mail-Adresse" type="email" autoComplete="email" inputMode="email" placeholder="name@beispiel.de" maxLength={320}
      value={email} onChange={event => { setEmail(event.target.value); setFieldError(""); }} hint={HINT} error={fieldError || undefined} />
    {consent && <ConsentBox shop={shop} checked={tick} onChange={setTick} />}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <Button type="submit" variant="secondary" className={styles.wide} loading={busy}>Bestätigungslink schicken</Button>
  </form>;
}

/** The resend for an open or expired link, with the same consent it was asked with. A confirmed address gets no new link: nothing is claimed then. */
function Resend({ token, marketing, expired, announce, onDone, children }: { token: string; marketing: boolean; expired: boolean; announce: (text: string) => void; onDone?: () => void; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function resend() {
    setBusy(true); setError("");
    try {
      const result = await postJson<{ status: "queued" | "verified" }>(`/api/card/${encodeURIComponent(token)}/contact`, linkRequest(marketing));
      if (result.status === "queued") announce(SENT);
      onDone?.();
    }
    catch (cause) { setError(sendError(cause)); }
    finally { setBusy(false); }
  }
  return <>
    {!expired && <p className={styles.muted}>Nichts angekommen? Schau im Spam-Ordner nach oder schick den Link noch einmal.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      <Button variant="secondary" className={styles.wide} loading={busy} onClick={() => void resend()}>Link noch einmal schicken</Button>
      {children}
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
  const ref = useStepFocus(sent);
  async function decline() {
    setBusy(true); setError("");
    try { await postJson(`/api/card/${encodeURIComponent(token)}/contact/marketing`, { granted: false }); onClose(); void reload().catch(() => {}); }
    catch (cause) { setError(actionError(cause)); }
    finally { setBusy(false); }
  }
  return <div ref={ref}>{sent ? <section className={styles.offer} aria-label="Fast geschafft">
    <h2 className={styles.title} tabIndex={-1} data-focus>Fast geschafft</h2>
    <div className={styles.sent}><Mail size={18} aria-hidden="true" /><div className={styles.form}>
      <p className={styles.text}>Wir haben dir einen Link an <strong>{sent.address}</strong> geschickt.</p>
      {sentLines(sent.ticked, true)}
    </div></div>
    <Resend token={token} marketing={sent.ticked} expired={false} announce={announce}>
      <Button variant="quiet" size="sm" className={styles.quiet} onClick={() => setSent(null)}>Andere Adresse eingeben</Button>
    </Resend>
    {/* The visible text above already says it; the status region only announces. */}
    <CardStatusLine text={status} live={live} className={styles.srOnly} />
  </section> : <section className={styles.offer} aria-label="Erinnerungen per E-Mail?">
    <h2 className={styles.title}>Erinnerungen per E-Mail?</h2>
    <p className={styles.muted}>{shop.shop} sagt dir Bescheid, wenn deine Prämie bereitliegt oder du länger nicht da warst. Freiwillig: Deine Karte funktioniert ohne E-Mail genauso.</p>
    <AddressForm token={token} shop={shop} consent onSent={(address, ticked) => { setSent({ address, ticked }); onSent(); announce(SENT); void reload().catch(() => {}); }} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <Button variant="quiet" size="sm" className={styles.quiet} disabled={busy} onClick={() => void decline()}>Nein, danke</Button>
  </section>}</div>;
}

/**
 * „Einrichten“ for a confirmed address. Its own component so the box starts unticked every time it appears (Legal): it
 * mounts only while the sheet is open and the button shows, so neither closing the sheet nor an expired link keeps a tick.
 */
function SetUp({ shop, busy, onSend }: { shop: Shop; busy: boolean; onSend: () => void }) {
  const id = useId();
  const [tick, setTick] = useState(false);
  const [tickError, setTickError] = useState("");
  // Focus the box once its error line exists, so the error is read with it (E36).
  useEffect(() => { if (tickError) document.getElementById(id)?.focus(); }, [tickError, id]);
  return <>
    <ConsentBox shop={shop} id={id} checked={tick} invalid={Boolean(tickError)} describedBy={tickError ? `${id}-error` : undefined} onChange={checked => { setTick(checked); setTickError(""); }} />
    {tickError && <p id={`${id}-error`} role="alert" className={styles.error}>{tickError}</p>}
    <Button variant="secondary" size="sm" loading={busy} onClick={() => { if (tick) onSend(); else setTickError(`Setze das Häkchen, wenn du E-Mails von ${shop.shop} bekommen möchtest.`); }}>Einrichten</Button>
  </>;
}

/** K06–K09c and, while marketing mail is off, K17–K19: the sheet behind the row. */
export function EmailSheet({ token, shop, status, reload, open, onClose }: { token: string; shop: Shop; status: EmailStatus; reload: () => Promise<void>; open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<"view" | "change" | "remove">("view");
  const [sent, setSent] = useState<{ address: string; ticked: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { text: message, live, announce } = useCardStatus("email-sheet");
  const ref = useStepFocus(`${step}-${Boolean(sent)}`);
  const marketing = status.marketingAvailable;
  const title = emailRow(status).title;
  const url = `/api/card/${encodeURIComponent(token)}/contact`;
  const close = () => { setStep("view"); setSent(null); setError(""); onClose(); };

  async function run(action: () => Promise<unknown>, done: string, failure: (cause: unknown) => string = actionError) {
    setBusy(true); setError("");
    try { await action(); await reload(); announce(done); }
    catch (cause) { setError(failure(cause)); }
    finally { setBusy(false); }
  }
  const setUp = () => void run(async () => { await postJson(url, linkRequest(true)); setSent({ address: status.maskedEmail ?? "", ticked: true }); }, SENT, sendError);
  const onSent = (address: string, ticked: boolean) => { setSent({ address, ticked }); setStep("view"); announce(SENT); void reload().catch(() => {}); };

  let body: ReactNode;
  if (step === "remove") body = <div className={styles.row}>
    <p className={styles.text} tabIndex={-1} data-focus><strong>Adresse entfernen?</strong> Deine Karte bleibt nutzbar.</p>
    {status.marketingEmail && <p className={styles.muted}>Nachrichten von {shop.shop} bekommst du dann auch nicht mehr.</p>}
    <p className={styles.muted}>Ohne Adresse kannst du die Karte nicht mehr per E-Mail wiederfinden.</p>
    <Button variant="secondary" size="sm" loading={busy} onClick={() => void run(async () => { await apiJson(url, { method: "DELETE" }); setStep("view"); }, "Adresse entfernt.")}>Adresse entfernen</Button>
    <Button variant="quiet" size="sm" disabled={busy} onClick={() => setStep("view")}>Abbrechen</Button>
  </div>;
  else if (step === "change" || !status.contactPresent) body = <>
    {!status.contactPresent && <p className={styles.muted}>{marketing ? `${shop.shop} sagt dir Bescheid, wenn deine Prämie bereitliegt oder du länger nicht da warst. Freiwillig: Deine Karte funktioniert ohne E-Mail genauso.` : "Mit einer bestätigten E-Mail-Adresse findest du deine Karte wieder, falls du diesen Link verlierst."}</p>}
    {open && <AddressForm token={token} shop={shop} consent={marketing} onSent={onSent} />}
    {step === "change" && <Button variant="quiet" size="sm" className={styles.quiet} onClick={() => setStep("view")}>Abbrechen</Button>}
  </>;
  else if (!status.emailVerified) {
    // An unconfirmed address: the typed address right after sending in this sheet, masked on every later view.
    const ticked = sent ? sent.ticked : status.pending === "marketing";
    const expired = !sent && (status.linkExpired || !status.pending);
    body = <div className={styles.row}>
      <strong tabIndex={-1} data-focus>{sent?.address || status.maskedEmail}</strong>
      {expired
        ? <p className={styles.text}>Der Link ist abgelaufen. Fordere einen neuen an, er gilt 30 Minuten.</p>
        : <p className={styles.text}>Noch nicht bestätigt. Erst wenn du den Link in der E-Mail anklickst, {ticked ? "bekommst du Nachrichten" : "ist deine Adresse bestätigt"}.</p>}
      <Resend token={token} marketing={ticked} expired={expired} announce={announce} onDone={() => void reload().catch(() => {})}>
        <Button variant="quiet" size="sm" className={styles.quiet} onClick={() => { setSent(null); setStep("change"); }}>Andere Adresse eingeben</Button>
      </Resend>
      <Button variant="quiet" size="sm" disabled={busy} onClick={() => setStep("remove")}>Adresse entfernen</Button>
    </div>;
  } else {
    // A confirmed address always shows K06/K07; an open messages link lives in the messages row, and „Einrichten“ returns once it expires.
    const linkOpen = !status.marketingEmail && (sent?.ticked === true || (status.pending === "marketing" && !status.linkExpired));
    const linkExpired = !status.marketingEmail && !sent && status.pending === "marketing" && status.linkExpired;
    body = <>
      <div className={styles.row}>
        <strong tabIndex={-1} data-focus>{status.maskedEmail}</strong>
        <p className={styles.muted}>Bestätigt · zum Wiederfinden der Karte</p>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setStep("change")}>Ändern</Button>
      </div>
      {marketing ? <div className={styles.row}>
        <strong>Nachrichten von {shop.shop}</strong>
        <p className={styles.muted}>Angebote, Neuigkeiten, Erinnerungen</p>
        {status.marketingEmail ? <>
          <p className={styles.on}><Check size={16} aria-hidden="true" /> An{status.marketingSince ? ` · seit ${since(status.marketingSince)}` : ""}</p>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void run(() => postJson(`${url}/marketing`, { granted: false }), "Abbestellt. Deine Adresse zum Wiederfinden der Karte bleibt.")}>Abbestellen</Button>
        </> : linkOpen ? <>
          <p className={styles.text}>Noch nicht bestätigt. Erst wenn du den Link in der E-Mail anklickst, bekommst du Nachrichten.</p>
          <Resend token={token} marketing expired={false} announce={announce} onDone={() => void reload().catch(() => {})} />
        </> : <>
          <p className={styles.off}>Aus</p>
          {linkExpired && <p className={styles.text}>Der Link ist abgelaufen. Fordere einen neuen an, er gilt 30 Minuten.</p>}
          {open && <SetUp shop={shop} busy={busy} onSend={setUp} />}
        </>}
      </div> : <p className={styles.muted}>Mit dieser Adresse findest du deine Karte unter {status.recoverUrl} wieder.</p>}
      <Button variant="quiet" size="sm" className={styles.quiet} disabled={busy} onClick={() => setStep("remove")}>Adresse entfernen</Button>
    </>;
  }

  return <Sheet open={open} onClose={close} title={title}>
    <div ref={ref} className={styles.form}>
      {body}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <CardStatusLine text={message} live={live} className={styles.muted} />
    </div>
  </Sheet>;
}
