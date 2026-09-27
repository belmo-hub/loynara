"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { apiJson, postJson, type PublicProgram } from "./client-api";
import { BrandIcon, BrandMark, Icon } from "./loyalty-ui";

const copy = {
  de: {
    header: "DIGITALE TREUEKARTE", loadingLabel: "EIN MOMENT", loadingTitle: "Programm wird geladen.", loadingText: "Die Regeln und die Prämie werden abgerufen.", missingLabel: "NICHT VERFÜGBAR", missingTitle: "Dieses Programm ist nicht erreichbar.", home: "Zur Startseite", welcome: "WILLKOMMEN BEI", headline: "Mach deinen Besuch zählbar.", intro: "Hol dir deine Karte direkt im Browser. An der Kasse sammelst du", introEnd: "für deine nächste Prämie.", stamp: "Stempel", points: "Punkte", reward: "DEINE PRÄMIE", for: "Für", rules: "So funktioniert das Programm", inactive: "Dieses Programm startet zu einem späteren Zeitpunkt. Die Anmeldung ist noch geschlossen.", email: "E-Mail-Adresse", optional: "optional", emailHint: "Für deine Karte ist keine E-Mail-Adresse nötig.", consentStart: "Ich habe die oben stehenden Programmregeln gelesen und akzeptiere sie.", terms: "Weitere Teilnahmebedingungen", privacy: "Datenschutzhinweise", marketing: "Ich möchte künftig E-Mails mit Angeboten dieses Geschäfts erhalten. Diese Wahl ist freiwillig und unabhängig von meiner Karte.", submit: "Meine Karte erstellen", submitting: "Karte wird erstellt …", footer: "Mit Loynara · Ohne zusätzliche App", acceptError: "Bitte akzeptiere zuerst die Programmregeln.", emailError: "Für Nachrichten brauchen wir eine E-Mail-Adresse.", inactiveError: "Dieses Programm ist noch nicht aktiv.", submitError: "Die Karte konnte nicht erstellt werden.", loadError: "Das Programm wurde nicht gefunden.", and: "und",
  },
  fr: {
    header: "CARTE DE FIDÉLITÉ NUMÉRIQUE", loadingLabel: "UN INSTANT", loadingTitle: "Chargement du programme.", loadingText: "Nous récupérons les règles et la récompense.", missingLabel: "INDISPONIBLE", missingTitle: "Ce programme est inaccessible.", home: "Retour à l’accueil", welcome: "BIENVENUE CHEZ", headline: "Chaque visite compte.", intro: "Obtenez votre carte directement dans le navigateur. En caisse, cumulez des", introEnd: "pour votre prochaine récompense.", stamp: "tampons", points: "points", reward: "VOTRE RÉCOMPENSE", for: "Pour", rules: "Règles du programme", inactive: "Ce programme commencera plus tard. L’inscription n’est pas encore ouverte.", email: "Adresse e-mail", optional: "facultative", emailHint: "Aucune adresse e-mail n’est nécessaire pour obtenir la carte.", consentStart: "J’ai lu et j’accepte les règles du programme ci-dessus.", terms: "Autres conditions de participation", privacy: "Politique de confidentialité", marketing: "Je souhaite recevoir à l’avenir des e-mails promotionnels de ce commerce. Ce choix est facultatif et indépendant de ma carte.", submit: "Créer ma carte", submitting: "Création de la carte …", footer: "Avec Loynara · Sans application supplémentaire", acceptError: "Veuillez d’abord accepter les règles du programme.", emailError: "Une adresse e-mail est nécessaire pour recevoir des messages.", inactiveError: "Ce programme n’est pas encore actif.", submitError: "La carte n’a pas pu être créée.", loadError: "Programme introuvable.", and: "et",
  },
} as const;

function subscribeToLocation(notify: () => void) {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
}
function currentReferralCode() { return new URLSearchParams(window.location.search).get("ref"); }
function serverReferralCode() { return null; }

export function JoinClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [program, setProgram] = useState<PublicProgram | null>(null);
  const [loading, setLoading] = useState(true);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const referralCode = useSyncExternalStore(subscribeToLocation, currentReferralCode, serverReferralCode);
  const locale = program?.locale === "fr" ? "fr" : "de";
  const t = copy[locale];
  const unit = program?.programType === "points" ? t.points : t.stamp;

  useEffect(() => {
    let mounted = true;
    void apiJson<PublicProgram>(`/api/program/${encodeURIComponent(slug)}`).then(result => {
      if (mounted) { setProgram(result); setLoading(false); }
    }).catch(cause => {
      if (mounted) { setError(cause instanceof Error ? cause.message : copy.de.loadError); setLoading(false); }
    });
    return () => { mounted = false; };
  }, [slug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!acceptedTerms) { setError(t.acceptError); return; }
    setBusy(true);
    try {
      if (program?.active === false) throw new Error(t.inactiveError);
      const result = await postJson<{ cardToken: string }>("/api/enroll", { slug, acceptedTerms: true, ...(referralCode ? { referralCode } : {}) });
      const continuation = sessionStorage.getItem("loynara_tap_return");
      sessionStorage.removeItem("loynara_tap_return");
      if (continuation && /^\/tap\/[A-Za-z0-9_-]{24}\?e=[a-fA-F0-9]{32}&c=[a-fA-F0-9]{16}$/.test(continuation)) router.push(continuation);
      else router.push(`/card/${encodeURIComponent(result.cardToken)}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.submitError); }
    finally { setBusy(false); }
  }

  return <div className="join-page" lang={locale}>
    <header className="join-header"><Link href="/" aria-label="Loynara"><BrandMark /></Link><span>{t.header}</span></header>
    <main className="join-main">
      {loading ? <div className="join-panel join-state"><span className="eyebrow"><span className="eyebrow-dot" /> {t.loadingLabel}</span><h1>{t.loadingTitle}</h1><p>{t.loadingText}</p></div> : !program ? <div className="join-panel join-state"><span className="eyebrow"><span className="eyebrow-dot" /> {t.missingLabel}</span><h1>{t.missingTitle}</h1><p role="alert">{error}</p><Link href="/" className="button button--outline">{t.home}</Link></div> : <>
        <div className="join-hero" style={{ backgroundColor: program.brandColor || "#214739" }}><span>{t.welcome}</span><h1>{program.businessName}</h1><p>{program.locationName}</p><BrandIcon className="join-hero-symbol" /></div>
        <div className="join-panel"><span className="eyebrow"><span className="eyebrow-dot" /> {program.programName.toUpperCase()}</span><h2>{t.headline}</h2><p>{t.intro} {unit} {t.introEnd}</p>
          <div className="join-reward"><span><Icon name="spark" size={22} /></span><div><small>{t.reward}</small><strong>{program.rewardTitle}</strong><span>{t.for} {program.rewardCost} {unit}</span></div></div>
          {program.rewards?.length > 1 && <div className="join-reward-list" aria-label={locale === "fr" ? "Autres récompenses" : "Weitere Prämien"}>{program.rewards.slice(1).map(reward => <div key={reward.id}><strong>{reward.title}</strong><span>{reward.cost} {unit}</span></div>)}</div>}
          {program.programType === "points" && program.earningMode === "purchase" && <p className="join-earn-rule">{locale === "fr" ? `${program.pointsPerCurrencyUnit} points par 1 ${program.currency} dépensé. Les fractions de point sont arrondies à l’entier inférieur.` : `${program.pointsPerCurrencyUnit} Punkte pro ausgegebener 1 ${program.currency}. Bruchteile von Punkten werden abgerundet.`}</p>}
          {referralCode && <p className="join-contact-note">{program.referral?.enabled
            ? locale === "fr" ? `Lien de parrainage : après votre premier passage confirmé en caisse et la vérification des conditions, votre parrain peut recevoir ${program.referral.referrerBonus} ${unit} et vous ${program.referral.referredBonus} ${unit}. Ouvrir le lien seul ne donne aucun bonus.` : `Empfehlungslink: Erst nach deinem ersten bestätigten Kassenauftrag und Prüfung der Bedingungen kann die empfehlende Karte ${program.referral.referrerBonus} ${unit} und deine Karte ${program.referral.referredBonus} ${unit} erhalten. Das Öffnen des Links bringt keinen Bonus.`
            : locale === "fr" ? "Ce lien de parrainage est indisponible. Ouvrez le programme sans ce lien pour créer une carte ordinaire." : "Dieser Empfehlungslink ist nicht verfügbar. Öffne das Programm ohne diesen Link für eine normale Karte."}</p>}
          <div className="join-rules"><h3>{t.rules}</h3><p>{program.rulesText}</p></div>
          {program.active === false && <p className="join-inactive" role="status">{t.inactive}</p>}
          <form className="join-form" onSubmit={submit}>
            <p className="join-contact-note">{locale === "fr" ? "Votre carte est créée sans adresse e-mail. Les messages et la récupération par e-mail ne sont pas encore disponibles." : "Deine Karte wird ohne E-Mail-Adresse erstellt. Nachrichten und Wiederherstellung per E-Mail sind derzeit nicht verfügbar."}</p>
            <label className="join-checkbox"><input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} required /><span>{t.consentStart} <Link href="/teilnahmebedingungen" target="_blank">{t.terms}</Link> {t.and} <Link href="/datenschutz" target="_blank">{t.privacy}</Link>.</span></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="button button--accent button--full" disabled={busy || program.active === false}>{busy ? t.submitting : t.submit}<Icon name="arrow" size={18} /></button>
          </form>
        </div>
      </>}
    </main><footer className="join-footer">{t.footer}</footer>
  </div>;
}
