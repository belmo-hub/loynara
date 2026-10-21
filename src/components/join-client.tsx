"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { apiJson, ClientApiError, postJson, type PublicProgram } from "./client-api";
import { Gift } from "lucide-react";
import { CustomerState } from "./customer/customer-state";
import { Button, buttonClassName } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { CustomerShell } from "./ui/customer-shell";
import { PointsLadder } from "./ui/points-ladder";
import { StampGrid } from "./ui/stamp-grid";
import styles from "./customer/join.module.css";

const copy = {
  de: {
    header: "DIGITALE TREUEKARTE", loadingLabel: "EIN MOMENT", loadingTitle: "Programm wird geladen.", loadingText: "Die Regeln und die Prämie werden abgerufen.", missingLabel: "NICHT VERFÜGBAR", missingTitle: "Dieses Programm ist nicht erreichbar.", home: "Zur Startseite", welcome: "Willkommen bei", headline: "Mach deinen Besuch zählbar.", intro: "Hol dir deine Karte direkt im Browser. An der Kasse sammelst du", introEnd: "für deine nächste Prämie.", stamp: "Stempel", points: "Punkte", reward: "DEINE PRÄMIE", rewardLabel: "Deine Prämie", cardPreview: "So sieht deine Karte aus", noEmail: "Für die Karte brauchst du keine E-Mail-Adresse und kein Konto.", for: "für", rules: "So funktioniert das Programm", inactive: "Dieses Programm startet zu einem späteren Zeitpunkt. Die Anmeldung ist noch geschlossen.", email: "E-Mail-Adresse", optional: "optional", emailHint: "Für deine Karte ist keine E-Mail-Adresse nötig.", consentStart: "Ich habe die oben stehenden Programmregeln gelesen und akzeptiere sie.", terms: "Weitere Teilnahmebedingungen", privacy: "Datenschutzhinweise", marketing: "Ich möchte künftig E-Mails mit Angeboten dieses Geschäfts erhalten. Diese Wahl ist freiwillig und unabhängig von meiner Karte.", submit: "Meine Karte erstellen", submitting: "Karte wird erstellt …", footer: "Mit Loynara, ohne zusätzliche App", acceptError: "Bitte akzeptiere zuerst die Programmregeln.", emailError: "Für Nachrichten brauchen wir eine E-Mail-Adresse.", inactiveError: "Dieses Programm ist noch nicht aktiv.", submitError: "Die Karte konnte nicht erstellt werden.", loadError: "Das Programm wurde nicht gefunden.", and: "und",
    welcomeBack: "Willkommen zurück.", savedHere: "Auf diesem Gerät ist deine Karte gespeichert.", cardNumber: "Kartennummer", openCard: "Meine Karte öffnen", anotherLink: "Ich brauche eine weitere Karte", anotherTitle: "Weitere Karte erstellen?", anotherConfirm: "Ich möchte trotzdem eine zusätzliche Karte erstellen.", anotherSubmit: "Weitere Karte erstellen", backToCard: "Zurück zu meiner Karte", anotherConfirmError: "Bitte bestätige, dass du eine zusätzliche Karte möchtest.", staleNote: "Auf diesem Gerät war eine Karte gespeichert, die nicht mehr gilt, zum Beispiel weil sie geschlossen oder neu ausgestellt wurde. Hast du einen neuen Kartenlink bekommen, öffne bitte diesen.", existsError: "Auf diesem Gerät gibt es schon eine Karte für dieses Programm.", checking: "Prüfe, ob du hier schon eine Karte hast …", referralUnavailable: "Dieser Empfehlungslink ist nicht verfügbar. Du kannst ohne Empfehlungsbonus eine normale Karte erstellen.", withoutReferral: "Ohne Empfehlungslink fortfahren", unconfirmed: "Die Kartenerstellung wurde nicht bestätigt. Deine Karte kann bereits erstellt sein. Lade die Seite neu, um eine auf diesem Gerät gespeicherte Karte zu prüfen. Erstelle nicht vorschnell eine weitere Karte.",
  },
  fr: {
    header: "CARTE DE FIDÉLITÉ NUMÉRIQUE", loadingLabel: "UN INSTANT", loadingTitle: "Chargement du programme.", loadingText: "Nous récupérons les règles et la récompense.", missingLabel: "INDISPONIBLE", missingTitle: "Ce programme est inaccessible.", home: "Retour à l’accueil", welcome: "Bienvenue chez", headline: "Chaque visite compte.", intro: "Obtenez votre carte directement dans le navigateur. En caisse, cumulez des", introEnd: "pour votre prochaine récompense.", stamp: "tampons", points: "points", reward: "VOTRE RÉCOMPENSE", rewardLabel: "Votre récompense", cardPreview: "Aperçu de votre carte", noEmail: "Aucune adresse e-mail ni compte n’est nécessaire pour la carte.", for: "pour", rules: "Règles du programme", inactive: "Ce programme commencera plus tard. L’inscription n’est pas encore ouverte.", email: "Adresse e-mail", optional: "facultative", emailHint: "Aucune adresse e-mail n’est nécessaire pour obtenir la carte.", consentStart: "J’ai lu et j’accepte les règles du programme ci-dessus.", terms: "Autres conditions de participation", privacy: "Politique de confidentialité", marketing: "Je souhaite recevoir à l’avenir des e-mails promotionnels de ce commerce. Ce choix est facultatif et indépendant de ma carte.", submit: "Créer ma carte", submitting: "Création de la carte …", footer: "Avec Loynara, sans application supplémentaire", acceptError: "Veuillez d’abord accepter les règles du programme.", emailError: "Une adresse e-mail est nécessaire pour recevoir des messages.", inactiveError: "Ce programme n’est pas encore actif.", submitError: "La carte n’a pas pu être créée.", loadError: "Programme introuvable.", and: "et",
    welcomeBack: "Bon retour.", savedHere: "Votre carte est enregistrée sur cet appareil.", cardNumber: "Numéro de carte", openCard: "Ouvrir ma carte", anotherLink: "J’ai besoin d’une autre carte", anotherTitle: "Créer une autre carte ?", anotherConfirm: "Je veux quand même créer une carte supplémentaire.", anotherSubmit: "Créer une autre carte", backToCard: "Retour à ma carte", anotherConfirmError: "Veuillez confirmer que vous voulez une carte supplémentaire.", staleNote: "Une carte enregistrée sur cet appareil n’est plus valable, par exemple parce qu’elle a été fermée ou réémise. Si vous avez reçu un nouveau lien de carte, ouvrez-le.", existsError: "Une carte pour ce programme existe déjà sur cet appareil.", checking: "Vérification d’une carte existante sur cet appareil …", referralUnavailable: "Ce lien de parrainage est indisponible. Vous pouvez créer une carte ordinaire sans bonus de parrainage.", withoutReferral: "Continuer sans lien de parrainage", unconfirmed: "La création de la carte n’est pas confirmée. Votre carte peut déjà avoir été créée. Rechargez la page pour vérifier si une carte est enregistrée sur cet appareil. Ne créez pas une autre carte dans la précipitation.",
  },
} as const;

/** "1 Punkt pro ausgegebenem Euro" / "3 Punkte pro ausgegebenem Euro"; fractions are rounded down by the server. */
function earnRule(perUnit: number, currency: string, locale: "de" | "fr") {
  const euro = currency === "EUR";
  if (locale === "fr") return `${perUnit} point${perUnit === 1 ? "" : "s"} par ${euro ? "euro" : currency} dépensé. Les fractions de point sont arrondies à l’entier inférieur.`;
  return `${perUnit} ${perUnit === 1 ? "Punkt" : "Punkte"} pro ausgegebenem ${euro ? "Euro" : currency}. Bruchteile von Punkten werden abgerundet.`;
}

function subscribeToLocation(notify: () => void) {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
}
function currentReferralCode() { return new URLSearchParams(window.location.search).get("ref"); }
function serverReferralCode() { return null; }

type Returning = { state: "checking" | "none" | "stale" | "unknown" } | { state: "existing"; cardLocator: string };

/**
 * Asks the server whether this browser already holds a valid card for the programme. The answer contains only the
 * card number; the card itself is opened through a server redirect (/api/enroll/open). Any failure means "unknown":
 * joining stays possible and the server still refuses a silent second card (409 CARD_EXISTS).
 */
async function checkReturning(slug: string): Promise<Returning> {
  try {
    const result = await apiJson<{ existing: boolean; stale?: boolean; cardLocator?: string }>(`/api/enroll/existing?slug=${encodeURIComponent(slug)}`);
    if (result.existing && typeof result.cardLocator === "string" && /^K-[A-Z2-9]{6}$/.test(result.cardLocator)) return { state: "existing", cardLocator: result.cardLocator };
    return { state: result.stale ? "stale" : "none" };
  } catch { return { state: "unknown" }; }
}

export function JoinClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [program, setProgram] = useState<PublicProgram | null>(null);
  const [loading, setLoading] = useState(true);
  const [returning, setReturning] = useState<Returning>({ state: "checking" });
  const [wantsAnother, setWantsAnother] = useState(false);
  const [confirmAnother, setConfirmAnother] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [referralUnavailable, setReferralUnavailable] = useState(false);
  const referralCode = useSyncExternalStore(subscribeToLocation, currentReferralCode, serverReferralCode);
  const locale = program?.locale === "fr" ? "fr" : "de";
  const t = copy[locale];
  const unit = program?.programType === "points" ? t.points : t.stamp;
  const existing = returning.state === "existing" ? returning : null;
  const openHref = `/api/enroll/open?slug=${encodeURIComponent(slug)}`;

  useEffect(() => {
    let mounted = true;
    void apiJson<PublicProgram>(`/api/program/${encodeURIComponent(slug)}`).then(result => {
      if (mounted) { setProgram(result); setLoading(false); }
    }).catch(cause => {
      if (mounted) { setError(cause instanceof Error ? cause.message : copy.de.loadError); setLoading(false); }
    });
    void checkReturning(slug).then(result => { if (mounted) setReturning(result); });
    return () => { mounted = false; };
  }, [slug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setReferralUnavailable(false);
    if (!acceptedTerms) { setError(t.acceptError); return; }
    if ((existing || returning.state === "stale") && !confirmAnother) { setError(t.anotherConfirmError); return; }
    setBusy(true);
    try {
      if (program?.active === false) throw new Error(t.inactiveError);
      // The server recognises this browser only once its card cookie exists, so two tabs (or the counter QR scanned again
      // while the first request is slow) could each create a first card. Creations for a programme therefore run one at a
      // time across this browser's tabs, and each looks again first whether another tab has just created the card.
      const create = async () => {
        if (!existing) {
          const latest = await checkReturning(slug);
          if (latest.state === "existing") { setReturning(latest); setWantsAnother(false); setConfirmAnother(false); return null; }
        }
        return postJson<{ cardToken: string }>("/api/enroll", { slug, acceptedTerms: true, ...(referralCode ? { referralCode } : {}), ...((existing || returning.state === "stale") ? { additionalCard: true } : {}) });
      };
      const result = navigator.locks ? await navigator.locks.request(`loynara-join:${slug}`, create) : await create();
      if (!result) return;
      const continuation = sessionStorage.getItem("loynara_tap_return");
      sessionStorage.removeItem("loynara_tap_return");
      if (continuation && /^\/tap\/[A-Za-z0-9_-]{24}\?e=[a-fA-F0-9]{32}&c=[a-fA-F0-9]{16}$/.test(continuation)) router.push(continuation);
      else router.push(`/card/${encodeURIComponent(result.cardToken)}`);
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.code === "CARD_EXISTS") {
        // The server knows a valid card for this browser that the page did not (failed or outdated check): offer it.
        const found = await checkReturning(slug);
        setReturning(found); setWantsAnother(false); setConfirmAnother(false);
        setError(found.state === "existing" ? "" : t.existsError);
      } else if (cause instanceof ClientApiError && cause.code === "INVALID_REFERRAL") {
        setReferralUnavailable(true); setError(t.referralUnavailable);
      } else if (cause instanceof ClientApiError && (cause.status === 0 || (cause.status >= 200 && cause.status < 300))) {
        setError(t.unconfirmed);
      } else setError(cause instanceof Error ? cause.message : t.submitError);
    }
    finally { setBusy(false); }
  }

  const rewardLine = program && <p className={`join-reward ${styles.reward}`}><Gift size={18} aria-hidden="true" /><span><small>{t.rewardLabel}</small><strong>{program.rewardTitle}</strong> {t.for} {program.rewardCost} {unit}</span></p>;
  const cardNumber = existing && <p className={`join-card-number ${styles.cardNumber}`}><span>{t.cardNumber}</span><strong>{existing.cardLocator}</strong></p>;

  if (loading) return <CustomerState title={t.loadingTitle} message={t.loadingText} locale={locale} />;
  if (!program) return <CustomerState title={t.missingTitle} message={error} tone="error" locale={locale} focusTitle />;

  const preview = <section className={`join-hero ${styles.hero}`} aria-label={t.cardPreview}>
    <p className={styles.welcome}>{t.welcome}</p>
    <h1 className={styles.business}>{program.businessName}</h1>
    <p className={styles.location}>{program.locationName}</p>
    {program.programType === "points"
      ? <PointsLadder balance={0} rewards={(program.rewards?.length ? program.rewards : [{ title: program.rewardTitle, cost: program.rewardCost }]).map(item => ({ title: item.title, cost: item.cost }))} locale={locale} />
      : <StampGrid earned={0} total={program.rewardCost} locale={locale} size="sm" className={styles.stamps} />}
    {rewardLine}
  </section>;

  return <CustomerShell brandColor={program.brandColor} locale={locale} footer={<p className={styles.footer}>{t.footer}</p>}>
    {preview}
    {returning.state === "stale" && !wantsAnother ? <section className={styles.panel}>
      <h2 className={styles.title}>{locale === "fr" ? "Retrouver votre carte" : "Deine Karte wiederfinden"}</h2>
      <p className={styles.muted}>{t.staleNote}</p>
      <p className={styles.muted}>{locale === "fr" ? "Ouvrez votre lien privé actuel. Le numéro de carte seul ne prouve pas que la carte vous appartient." : "Öffne deinen aktuellen privaten Kartenlink. Die Kartennummer allein ist kein Eigentumsnachweis."}</p>
      <Link className={buttonClassName({ block: true })} href="/recover">{locale === "fr" ? "Récupération sécurisée" : "Karte sicher wiederherstellen"}</Link>
      <Button variant="quiet" onClick={() => setWantsAnother(true)}>{t.anotherLink}</Button>
    </section> : existing && !wantsAnother ? <section className={`join-returning ${styles.panel}`}>
      <h2 className={styles.title}>{t.welcomeBack}</h2>
      <p className={styles.muted}>{t.savedHere}</p>
      {cardNumber}
      <a className={buttonClassName({ size: "lg", block: true })} href={openHref}>{t.openCard}</a>
      <Button variant="quiet" className="join-another-link" onClick={() => { setWantsAnother(true); setError(""); }}>{t.anotherLink}</Button>
    </section> : <section className={styles.panel}>
      {existing ? <>
        <h2 className={styles.title}>{t.anotherTitle}</h2>
        <p className={`join-another-warning ${styles.warning}`} role="note">{locale === "fr" ? `Une nouvelle carte commence à 0 ${unit}. Vos ${unit} actuels restent sur la carte ${existing.cardLocator} et ne sont pas transférés.` : `Eine weitere Karte startet bei 0 ${unit}. Deine bisherigen ${unit} bleiben auf Karte ${existing.cardLocator} und werden nicht übertragen.`}</p>
        <a className={buttonClassName({ variant: "secondary", block: true })} href={openHref}>{t.backToCard}</a>
      </> : <>
        <h2 className={styles.headline}>{t.headline}</h2>
        <p className={styles.lead}>{t.intro} {unit} {t.introEnd}</p>
      </>}
      {returning.state === "stale" && <p className={styles.muted} role="status">{t.staleNote}</p>}
      {program.rewards?.length > 1 && <ul className={styles.rewardList} aria-label={locale === "fr" ? "Autres récompenses" : "Weitere Prämien"}>{program.rewards.slice(1).map(item => <li key={item.id}><strong>{item.title}</strong><span>{item.cost} {unit}</span></li>)}</ul>}
      {program.programType === "points" && program.earningMode === "purchase" && <p className={styles.muted}>{earnRule(program.pointsPerCurrencyUnit, program.currency, locale)}</p>}
      {referralCode && <p className={styles.note}>{program.referral?.enabled && !referralUnavailable
        ? locale === "fr" ? `Lien de parrainage : après votre premier passage confirmé en caisse et la vérification des conditions, votre parrain peut recevoir ${program.referral.referrerBonus} ${unit} et vous ${program.referral.referredBonus} ${unit}. Ouvrir le lien seul ne donne aucun bonus.` : `Empfehlungslink: Erst nach deinem ersten bestätigten Kassenauftrag und Prüfung der Bedingungen kann die empfehlende Karte ${program.referral.referrerBonus} ${unit} und deine Karte ${program.referral.referredBonus} ${unit} erhalten. Das Öffnen des Links bringt keinen Bonus.`
        : locale === "fr" ? "Ce lien de parrainage est indisponible. Ouvrez le programme sans ce lien pour créer une carte ordinaire." : "Dieser Empfehlungslink ist nicht verfügbar. Öffne das Programm ohne diesen Link für eine normale Karte."}</p>}
      {referralCode && (referralUnavailable || program.referral?.enabled === false) && <p className={styles.link}><a href={`/join/${encodeURIComponent(slug)}`}>{t.withoutReferral}</a></p>}
      <div className={styles.rules}><h3>{t.rules}</h3><p>{program.rulesText}</p>{program.pointsExpiryRule && <p>{program.pointsExpiryRule}</p>}</div>
      {program.active === false && <p className={styles.warning} role="status">{t.inactive}</p>}
      <form className={styles.form} onSubmit={submit}>
        <Checkbox checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} required>{t.consentStart} <Link href="/teilnahmebedingungen" target="_blank">{t.terms}</Link> {t.and} <Link href="/datenschutz" target="_blank">{t.privacy}</Link>.</Checkbox>
        {(existing || returning.state === "stale") && <Checkbox checked={confirmAnother} onChange={e => setConfirmAnother(e.target.checked)}>{t.anotherConfirm}</Checkbox>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {returning.state === "checking" && <p className={styles.muted} role="status">{t.checking}</p>}
        <Button type="submit" variant={existing ? "secondary" : "primary"} size="lg" block loading={busy} disabled={program.active === false || returning.state === "checking"}>{busy ? t.submitting : existing ? t.anotherSubmit : t.submit}</Button>
        <p className={styles.muted}>{t.noEmail}</p>
      </form>
      <p className={styles.link}><Link href="/recover">{locale === "fr" ? "Vous avez déjà une carte ? Récupération sécurisée" : "Du hast schon eine Karte? Sicher wiederherstellen"}</Link></p>
    </section>}
  </CustomerShell>;
}
