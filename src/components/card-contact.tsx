"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ShieldCheck, X } from "lucide-react";
import { apiJson, ClientApiError, postJson } from "./client-api";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { TextField } from "./ui/field";
import styles from "./customer/panels.module.css";
import { CardStatusLine, useCardStatus } from "./customer/card-status";
import type { ContactStatus } from "@/lib/contact-verification";

const contactUrl = (token: string) => `/api/card/${encodeURIComponent(token)}/contact`;
const sendFailed = (cause: unknown) => cause instanceof ClientApiError && (cause.code === "RATE_LIMIT" || cause.status === 0) ? cause.message : "Konnte nicht gesendet werden. Versuch es gleich noch einmal.";

/** Recovery address on the tap page: recovery only, never marketing. */
export function CardContact({ token, locale }: { token: string; locale: "de" | "fr" }) {
  const [status, setStatus] = useState<ContactStatus | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const { text: message, live, announce: setMessage } = useCardStatus("contact");
  const [error, setError] = useState("");
  const [deferred, setDeferred] = useState(false);
  const french = locale === "fr";

  useEffect(() => {
    let active = true;
    void apiJson<ContactStatus>(contactUrl(token)).then(result => {
      if (active) setStatus(result);
    }).catch(() => {
      // The browser card remains usable if transactional email is unavailable.
    });
    return () => { active = false; };
  }, [token]);

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await postJson<{ status: "queued" | "verified" }>(contactUrl(token), { email });
      setStatus(await apiJson<ContactStatus>(contactUrl(token)));
      setMessage(result.status === "verified" ? french ? "Cette adresse est déjà vérifiée." : "Diese Adresse ist bereits bestätigt." : french ? "Lien de vérification demandé. Vérifie ta boîte de réception." : "Bestätigungslink angefordert. Prüfe dein Postfach.");
      setEmail("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : french ? "Demande impossible." : "Anfrage fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  if (!status) return null;
  const withoutRecovery = french ? "Sans adresse vérifiée, votre lien privé est la seule preuve que la carte vous appartient. Le numéro de carte seul ne suffit pas." : "Ohne bestätigte Adresse ist dein privater Kartenlink der einzige Nachweis, dass die Karte dir gehört. Die Kartennummer allein reicht dafür nicht.";
  const label = french ? "Sécuriser la carte" : "Karte sichern";
  if (!status.available || deferred) return <section className={styles.panel} aria-label={label}>
    <h3 className={styles.title}><ShieldCheck size={18} aria-hidden="true" /> {label}</h3>
    <p className={styles.muted}>{withoutRecovery}</p>
    {status.available ? <Button variant="secondary" size="sm" onClick={() => setDeferred(false)}>{french ? "Configurer la récupération" : "Wiederherstellung einrichten"}</Button> : <p className={styles.muted}>{french ? "La vérification par e-mail n’est pas disponible actuellement." : "E-Mail-Verifizierung ist derzeit nicht verfügbar."}</p>}
  </section>;
  return <section className={styles.panel} aria-label={label}>
    <h3 className={styles.title}><ShieldCheck size={18} aria-hidden="true" /> {label}{!status.emailVerified ? <span className={styles.optional}>{french ? "facultatif" : "optional"}</span> : null}</h3>
    {!status.emailVerified && <>
      <p className={styles.muted}>{french ? "Avec une adresse vérifiée, vous retrouvez votre carte si vous perdez ce lien. Sans publicité : aucun consentement marketing n’est ajouté." : "Mit einer bestätigten E-Mail-Adresse findest du deine Karte wieder, falls du diesen Link verlierst. Werbung abonnierst du damit nicht."}</p>
      <p className={styles.muted}>{withoutRecovery}</p>
      <form onSubmit={request} className={styles.form}>
        <TextField label={french ? "Adresse e-mail" : "E-Mail-Adresse"} type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" inputMode="email" placeholder="gast@example.com" maxLength={320} required />
        <Button type="submit" variant="secondary" loading={busy}>{french ? "Envoyer le lien de vérification" : "Bestätigungslink senden"}</Button>
      </form>
      <Button variant="quiet" size="sm" disabled={busy} onClick={() => setDeferred(true)}>{french ? "Plus tard" : "Später"}</Button>
    </>}
    {status.contactPresent && <p className={styles.state}>{status.emailVerified ? french ? "Adresse vérifiée." : "Adresse bestätigt." : french ? "Adresse non vérifiée ; aucun message marketing." : "Adresse noch nicht bestätigt; keine Marketing-Nachrichten."}</p>}
    <p className={styles.link}><Link href="/recover">{french ? "Lien perdu ? Retrouver la carte" : "Kartenlink verloren? Karte wiederfinden"}</Link></p>
    <CardStatusLine text={message} live={live} className={styles.state} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}

/**
 * The card page's e-mail status, read once. Its place is fixed by that read so a form never remounts mid-use: under the
 * card face while the offer or a sent link is open (design: the QR stays on top), otherwise with the panels below.
 */
export function useCardEmail(token: string) {
  const [status, setStatus] = useState<ContactStatus | null>(null);
  const [top, setTop] = useState(false);
  useEffect(() => {
    let active = true;
    void apiJson<ContactStatus>(contactUrl(token)).then(result => { if (active) { setTop(result.offer || result.pending !== null); setStatus(result); } })
      .catch(() => { /* The card works the same without e-mail. */ });
    return () => { active = false; };
  }, [token]);
  return { status, setStatus, top };
}

type EmailProps = { token: string; businessName: string; locationName: string; status: ContactStatus; setStatus: (status: ContactStatus) => void; top: boolean };

/**
 * One step on the card (messaging v1, A2; copy v0.5): the address is the recovery choice, the only checkbox is the
 * marketing consent (unticked), and the consent counts only after the click in the confirmation mail. "Nein, danke"
 * records the choice, so the offer never comes back by itself.
 */
export function CardEmail({ token, businessName, locationName, status, setStatus, top }: EmailProps) {
  const [form, setForm] = useState<"address" | "consent" | null>(null);
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [marketing, setMarketing] = useState(false);
  // Shown in full only right after typing; otherwise the server's masked form (the card link is a bearer link).
  const [sentTo, setSentTo] = useState("");
  const [declined, setDeclined] = useState(false);
  const [busy, setBusy] = useState<"send" | "withdraw" | "remove" | null>(null);
  const { text: message, live, announce } = useCardStatus("contact");
  const [error, setError] = useState("");

  async function act(kind: "send" | "withdraw" | "remove", work: () => Promise<string>) {
    setBusy(kind); setError(""); announce("");
    try { const done = await work(); setStatus(await apiJson<ContactStatus>(contactUrl(token))); setForm(null); setMarketing(false); announce(done); }
    catch (cause) { setError(sendFailed(cause)); }
    finally { setBusy(null); }
  }
  // Without an address the link goes again to the stored one.
  const send = (body: { email?: string; marketing: boolean }, done: string) => act("send", async () => {
    await postJson(contactUrl(token), body);
    if (body.email) setSentTo(body.email);
    return done;
  });
  const withdraw = () => act("withdraw", async () => {
    await postJson(`${contactUrl(token)}/marketing`, { granted: false });
    return "Abbestellt. Deine Adresse zum Wiederfinden der Karte bleibt.";
  });
  function submitAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) { setInvalid(true); return; }
    void send({ email: email.trim(), marketing: status.marketingAvailable && marketing }, "Wir haben dir einen Link geschickt.");
  }
  function decline() {
    setForm(null); setMarketing(false);
    if (!status.offer) return;
    setDeclined(true);
    // Best effort: if this write is lost, the offer shows once more on the next visit; nothing else depends on it.
    void postJson(`${contactUrl(token)}/marketing`, { granted: false }).catch(() => {});
  }
  const feedback = <>
    <CardStatusLine text={message} live={live} className={styles.state} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </>;

  if (declined && top) return null;
  if (!status.available) return status.marketingEmail ? <section className={styles.panel} aria-label="E-Mail">
    <MessagesRow businessName={businessName} on busy={busy} onWithdraw={() => void withdraw()} />
    {feedback}
  </section> : null;

  const consent = <Checkbox className={styles.consent} checked={marketing} onChange={event => setMarketing(event.target.checked)}>
    Ja, {businessName}{locationName && locationName !== businessName ? `, ${locationName}` : ""}, darf mir Angebote, Neuigkeiten und Erinnerungen per E-Mail schicken. Das ist freiwillig und für die Karte nicht nötig. Ich kann es jederzeit widerrufen, auf meiner Karte oder mit einem Klick in jeder E-Mail. Mehr in den <Link href="/datenschutz" target="_blank">Datenschutzhinweisen</Link>.
  </Checkbox>;

  if (form === "address" || (!form && status.offer)) {
    const reminders = status.marketingAvailable;
    return <section className={styles.panel} aria-labelledby="card-email-title">
      <div className={styles.head}>
        <h2 id="card-email-title" className={styles.title}>{reminders ? "Erinnerungen per E-Mail?" : "Karte sichern"}</h2>
        <Button variant="quiet" size="sm" icon={<X size={18} />} aria-label="Schließen" onClick={decline} />
      </div>
      {reminders && <p className={styles.muted}>{businessName} sagt dir Bescheid, wenn deine Prämie bereitliegt oder du länger nicht da warst. Freiwillig: Deine Karte funktioniert ohne E-Mail genauso.</p>}
      <form onSubmit={submitAddress} className={styles.form} noValidate>
        <TextField label="E-Mail-Adresse" type="email" value={email} onChange={event => { setEmail(event.target.value); setInvalid(false); }} autoComplete="email" inputMode="email" maxLength={320} required
          hint="Mit dieser Adresse finde ich meine Karte wieder, falls ich den Link verliere. Sie wird nur dafür genutzt, nicht für Werbung."
          error={invalid ? "Bitte gib eine gültige E-Mail-Adresse ein." : undefined} />
        {reminders && <><hr className={styles.divider} />{consent}</>}
        <div className={styles.actions}>
          <Button type="submit" loading={busy === "send"}>Bestätigungslink schicken</Button>
          <Button variant="quiet" onClick={decline}>Nein, danke</Button>
        </div>
      </form>
      {feedback}
    </section>;
  }

  if (!form && (status.pending !== null || (status.contactPresent && !status.emailVerified))) return <section className={styles.panel} aria-labelledby="card-email-title">
    <h2 id="card-email-title" className={styles.title}>Fast geschafft.</h2>
    <p className={styles.muted}>Wir haben dir einen Link {sentTo || status.maskedEmail ? <>an <strong>{sentTo || status.maskedEmail}</strong> </> : null}geschickt.{status.pending === "marketing" ? " Erst wenn du ihn anklickst, bekommst du Nachrichten." : null}</p>
    <p className={styles.muted}>Nichts angekommen? Schau im Spam-Ordner nach oder schick den Link noch einmal.</p>
    <div className={styles.actions}>
      <Button variant="secondary" size="sm" loading={busy === "send"} onClick={() => void send({ marketing: status.pending === "marketing" }, "Wir haben den Link noch einmal geschickt.")}>Link noch einmal schicken</Button>
      <Button variant="quiet" size="sm" onClick={() => { setEmail(""); setForm("address"); }}>Andere Adresse eingeben</Button>
    </div>
    {feedback}
  </section>;

  if (!status.contactPresent) return <section className={styles.panel} aria-label="E-Mail">
    <div className={styles.row}>
      <p><strong>{status.marketingAvailable ? "Erinnerungen per E-Mail" : "Karte sichern"}</strong></p>
      <Button variant="quiet" size="sm" onClick={() => setForm("address")}>Einrichten</Button>
    </div>
    {feedback}
  </section>;

  return <section className={styles.panel} aria-labelledby="card-email-title">
    <h2 id="card-email-title" className={styles.title}>E-Mail</h2>
    <div className={styles.row}>
      <p><strong>{status.maskedEmail}</strong> bestätigt · zum Wiederfinden der Karte</p>
      <Button variant="quiet" size="sm" onClick={() => { setEmail(""); setForm("address"); }}>Ändern</Button>
    </div>
    {form === "consent" ? <form className={styles.form} onSubmit={event => { event.preventDefault(); void send({ marketing: true }, "Wir haben dir einen Link geschickt."); }}>
      {consent}
      <div className={styles.actions}>
        <Button type="submit" loading={busy === "send"} disabled={!marketing}>Bestätigungslink schicken</Button>
        <Button variant="quiet" onClick={() => { setForm(null); setMarketing(false); }}>Abbrechen</Button>
      </div>
    </form> : (status.marketingAvailable || status.marketingEmail) && <MessagesRow businessName={businessName} on={status.marketingEmail} busy={busy}
      onWithdraw={() => void withdraw()} onSetUp={() => setForm("consent")} />}
    <div className={styles.actions}><Button variant="quiet" size="sm" disabled={busy !== null} onClick={() => {
      if (window.confirm("Adresse entfernen? Deine Karte bleibt nutzbar.")) void act("remove", async () => { await apiJson(contactUrl(token), { method: "DELETE" }); return "Adresse entfernt."; });
    }}>Adresse entfernen</Button></div>
    <p className={styles.link}><Link href="/recover">Kartenlink verloren? Karte wiederfinden</Link></p>
    {feedback}
  </section>;
}

function MessagesRow({ businessName, on, busy, onWithdraw, onSetUp }: { businessName: string; on: boolean; busy: string | null; onWithdraw: () => void; onSetUp?: () => void }) {
  return <div className={styles.row}>
    <p><strong>Nachrichten von {businessName}</strong><br />Angebote, Neuigkeiten, Erinnerungen · {on ? "an" : "aus"}</p>
    {on ? <Button variant="quiet" size="sm" loading={busy === "withdraw"} onClick={onWithdraw}>Abbestellen</Button>
      : onSetUp ? <Button variant="quiet" size="sm" onClick={onSetUp}>Einrichten</Button> : null}
  </div>;
}
