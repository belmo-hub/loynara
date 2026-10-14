"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { apiJson, postJson } from "./client-api";
import { Button } from "./ui/button";
import { TextField } from "./ui/field";
import styles from "./customer/panels.module.css";

type ContactStatus = { available: boolean; marketingAvailable: boolean; marketingExternal: boolean; contactPresent: boolean; emailVerified: boolean; marketingEmail: boolean };

export function CardContact({ token, locale, recoveryOnly = false }: { token: string; locale: "de" | "fr"; recoveryOnly?: boolean }) {
  const [status, setStatus] = useState<ContactStatus | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // Which action is running, so only its own button shows progress.
  const [action, setAction] = useState<"request" | "preference" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deferred, setDeferred] = useState(false);
  const french = locale === "fr";

  useEffect(() => {
    let active = true;
    void apiJson<ContactStatus>(`/api/card/${encodeURIComponent(token)}/contact`).then(result => {
      if (active) setStatus(result);
    }).catch(() => {
      // The browser card remains usable if transactional email is unavailable.
    });
    return () => { active = false; };
  }, [token]);

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setAction("request"); setError(""); setMessage("");
    try {
      const result = await postJson<{ status: "queued" | "verified" }>(`/api/card/${encodeURIComponent(token)}/contact`, { email });
      setStatus(await apiJson<ContactStatus>(`/api/card/${encodeURIComponent(token)}/contact`));
      setMessage(result.status === "verified" ? french ? "Cette adresse est déjà vérifiée." : "Diese Adresse ist bereits bestätigt." : french ? "Lien de vérification demandé. Vérifie ta boîte de réception." : "Bestätigungslink angefordert. Prüfe dein Postfach.");
      setEmail("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : french ? "Demande impossible." : "Anfrage fehlgeschlagen."); }
    finally { setBusy(false); setAction(null); }
  }

  async function remove() {
    if (!window.confirm(french ? "Supprimer l’adresse de récupération ? La carte actuelle reste accessible." : "Wiederherstellungsadresse entfernen? Deine aktuelle Karte bleibt nutzbar.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await apiJson<{ removed: true }>(`/api/card/${encodeURIComponent(token)}/contact`, { method: "DELETE" });
      setStatus(await apiJson<ContactStatus>(`/api/card/${encodeURIComponent(token)}/contact`));
      setMessage(french ? "Adresse de récupération supprimée." : "Wiederherstellungsadresse entfernt.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Entfernen fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  async function preference(granted: boolean) {
    setBusy(true); setAction("preference"); setError(""); setMessage("");
    try {
      const result = await postJson<{ marketingEmail: boolean }>(`/api/card/${encodeURIComponent(token)}/contact/marketing`, { granted });
      setStatus(current => current && ({ ...current, marketingEmail: result.marketingEmail }));
      setMessage(granted ? status?.marketingExternal ? french ? "Courriels d'offres activés. Désabonnement possible ici." : "E-Mail-Angebote aktiviert. Hier jederzeit abbestellbar." : french ? "Courriels de test locaux activés." : "Lokale Test-E-Mails aktiviert." : french ? "Désabonné." : "Abbestellt.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : french ? "Préférence non enregistrée." : "Einstellung konnte nicht gespeichert werden."); }
    finally { setBusy(false); setAction(null); }
  }

  if (!status || (!recoveryOnly && !status.available && !status.marketingAvailable && !status.marketingEmail)) return null;
  const withoutRecovery = french ? "Sans adresse vérifiée, votre lien privé est la seule preuve que la carte vous appartient. Le numéro de carte seul ne suffit pas." : "Ohne bestätigte Adresse ist dein privater Kartenlink der einzige Nachweis, dass die Karte dir gehört. Die Kartennummer allein reicht dafür nicht.";
  const label = french ? "Sécuriser la carte" : "Karte sichern";
  if (recoveryOnly && (!status.available || deferred)) return <section className={styles.panel} aria-label={label}>
    <h3 className={styles.title}><ShieldCheck size={18} aria-hidden="true" /> {label}</h3>
    <p className={styles.muted}>{withoutRecovery}</p>
    {status.available ? <Button variant="secondary" size="sm" onClick={() => setDeferred(false)}>{french ? "Configurer la récupération" : "Wiederherstellung einrichten"}</Button> : <p className={styles.muted}>{french ? "La vérification par e-mail n’est pas disponible actuellement." : "E-Mail-Verifizierung ist derzeit nicht verfügbar."}</p>}
  </section>;
  return <section className={styles.panel} aria-label={label}>
    <h3 className={styles.title}><ShieldCheck size={18} aria-hidden="true" /> {status.available ? label : french ? "Préférences e-mail" : "E-Mail-Einstellungen"}{status.available && !status.emailVerified ? <span className={styles.optional}>{french ? "facultatif" : "optional"}</span> : null}</h3>
    {status.available && (!recoveryOnly || !status.emailVerified) && <>
      <p className={styles.muted}>{french ? "Avec une adresse vérifiée, vous retrouvez votre carte si vous perdez ce lien. Sans publicité : aucun consentement marketing n’est ajouté." : "Mit einer bestätigten E-Mail-Adresse findest du deine Karte wieder, falls du diesen Link verlierst. Werbung abonnierst du damit nicht."}</p>
      <p className={styles.muted}>{withoutRecovery}</p>
      <form onSubmit={request} className={styles.form}>
        <TextField label={french ? "Adresse e-mail" : "E-Mail-Adresse"} type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" inputMode="email" placeholder="gast@example.com" maxLength={320} required />
        <Button type="submit" variant="secondary" loading={action === "request"} disabled={busy && action !== "request"}>{french ? "Envoyer le lien de vérification" : "Bestätigungslink senden"}</Button>
      </form>
      {recoveryOnly && <Button variant="quiet" size="sm" disabled={busy} onClick={() => setDeferred(true)}>{french ? "Plus tard" : "Später"}</Button>}
    </>}
    {status.contactPresent && <p className={styles.state}>{status.emailVerified ? french ? "Adresse vérifiée." : "Adresse bestätigt." : french ? "Adresse non vérifiée ; aucun message marketing." : "Adresse noch nicht bestätigt; keine Marketing-Nachrichten."}</p>}
    {!recoveryOnly && status.emailVerified && (status.marketingAvailable || status.marketingEmail) && <div className={styles.preference}>
      <p className={styles.muted}>{status.marketingExternal ? french ? "Choix séparé : recevoir des offres de ce commerce par e-mail. Désabonnement possible à tout moment." : "Separate Einwilligung: E-Mail-Angebote dieses Geschäfts erhalten. Du kannst sie jederzeit abbestellen." : status.marketingAvailable ? french ? "Choix séparé pour les courriels marketing de test. Les messages restent dans la boîte locale." : "Separate Einwilligung für lokale Test-Marketing-E-Mails. Nachrichten bleiben im lokalen Test-Postfach." : french ? "Vous pouvez désactiver les offres par e-mail sans perdre votre carte ni votre adresse de récupération." : "Du kannst E-Mail-Angebote abbestellen. Karte und Wiederherstellungsadresse bleiben erhalten."}</p>
      <Button variant="secondary" size="sm" loading={action === "preference"} disabled={busy && action !== "preference"} onClick={() => void preference(!status.marketingEmail)}>{status.marketingEmail ? french ? "Se désabonner" : "E-Mail-Marketing abbestellen" : french ? "Accepter les courriels d'offres" : "E-Mail-Angebote aktivieren"}</Button>
    </div>}
    {!recoveryOnly && status.available && status.contactPresent && <Button variant="quiet" size="sm" disabled={busy} onClick={() => void remove()}>{french ? "Supprimer l’adresse de récupération" : "Wiederherstellungsadresse entfernen"}</Button>}
    {status.available && <p className={styles.link}><Link href="/recover">{french ? "Lien perdu ? Retrouver la carte" : "Kartenlink verloren? Karte wiederfinden"}</Link></p>}
    {message && <p role="status" className={styles.state}>{message}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
