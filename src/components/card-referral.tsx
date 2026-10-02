"use client";

import { useEffect, useState } from "react";
import { apiJson, ClientApiError } from "./client-api";
import styles from "./card-referral.module.css";

type ReferralShare = { enabled?: true; shareUrl: string; referrerBonus: number; referredBonus: number; programType: "stamp" | "points" };

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
  const local = share && ["localhost", "127.0.0.1"].includes(new URL(share.shareUrl).hostname);

  async function copy() {
    if (!share) return;
    try { await navigator.clipboard.writeText(share.shareUrl); setCopied(true); setError(""); }
    catch { setError(french ? "Copie impossible. Sélectionnez et copiez le lien ci-dessous." : "Kopieren fehlgeschlagen. Wähle den Link unten aus und kopiere ihn manuell."); }
  }

  return <section className={styles.panel} aria-label={french ? "Parrainage" : "Empfehlung"}>
    <h3>{french ? "Partager cette carte" : "Karte empfehlen"}</h3>
    {share ? <>
      <p>{french
        ? `Après le premier passage confirmé en caisse d'une nouvelle carte admissible, votre carte peut recevoir ${share.referrerBonus} ${unit} et la nouvelle carte ${share.referredBonus} ${unit}.`
        : `Nach dem ersten bestätigten Kassenauftrag einer berechtigten neuen Karte kann deine Karte ${share.referrerBonus} ${unit} und die neue Karte ${share.referredBonus} ${unit} erhalten.`}</p>
      <label className={styles.linkLabel}>{french ? "Lien à partager" : "Link zum Teilen"}<input readOnly value={share.shareUrl} onFocus={event => event.target.select()} /></label>
      <button type="button" className="button button--outline" onClick={() => void copy()}>{french ? "Copier le lien" : "Link kopieren"}</button>
      {copied && <p role="status" className={styles.status}>{french ? "Lien copié." : "Link kopiert."}</p>}
      {local && <p className={styles.note}>{french ? "Aperçu local : ce lien fonctionne uniquement sur cet ordinateur." : "Lokale Vorschau: Dieser Link funktioniert nur auf diesem Rechner."}</p>}
      <p className={styles.note}>{french ? "Ouvrir le lien seul ne donne aucun bonus." : "Das Öffnen des Links allein bringt keinen Bonus."}</p>
    </> : null}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
