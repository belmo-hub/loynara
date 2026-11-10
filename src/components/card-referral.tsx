"use client";

import { useEffect, useState } from "react";
import { withUnit } from "@/lib/units";
import { apiJson } from "./client-api";
import { Gift, Share2 } from "lucide-react";
import { Button } from "./ui/button";
import { TextField } from "./ui/field";
import styles from "./customer/panels.module.css";
import { CardStatusLine, useCardStatus } from "./customer/card-status";
import { CopyLabel, useCopy } from "./copy-text";
import { Reveal } from "./customer/reveal";
import type { ReferralHold } from "./customer/booking-moment";

type ReferralShare = { enabled?: true; shareUrl: string; referrerBonus: number; referredBonus: number; programType: "stamp" | "points"; progress?: { signedUp: number; qualified: number } };

/**
 * Without `hold`: the panel as it always was. With it (ENG-206, STAMP_ANIMATION_ENABLED): the compact block under the
 * card group. "held" keeps it shut while the stamp of the booking that made it due lands, "released" opens it in place;
 * "none" is a later visit, where it simply stands there.
 */
export function CardReferral({ token, locale, hold }: { token: string; locale: "de" | "fr"; hold?: ReferralHold }) {
  const [share, setShare] = useState<ReferralShare | null>(null);
  const [error, setError] = useState("");
  const { copied, copy: copyLink } = useCopy();
  const { text: copiedText, live, announce } = useCardStatus("referral");
  useEffect(() => {
    let active = true;
    void apiJson<ReferralShare>(`/api/card/${encodeURIComponent(token)}/referral`).then(result => { if (active && (result as { enabled?: boolean }).enabled !== false) setShare(result); }).catch(() => { /* optional block: when it cannot load (off, rate limit, offline) it stays hidden, never a raw error on the card */ });
    return () => { active = false; };
  }, [token]);

  const late = hold === "held" || hold === "released";
  // The same Reveal before and after the answer, so the block opens in place.
  if (!share) return late ? <Reveal open={false} gap="var(--space-4)">{null}</Reveal> : null;
  const french = locale === "fr";
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
    if (await copyLink(share.shareUrl)) { announce(french ? "Lien copié." : "Link kopiert."); setError(""); }
    else { setError(french ? "Copie impossible. Sélectionnez et copiez le lien ci-dessous." : "Kopieren fehlgeschlagen. Wähle den Link unten aus und kopiere ihn manuell."); }
  }

  const bonusLine = french
    ? `Au premier passage confirmé en caisse : ${withUnit(share.referrerBonus, share.programType, locale)} pour vous, ${withUnit(share.referredBonus, share.programType, locale)} pour la nouvelle carte.`
    : `Beim ersten bestätigten Einkauf: ${withUnit(share.referrerBonus, share.programType, locale)} für dich, ${withUnit(share.referredBonus, share.programType, locale)} für die neue Karte.`;
  if (hold) {
    // One button: share where the phone can, else copy. A failed copy shows the link to copy by hand.
    const compact = <section className={`${styles.panel} ${styles.compact}`} aria-label={french ? "Parrainage" : "Empfehlung"}>
      <h3 className={styles.title}><Gift size={18} aria-hidden="true" /> {french ? "Partager cette carte" : "Karte empfehlen"}</h3>
      {canShare
        ? <Button variant="secondary" size="sm" icon={<Share2 size={16} />} onClick={() => void nativeShare()}>{french ? "Partager" : "Teilen"}</Button>
        : <Button variant="secondary" size="sm" onClick={() => void copy()}><CopyLabel copied={copied} label={french ? "Copier le lien" : "Link kopieren"} done={french ? "Copié" : "Kopiert"} /></Button>}
      <p className={styles.muted}>{bonusLine}</p>
      <CardStatusLine text={copiedText} live={live} className={styles.state} />
      {error && <><p role="alert" className={styles.error}>{error}</p><TextField label={french ? "Lien à partager" : "Link zum Teilen"} readOnly value={share.shareUrl} onFocus={event => event.target.select()} /></>}
    </section>;
    return late ? <Reveal open={hold === "released"} gap="var(--space-4)">{compact}</Reveal> : compact;
  }
  return <section className={styles.panel} aria-label={french ? "Parrainage" : "Empfehlung"}>
    <h3 className={styles.title}><Gift size={18} aria-hidden="true" /> {french ? "Partager cette carte" : "Karte empfehlen"}</h3>
    {share ? <>
      <ol className={styles.steps}>
        <li>{french ? "Vous partagez votre lien." : "Du teilst deinen Link."}</li>
        <li>{french ? "Votre ami·e crée une carte et passe en caisse." : "Eine Freundin oder ein Freund meldet sich an und kauft hier ein."}</li>
        <li>{bonusLine}</li>
      </ol>
      {share.progress && share.progress.signedUp > 0 && <p className={styles.state}>{french
        ? `${share.progress.signedUp} carte(s) créée(s) avec votre lien, dont ${share.progress.qualified} avec un bonus crédité.`
        : `${share.progress.signedUp} ${share.progress.signedUp === 1 ? "Anmeldung" : "Anmeldungen"} über deinen Link, davon ${share.progress.qualified} mit gutgeschriebenem Bonus.`}</p>}
      <div className={styles.actions}>
        {canShare && <Button size="sm" icon={<Share2 size={16} />} onClick={() => void nativeShare()}>{french ? "Partager" : "Teilen"}</Button>}
        <Button variant="secondary" size="sm" onClick={() => void copy()}><CopyLabel copied={copied} label={french ? "Copier le lien" : "Link kopieren"} done={french ? "Copié" : "Kopiert"} /></Button>
      </div>
      <TextField label={french ? "Lien à partager" : "Link zum Teilen"} readOnly value={share.shareUrl} onFocus={event => event.target.select()} />
      <CardStatusLine text={copiedText} live={live} className={styles.state} />
      {local && <p className={styles.muted}>{french ? "Aperçu local : ce lien fonctionne uniquement sur cet ordinateur." : "Lokale Vorschau: Dieser Link funktioniert nur auf diesem Rechner."}</p>}
      <p className={styles.muted}>{french ? "Ouvrir le lien ou s'inscrire seul ne donne aucun bonus." : "Öffnen oder Anmelden allein bringt noch keinen Bonus."}</p>
    </> : null}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
