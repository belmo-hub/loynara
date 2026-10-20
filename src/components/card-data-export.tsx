"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { postJson } from "./client-api";
import { readPersonalExport } from "./personal-export-download";
import { Button } from "./ui/button";
import styles from "./customer/panels.module.css";

export function CardDataExport({ token, locale = "de", proof }: { token?: string; locale?: "de" | "fr"; proof?: string }) {
  const french = locale === "fr";
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  async function download() {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setMessage(""); setError("");
    try {
      if (token) {
        const result = await postJson<{ mode: "bearer" | "email" }>(`/api/card/${encodeURIComponent(token)}/data-export/request`, {});
        if (result.mode === "email") { setMessage(french ? "Un lien valable dix minutes a été demandé à l’adresse déjà vérifiée. Ouvrez-le pour télécharger vos données." : "Ein zehn Minuten gültiger Link wurde an die bereits bestätigte Adresse angefordert. Öffne ihn für deinen Download."); return; }
      }
      const blob = await readPersonalExport(token ? `/api/card/${encodeURIComponent(token)}/data-export` : "/api/customer-data-export", token ? {} : { proof }, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = "loynara-personal-data.json"; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(french ? "Le téléchargement a été préparé. Conservez ce fichier en lieu sûr." : "Der Download wurde vorbereitet. Bewahre diese Datei sicher auf.");
    } catch (cause) {
      if (!controller.signal.aborted) setError(french ? "Export indisponible. Demandez un nouveau lien ou contactez le responsable de la confidentialité du commerce, sans transmettre votre lien privé." : cause instanceof Error ? cause.message : "Der Export ist nicht verfügbar.");
    } finally { operation.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className={styles.panel} aria-label={french ? "Données personnelles" : "Persönliche Daten"}>
    <h3 className={styles.title}>{french ? "Vos données personnelles" : "Deine persönlichen Daten"}</h3>
    <p className={styles.muted}>{french ? "Export complet des données conservées pour cette carte. Une adresse vérifiée nécessite une nouvelle confirmation. Utilisez uniquement votre appareil privé." : "Vollständiger Export der gespeicherten Daten dieser Karte. Bei bestätigter E-Mail-Adresse ist eine neue Bestätigung erforderlich. Nutze dafür nur dein privates Gerät."}</p>
    <Button variant="secondary" loading={busy} onClick={() => void download()} disabled={!token && !proof}>{french ? "Exporter mes données" : "Persönliche Daten exportieren"}</Button>
    <p className={styles.muted}>{french ? "Lien perdu ou adresse non vérifiée ? Contactez le responsable de la confidentialité du commerce pour une demande accompagnée. Ne transmettez pas votre lien privé." : "Kartenlink verloren oder Adresse unbestätigt? Wende dich für eine begleitete Datenauskunft an den Datenschutzkontakt deines Geschäfts. Teile keinen privaten Kartenlink."} <Link href="/datenschutz">{french ? "Confidentialité" : "Datenschutz"}</Link></p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
