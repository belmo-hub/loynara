"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiJson, postJson } from "./client-api";

type ContactStatus = { available: boolean; contactPresent: boolean; emailVerified: boolean; marketingEmail: boolean };

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
      // The browser card remains usable if local email capture is unavailable.
    });
    return () => { active = false; };
  }, [token]);

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await postJson<{ status: "queued" | "verified" }>(`/api/card/${encodeURIComponent(token)}/contact`, { email });
      setStatus(await apiJson<ContactStatus>(`/api/card/${encodeURIComponent(token)}/contact`));
      setMessage(result.status === "verified" ? french ? "Cette adresse de test est déjà vérifiée." : "Diese Testadresse ist bereits bestätigt." : french ? "Lien de vérification envoyé à Mailpit local. Aucun courriel externe." : "Bestätigungslink an lokales Mailpit gesendet. Keine externe E-Mail.");
      setEmail("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : french ? "Demande impossible." : "Anfrage fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  async function preference(granted: boolean) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await postJson<{ marketingEmail: boolean }>(`/api/card/${encodeURIComponent(token)}/contact/marketing`, { granted });
      setStatus(current => current && ({ ...current, marketingEmail: result.marketingEmail }));
      setMessage(granted ? french ? "Courriels marketing de test activés. Désabonnement possible ici." : "Lokale Test-Marketing-E-Mails aktiviert. Hier jederzeit abbestellbar." : french ? "Désabonné." : "Abbestellt.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : french ? "Préférence non enregistrée." : "Einstellung konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  if (!status?.available) return null;
  return <section className="card-contact-local" aria-label={french ? "Contact de test local" : "Lokaler Testkontakt"}>
    <h3>{french ? "Contact de test facultatif" : "Optionaler lokaler Testkontakt"}</h3>
    <p>{french ? "Uniquement pour des adresses synthétiques .test dans Mailpit local. Votre adresse n’apparaît pas dans la liste du commerçant. La carte reste utilisable sans adresse ; la récupération d’un lien perdu n’est pas encore disponible." : "Nur für synthetische .test-Adressen im lokalen Mailpit. Die Händlerübersicht zeigt keine E-Mail-Adresse. Die Karte funktioniert ohne Kontakt; ein verlorener Kartenlink lässt sich noch nicht wiederherstellen."}</p>
    <form onSubmit={request}><label>{french ? "Adresse .test" : "Test-E-Mail-Adresse (.test)"}<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="gast@example.test" maxLength={320} required /></label><button type="submit" className="button button--outline" disabled={busy}>{french ? "Envoyer le lien de vérification" : "Bestätigungslink senden"}</button></form>
    {status.contactPresent && <p className="card-contact-status">{status.emailVerified ? french ? "Adresse vérifiée." : "Adresse bestätigt." : french ? "Adresse non vérifiée ; aucun message marketing." : "Adresse noch nicht bestätigt; keine Marketing-Nachrichten."}</p>}
    {status.emailVerified && <div className="card-contact-preference"><p>{french ? "Choix séparé : recevoir des messages marketing par courriel pour ce programme de test. Aucun envoi externe n’est activé." : "Separate Einwilligung: E-Mail-Marketing für dieses Testprogramm. Externer Versand ist nicht aktiviert."}</p><button type="button" className="button button--outline" disabled={busy} onClick={() => void preference(!status.marketingEmail)}>{status.marketingEmail ? french ? "Se désabonner" : "E-Mail-Marketing abbestellen" : french ? "Accepter les courriels marketing de test" : "Test-E-Mail-Marketing aktivieren"}</button></div>}
    {message && <p role="status" className="card-contact-status">{message}</p>}
    {error && <p role="alert" className="card-contact-error">{error}</p>}
  </section>;
}
