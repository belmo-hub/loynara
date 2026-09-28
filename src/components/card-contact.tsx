"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { apiJson, postJson } from "./client-api";

type ContactStatus = { available: boolean; marketingAvailable: boolean; marketingExternal: boolean; contactPresent: boolean; emailVerified: boolean; marketingEmail: boolean };

export function CardContact({ token, locale }: { token: string; locale: "de" | "fr" }) {
  const [status, setStatus] = useState<ContactStatus | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await postJson<{ status: "queued" | "verified" }>(`/api/card/${encodeURIComponent(token)}/contact`, { email });
      setStatus(await apiJson<ContactStatus>(`/api/card/${encodeURIComponent(token)}/contact`));
      setMessage(result.status === "verified" ? french ? "Cette adresse est déjà vérifiée." : "Diese Adresse ist bereits bestätigt." : french ? "Lien de vérification demandé. Vérifie ta boîte de réception." : "Bestätigungslink angefordert. Prüfe dein Postfach.");
      setEmail("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : french ? "Demande impossible." : "Anfrage fehlgeschlagen."); }
    finally { setBusy(false); }
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
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await postJson<{ marketingEmail: boolean }>(`/api/card/${encodeURIComponent(token)}/contact/marketing`, { granted });
      setStatus(current => current && ({ ...current, marketingEmail: result.marketingEmail }));
      setMessage(granted ? status?.marketingExternal ? french ? "Courriels d'offres activés. Désabonnement possible ici." : "E-Mail-Angebote aktiviert. Hier jederzeit abbestellbar." : french ? "Courriels de test locaux activés." : "Lokale Test-E-Mails aktiviert." : french ? "Désabonné." : "Abbestellt.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : french ? "Préférence non enregistrée." : "Einstellung konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  if (!status || (!status.available && !status.marketingAvailable && !status.marketingEmail)) return null;
  return <section className="card-contact-local" aria-label={french ? "Sécuriser la carte" : "Karte sichern"}>
    <h3>{status.available ? french ? "Sécuriser la carte" : "Karte sichern" : french ? "Préférences e-mail" : "E-Mail-Einstellungen"}</h3>
    {status.available && <><p>{french ? "Avec une adresse e-mail vérifiée, tu peux retrouver ta carte si tu perds ce lien. La carte reste utilisable sans e-mail. Aucun consentement marketing n’est ajouté." : "Mit einer bestätigten E-Mail kannst du deine Karte wiederfinden, falls du diesen Link verlierst. Die Karte bleibt ohne E-Mail nutzbar. Werbung wird dadurch nicht abonniert."}</p>
    <form onSubmit={request}><label>{french ? "Adresse e-mail" : "E-Mail-Adresse"}<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="gast@example.test" maxLength={320} required /></label><button type="submit" className="button button--outline" disabled={busy}>{french ? "Envoyer le lien de vérification" : "Bestätigungslink senden"}</button></form></>}
    {status.contactPresent && <p className="card-contact-status">{status.emailVerified ? french ? "Adresse vérifiée." : "Adresse bestätigt." : french ? "Adresse non vérifiée ; aucun message marketing." : "Adresse noch nicht bestätigt; keine Marketing-Nachrichten."}</p>}
    {status.emailVerified && (status.marketingAvailable || status.marketingEmail) && <div className="card-contact-preference"><p>{status.marketingExternal ? french ? "Choix séparé : recevoir des offres de ce commerce par e-mail. Tu peux te désabonner à tout moment." : "Separate Einwilligung: E-Mail-Angebote dieses Geschäfts erhalten. Du kannst sie jederzeit abbestellen." : status.marketingAvailable ? french ? "Choix séparé pour les courriels marketing de test. Les messages restent dans la boîte locale." : "Separate Einwilligung für lokale Test-Marketing-E-Mails. Nachrichten bleiben im lokalen Test-Postfach." : french ? "Tu peux désactiver les offres par e-mail sans perdre ta carte ni ton adresse de récupération." : "Du kannst E-Mail-Angebote abbestellen. Karte und Wiederherstellungsadresse bleiben erhalten."}</p><button type="button" className="button button--outline" disabled={busy} onClick={() => void preference(!status.marketingEmail)}>{status.marketingEmail ? french ? "Se désabonner" : "E-Mail-Marketing abbestellen" : french ? "Accepter les courriels d'offres" : "E-Mail-Angebote aktivieren"}</button></div>}
    {status.available && status.contactPresent && <button type="button" className="button button--outline" disabled={busy} onClick={() => void remove()}>{french ? "Supprimer l’adresse de récupération" : "Wiederherstellungsadresse entfernen"}</button>}
    {status.available && <p><Link href="/recover">{french ? "Lien perdu ? Retrouver la carte" : "Kartenlink verloren? Karte wiederfinden"}</Link></p>}
    {message && <p role="status" className="card-contact-status">{message}</p>}
    {error && <p role="alert" className="card-contact-error">{error}</p>}
  </section>;
}
