"use client";

import { useEffect, useState } from "react";
import { apiJson, ClientApiError } from "./client-api";
import styles from "./card-referral.module.css";

type ReferralShare = { enabled?: true; shareUrl: string; referrerBonus: number; referredBonus: number; programType: "stamp" | "points"; progress?: { signedUp: number; qualified: number } };

export function CardReferral({ token, locale }: { token: string; locale: "de" | "fr" }) {
  const [share, setShare] = useState<ReferralShare | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    void apiJson<ReferralShare>(`/api/card/${encodeURIComponent(token)}/referral`).then(result => { if (active && (result as { enabled?: boolean }).enabled !== false) setShare(result); }).catch(cause => {
      if (!active || cause instanceof ClientApiError && cause.code === "REFERRAL_DISABLED") return;
      setError(cause instanceof Error ? cause.message : "Empfehlungslink nicht verfügbar.");
    });
    return () => { active = false; };
  }, [token]);

  if (!share && !error) return null;
  const french = locale === "fr";
  const unit = share?.programType === "points" ? french ? "points" : "Punkte" : french ? "tampons" : "Stempel";
  // Safe to read during render: the panel only renders after the client-side fetch, never during server rendering.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const local = share && ["localhost", "127.0.0.1"].includes(new URL(share.shareUrl).hostname);

  async function nativeShare() {
    if (!share) return;
    try { await navigator.share({ title: french ? "Ma carte de fidélité" : "Meine Treuekarte", url: share.shareUrl }); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) void copy(); }
  }

  async function copy() {
    if (!share) return;
    try { await navigator.clipboard.writeText(share.shareUrl); setCopied(true); setError(""); }
    catch { setError(french ? "Copie impossible. Sélectionnez et copiez le lien ci-dessous." : "Kopieren fehlgeschlagen. Wähle den Link unten aus und kopiere ihn manuell."); }
  }

  return <section className={styles.panel} aria-label={french ? "Parrainage" : "Empfehlung"}>
    <h3>{french ? "Partager cette carte" : "Karte empfehlen"}</h3>
    {share ? <>
      <ol className={styles.steps}>
        <li>{french ? "Vous partagez votre lien." : "Du teilst deinen Link."}</li>
        <li>{french ? "Votre ami·e crée une carte et passe en caisse." : "Eine Freundin oder ein Freund meldet sich an und kauft hier ein."}</li>
        <li>{french
          ? `Au premier passage confirmé en caisse : ${share.referrerBonus} ${unit} pour vous, ${share.referredBonus} ${unit} pour la nouvelle carte.`
          : `Beim ersten bestätigten Einkauf: ${share.referrerBonus} ${unit} für dich, ${share.referredBonus} ${unit} für die neue Karte.`}</li>
      </ol>
      {share.progress && share.progress.signedUp > 0 && <p className={styles.progress} role="status">{french
        ? `${share.progress.signedUp} carte(s) créée(s) avec votre lien, dont ${share.progress.qualified} confirmée(s) en caisse.`
        : `${share.progress.signedUp} ${share.progress.signedUp === 1 ? "Anmeldung" : "Anmeldungen"} über deinen Link, davon ${share.progress.qualified} an der Kasse bestätigt.`}</p>}
      <div className={styles.actions}>
        {canShare && <button type="button" className="button" onClick={() => void nativeShare()}>{french ? "Partager" : "Teilen"}</button>}
        <button type="button" className="button button--outline" onClick={() => void copy()}>{french ? "Copier le lien" : "Link kopieren"}</button>
      </div>
      <label className={styles.linkLabel}>{french ? "Lien à partager" : "Link zum Teilen"}<input readOnly value={share.shareUrl} onFocus={event => event.target.select()} /></label>
      {copied && <p role="status" className={styles.status}>{french ? "Lien copié." : "Link kopiert."}</p>}
      {local && <p className={styles.note}>{french ? "Aperçu local : ce lien fonctionne uniquement sur cet ordinateur." : "Lokale Vorschau: Dieser Link funktioniert nur auf diesem Rechner."}</p>}
      <p className={styles.note}>{french ? "Ouvrir le lien ou s'inscrire seul ne donne aucun bonus." : "Öffnen oder Anmelden allein bringt noch keinen Bonus."}</p>
    </> : null}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
