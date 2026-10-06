"use client";

import type { OfflineQueuedEvent } from "@/lib/offline-queue";
import type { UiLocale } from "./loyalty-ui";
import styles from "./offline-queue-panel.module.css";

const reasons: Record<string, string> = {
  LEASE_EXPIRED: "Die Offline-Freigabe ist abgelaufen.", EVENT_OUTSIDE_LEASE: "Der Vorgang liegt außerhalb der Freigabezeit.",
  STAFF_REVOKED: "Der Teamzugang ist nicht mehr aktiv.", CARD_CLOSED: "Die Karte wurde geschlossen.",
  LEASE_LIMIT: "Die Freigabe hat ihre Obergrenze erreicht.", STALE_RULE: "Die Programmregel wurde geändert.",
  LIMIT_EXCEEDED: "Die Vergabe überschreitet das Rollenlimit.",
};

export function OfflineQueuePanel({ events, busy, error, onSync, onAcknowledge, locale }: {
  events: OfflineQueuedEvent[]; busy: boolean; error?: string;
  onSync: () => void; onAcknowledge: (eventId: string) => void; locale: UiLocale;
}) {
  const pending = events.filter(item => item.state === "pending").length;
  return <section className={`app-panel ${styles.panel}`} aria-label={locale === "fr" ? "Ajouts hors ligne" : "Offline-Vergaben"}>
    <h2>{locale === "fr" ? "Ajouts hors ligne" : "Offline-Vergaben"}</h2>
    <p><strong>{pending} {locale === "fr" ? "en attente" : "ausstehend"}</strong>. {locale === "fr" ? "Le solde reste inchangé jusqu’à l’acceptation par le serveur. Les récompenses exigent une connexion." : "Der Kontostand bleibt bis zur Annahme durch den Server unverändert. Prämien werden nur online eingelöst."}</p>
    {pending > 0 && <button type="button" className="button button--outline" onClick={onSync} disabled={busy}>{locale === "fr" ? "Synchroniser les ajouts en attente" : "Ausstehende Vergaben synchronisieren"}</button>}
    {error && <p role="alert" className="inline-message inline-message--error">{error}</p>}
    {events.length > 0 && <ul className={styles.list}>{events.map(item => <li className={styles.item} key={item.eventId}>
      <strong>{"quantity" in item.award ? `${locale === "fr" ? "Quantité" : "Menge"}: ${item.award.quantity}` : `${locale === "fr" ? "Achat" : "Kaufbetrag"}: ${(item.award.purchaseAmountMinor / 100).toFixed(2)}`}</strong>
      <small>{item.cardLocator ?? (locale === "fr" ? "Carte sans numéro" : "Karte ohne Nummer")} · {new Date(item.eventAt).toLocaleString(locale === "fr" ? "fr-FR" : "de-DE")}</small>
      <span className={item.state === "rejected" ? styles.rejected : styles.state}>{item.state === "pending" ? locale === "fr" ? "En attente du serveur" : "Wartet auf Server" : item.state === "accepted" ? locale === "fr" ? "Accepté par le serveur" : "Vom Server angenommen" : locale === "fr" ? `Refusé : ${item.reason ?? "inconnu"}` : `Abgelehnt: ${reasons[item.reason ?? ""] ?? item.reason ?? "Unbekannter Grund"} (${item.reason ?? "UNKNOWN"})`}</span>
      {item.state !== "pending" && <button type="button" className="text-button" onClick={() => onAcknowledge(item.eventId)}>{locale === "fr" ? "Vérifié, retirer" : "Geprüft, aus Liste entfernen"}</button>}
    </li>)}</ul>}
  </section>;
}
