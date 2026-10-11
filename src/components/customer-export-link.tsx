"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CustomerExportError, readCustomerExport, type CustomerExportFailure } from "./customer-export-download";

const messages: Record<CustomerExportFailure, { de: string; fr: string }> = {
  "invalid-card": { de: "Dieser Kartenlink gilt nicht mehr. Öffne deinen aktuellen Kartenlink, um deine Daten zu exportieren.", fr: "Ce lien de carte n’est plus valable. Ouvrez votre lien actuel pour exporter vos données." },
  "rate-limit": { de: "Zu viele Exportversuche. Bitte warte kurz und versuche es erneut.", fr: "Trop de tentatives d’export. Patientez un instant puis réessayez." },
  "unavailable": { de: "Der Export ist gerade nicht verfügbar. Bitte versuche es später erneut.", fr: "L’export est momentanément indisponible. Veuillez réessayer plus tard." },
  "incomplete": { de: "Der Export konnte nicht vollständig empfangen werden. Es wurde keine Exportdatei vorbereitet. Prüfe deine Verbindung und versuche es erneut.", fr: "L’export n’a pas pu être reçu entièrement. Aucun fichier d’export n’a été préparé. Vérifiez votre connexion et réessayez." },
};

export function CustomerExportLink({ url, locale, children }: { url: string; locale: "de" | "fr"; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  const downloads = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const urls = downloads.current;
    return () => {
      operation.current?.abort(); operation.current = null;
      for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); }
      urls.clear();
    };
  }, [url]);

  async function download() {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError("");
    try {
      const blob = await readCustomerExport(url, controller.signal);
      if (controller.signal.aborted) return;
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl; anchor.download = "loynara-card-export.json";
      document.body.append(anchor); anchor.click(); anchor.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(blobUrl); downloads.current.delete(blobUrl); }, 60_000);
      downloads.current.set(blobUrl, timer);
    } catch (cause) {
      if (!controller.signal.aborted) setError(messages[cause instanceof CustomerExportError ? cause.kind : "unavailable"][locale]);
    } finally {
      if (operation.current === controller) { operation.current = null; setBusy(false); }
    }
  }
  return <div className="customer-export"><a className="terms-link" href={url} download aria-disabled={busy || undefined} aria-busy={busy} onClick={event => { event.preventDefault(); void download(); }}>{busy ? locale === "fr" ? "Préparation de l’export …" : "Export wird vorbereitet …" : children}</a>{error && <p className="auth-error" role="alert">{error}</p>}</div>;
}
