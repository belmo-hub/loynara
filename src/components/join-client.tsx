"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { signUpRules } from "@/lib/card-extras";
import { JOIN_CONSENT_TEXT_VERSION, joinConsentText } from "@/lib/wallet-message-rules";
import { DEMO_JOIN_PRIVACY, demoJoinLine } from "@/lib/demo-texts";
import { changeLines } from "@/lib/change-lines";
import { withUnit } from "@/lib/units";
import { consentLines } from "./card-wallet-messages";
import { apiJson, ClientApiError, postJson, type PublicProgram } from "./client-api";
import { CalendarClock, Gift, TriangleAlert } from "lucide-react";
import { markJoined } from "./customer/booking-moment";
import { CustomerState } from "./customer/customer-state";
import { Reveal } from "./customer/reveal";
import { Button, buttonClassName } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { CustomerShell } from "./ui/customer-shell";
import { Skeleton } from "./ui/skeleton";
import { PointsLadder } from "./ui/points-ladder";
import { StampGrid, STAMP_GRID_MAX, stampColumns } from "./ui/stamp-grid";
import { iphoneDevice, walletPlatform } from "./wallet-preparation";
import { afterJoin, iphoneJoin, markJoinAsked, markWalletStep, readWalletStep, WalletStep } from "./wallet-step";
import styles from "./customer/join.module.css";
import cardStyles from "./customer/customer-card.module.css";
import first from "./customer/first-page.module.css";

const copy = {
  de: {
    header: "DIGITALE TREUEKARTE", loadingLabel: "EIN MOMENT", loadingTitle: "Programm wird geladen.", loadingText: "Die Regeln und die Prämie werden abgerufen.", missingLabel: "NICHT VERFÜGBAR", missingTitle: "Dieses Programm ist nicht erreichbar.", home: "Zur Startseite", welcome: "Willkommen bei", headline: (points: boolean) => `Deine ${points ? "Punktekarte" : "Stempelkarte"}, direkt im Browser.`, intro: "Ohne App und ohne Konto. An der Kasse sammelst du", introEnd: "für deine nächste Prämie.", stamp: "Stempel", points: "Punkte", reward: "DEINE PRÄMIE", rewardLabel: "Deine Prämie", cardPreview: "So sieht deine Karte aus", noEmail: "Für die Karte brauchst du keine E-Mail-Adresse und kein Konto.", for: "für", rules: "So funktioniert das Programm", inactive: "Dieses Programm startet zu einem späteren Zeitpunkt. Die Anmeldung ist noch geschlossen.", email: "E-Mail-Adresse", optional: "optional", emailHint: "Für deine Karte ist keine E-Mail-Adresse nötig.", marketing: "Ich möchte künftig E-Mails mit Angeboten dieses Geschäfts erhalten. Diese Wahl ist freiwillig und unabhängig von meiner Karte.", submit: "Meine Karte erstellen", submitting: "Karte wird erstellt …", footer: "Mit Loynara, ohne zusätzliche App", readRule: "Neue Regel lesen", hideRule: "Neue Regel ausblenden", emailError: "Für Nachrichten brauchen wir eine E-Mail-Adresse.", inactiveError: "Dieses Programm ist noch nicht aktiv.", submitError: "Die Karte konnte nicht erstellt werden.", loadError: "Das Programm wurde nicht gefunden.",
    welcomeBack: "Willkommen zurück.", savedHere: "Auf diesem Gerät ist deine Karte gespeichert.", cardNumber: "Kartennummer", openCard: "Meine Karte öffnen", anotherLink: "Ich brauche eine weitere Karte", anotherTitle: "Weitere Karte erstellen?", anotherConfirm: "Ich möchte trotzdem eine zusätzliche Karte erstellen.", anotherSubmit: "Weitere Karte erstellen", backToCard: "Zurück zu meiner Karte", anotherConfirmError: "Bitte bestätige, dass du eine zusätzliche Karte möchtest.", staleNote: "Auf diesem Gerät war eine Karte gespeichert, die nicht mehr gilt, zum Beispiel weil sie geschlossen oder neu ausgestellt wurde. Hast du einen neuen Kartenlink bekommen, öffne bitte diesen.", existsError: "Auf diesem Gerät gibt es schon eine Karte für dieses Programm.", checking: "Prüfe, ob du hier schon eine Karte hast …", referralUnavailable: "Dieser Empfehlungslink ist nicht verfügbar. Du kannst ohne Empfehlungsbonus eine normale Karte erstellen.", withoutReferral: "Ohne Empfehlungslink fortfahren", unconfirmed: "Die Kartenerstellung wurde nicht bestätigt. Deine Karte kann bereits erstellt sein. Lade die Seite neu, um eine auf diesem Gerät gespeicherte Karte zu prüfen. Erstelle nicht vorschnell eine weitere Karte.",
  },
  fr: {
    header: "CARTE DE FIDÉLITÉ NUMÉRIQUE", loadingLabel: "UN INSTANT", loadingTitle: "Chargement du programme.", loadingText: "Nous récupérons les règles et la récompense.", missingLabel: "INDISPONIBLE", missingTitle: "Ce programme est inaccessible.", home: "Retour à l’accueil", welcome: "Bienvenue chez", headline: () => "Chaque visite compte.", intro: "Obtenez votre carte directement dans le navigateur. En caisse, cumulez des", introEnd: "pour votre prochaine récompense.", stamp: "tampons", points: "points", reward: "VOTRE RÉCOMPENSE", rewardLabel: "Votre récompense", cardPreview: "Aperçu de votre carte", noEmail: "Aucune adresse e-mail ni compte n’est nécessaire pour la carte.", for: "pour", rules: "Règles du programme", inactive: "Ce programme commencera plus tard. L’inscription n’est pas encore ouverte.", email: "Adresse e-mail", optional: "facultative", emailHint: "Aucune adresse e-mail n’est nécessaire pour obtenir la carte.", consentStart: "J’ai lu et j’accepte les règles du programme ci-dessus.", terms: "Autres conditions de participation", privacy: "Politique de confidentialité", marketing: "Je souhaite recevoir à l’avenir des e-mails promotionnels de ce commerce. Ce choix est facultatif et indépendant de ma carte.", submit: "Créer ma carte", submitting: "Création de la carte …", footer: "Avec Loynara, sans application supplémentaire", acceptError: "Veuillez d’abord accepter les règles du programme.", staleError: "Le commerce vient de modifier le programme. Veuillez relire les règles ci-dessus et les accepter. Votre carte n’a pas encore été créée.", readRule: "Lire la nouvelle règle", hideRule: "Masquer la nouvelle règle", emailError: "Une adresse e-mail est nécessaire pour recevoir des messages.", inactiveError: "Ce programme n’est pas encore actif.", submitError: "La carte n’a pas pu être créée.", loadError: "Programme introuvable.", and: "et",
    welcomeBack: "Bon retour.", savedHere: "Votre carte est enregistrée sur cet appareil.", cardNumber: "Numéro de carte", openCard: "Ouvrir ma carte", anotherLink: "J’ai besoin d’une autre carte", anotherTitle: "Créer une autre carte ?", anotherConfirm: "Je veux quand même créer une carte supplémentaire.", anotherSubmit: "Créer une autre carte", backToCard: "Retour à ma carte", anotherConfirmError: "Veuillez confirmer que vous voulez une carte supplémentaire.", staleNote: "Une carte enregistrée sur cet appareil n’est plus valable, par exemple parce qu’elle a été fermée ou réémise. Si vous avez reçu un nouveau lien de carte, ouvrez-le.", existsError: "Une carte pour ce programme existe déjà sur cet appareil.", checking: "Vérification d’une carte existante sur cet appareil …", referralUnavailable: "Ce lien de parrainage est indisponible. Vous pouvez créer une carte ordinaire sans bonus de parrainage.", withoutReferral: "Continuer sans lien de parrainage", unconfirmed: "La création de la carte n’est pas confirmée. Votre carte peut déjà avoir été créée. Rechargez la page pour vérifier si une carte est enregistrée sur cet appareil. Ne créez pas une autre carte dans la précipitation.",
  },
} as const;

function subscribeToLocation(notify: () => void) {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
}
function currentReferralCode() { return new URLSearchParams(window.location.search).get("ref"); }
function serverReferralCode() { return null; }
const noSubscription = () => () => {};
const serverPlatform = () => "other" as const;
const serverIphone = () => false;

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

/** A join refused as stale (W58): the rules reloaded in place (when the reload worked), the consent cleared, the rules
 *  marked and the error shown. Nothing else on the page changes. */
export function staleJoin(program: PublicProgram, fresh: PublicProgram | null, message: string) {
  return { program: fresh ?? program, acceptedTerms: false, stale: true, error: message };
}

const PRIVACY_LINK = "Mehr in den Datenschutzhinweisen.";
const CONSENT_CHANGED = "Der Text zum Häkchen hat sich geändert. Bitte lade die Seite neu und lies ihn. Das Häkchen ist freiwillig; deine Karte bekommst du auch ohne.";
/** ENG-173: the Wallet-message box shows on an iPhone (not a touch iPad) where a pass can follow, while the walletMessages surface is on and the programme is open. */
export const joinOffersMessages = (iphone: boolean, program: Pick<PublicProgram, "active" | "appleWallet" | "locale" | "walletMessages">) => iphone && iphoneJoin("ios", program) && program.walletMessages === true && program.active !== false;
/** What the join sends for that box: only a shown, ticked box sends the version of the text it showed. */
export const joinConsent = (offered: boolean, ticked: boolean, version = JOIN_CONSENT_TEXT_VERSION) => offered && ticked ? { walletConsentVersion: version } : {};
/** W58 on German pages names the button, whose next tap accepts the reloaded rules (Legal, 6 Nov); French pages tick again. */
export const staleLine = (locale: "de" | "fr", button: string) => locale === "fr" ? copy.fr.staleError : `Das Geschäft hat das Programm gerade geändert. Bitte lies die Regeln oben noch einmal. Mit „${button}“ akzeptierst du sie. Deine Karte ist noch nicht erstellt.`;
/** ENG-173: only French pages keep the terms tick; German pages accept by the notice above the button (Legal, 6 Nov). */
/** ENG-205 (Design's spec 1.2): after the server's answer the form fades and the card presses; the Wallet step arrives
 *  220 ms later, the card page after a 400 ms hold, in whose last 160 ms the card and the footer fade out. Reduced
 *  motion: the Wallet step at once; the card page after the same hold, without fades, so the status line is heard
 *  before the page changes. */
export const FIRST_TAP_FADE_MS = 160;
export const firstTapHold = (step: boolean, still: boolean) => step ? (still ? 0 : 220) : 400;
/** ENG-205: the new first page shows for German programmes while the flag is on; French keeps today's page (no French copy). */
/** ENG-205: the placeholder's card is as tall as the card it stands for, so nothing moves when it fades (padding 16, 32 px places 12 apart, 12, a 20 px footer, 16). */
export function firstCardHeight(program?: Pick<PublicProgram, "programType" | "rewardCost">) {
  if (program?.programType === "points" || (program && program.rewardCost > STAMP_GRID_MAX)) return 120;
  const rows = program ? Math.ceil(program.rewardCost / stampColumns(program.rewardCost)) : 2;
  return 16 + rows * 32 + (rows - 1) * 12 + 12 + 20 + 16;
}
export const firstPage = (flag: boolean, locale: "de" | "fr") => flag && locale === "de";
export const joinNeedsTick = (locale: "de" | "fr", accepted: boolean) => locale === "fr" && !accepted;

export function JoinClient({ slug, firstTap = false }: { slug: string; firstTap?: boolean }) {
  const router = useRouter();
  const [program, setProgram] = useState<PublicProgram | null>(null);
  const [loading, setLoading] = useState(true);
  const [returning, setReturning] = useState<Returning>({ state: "checking" });
  const [wantsAnother, setWantsAnother] = useState(false);
  const [confirmAnother, setConfirmAnother] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [messagesTicked, setMessagesTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // ENG-173: the line stands by what it asks for: under the rules after a stale join, under the tick it wants.
  const [errorSpot, setErrorSpot] = useState<"form" | "rules" | "confirm">("form");
  const [referralUnavailable, setReferralUnavailable] = useState(false);
  // ENG-100: the full new rule opens in place, above the checkbox (W58); a stale join marks the rules it reloaded.
  const [showRule, setShowRule] = useState(false), [stale, setStale] = useState(false);
  const referralCode = useSyncExternalStore(subscribeToLocation, currentReferralCode, serverReferralCode);
  const platform = useSyncExternalStore(noSubscription, walletPlatform, serverPlatform);
  const onIphone = useSyncExternalStore(noSubscription, iphoneDevice, serverIphone);
  // ENG-130: the card made here, while the Wallet step shows instead of the join form.
  const [walletStep, setWalletStep] = useState<string | null>(null);
  // ENG-205: the server has created the card: the form is leaving and the card presses once.
  const [created, setCreated] = useState(false);
  // The last 160 ms before the card page: the card and the footer fade out, so the page changes over the bare ground.
  const [leavingPage, setLeavingPage] = useState(false);
  // The placeholder lies over the loaded page for its fade (Skeleton to content), then it is taken away.
  const [covered, setCovered] = useState(true);
  useEffect(() => { if (loading) return; const timer = setTimeout(() => setCovered(false), 400); return () => clearTimeout(timer); }, [loading]);
  const locale = program?.locale === "fr" ? "fr" : "de";
  const t = copy[locale];
  const unit = program?.programType === "points" ? t.points : t.stamp;
  const existing = returning.state === "existing" ? returning : null;
  const openHref = `/api/enroll/open?slug=${encodeURIComponent(slug)}`;
  const newPage = firstPage(firstTap, locale);
  // The new layout stands for the plain join; the returning, stale, another-card, closed and demo cases keep their panels.
  const plain = newPage && !existing && returning.state !== "stale" && program?.active !== false && !program?.demo;
  // The Wallet step arrived under the card: its heading takes the focus.
  useEffect(() => { if (newPage && walletStep) { const title = document.getElementById("wallet-step-title"); if (title) { title.tabIndex = -1; title.focus(); } } }, [newPage, walletStep]);

  useEffect(() => {
    let mounted = true;
    void apiJson<PublicProgram>(`/api/program/${encodeURIComponent(slug)}`).then(result => {
      if (mounted) { setProgram(result); setLoading(false); }
    }).catch(cause => {
      // Never the server's text (G-02); without a programme the page is German.
      if (mounted) { setError(cause instanceof ClientApiError && cause.status === 404 ? "Der Link ist veraltet oder falsch. Frag im Geschäft nach dem aktuellen QR-Code." : "Das Programm konnte gerade nicht geladen werden. Versuche es gleich noch einmal."); setLoading(false); }
    });
    void checkReturning(slug).then(result => { if (mounted) setReturning(result); });
    return () => { mounted = false; };
  }, [slug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setErrorSpot("form"); setReferralUnavailable(false);
    if (joinNeedsTick(locale, acceptedTerms)) { setError(copy.fr.acceptError); document.getElementById("join-consent")?.focus(); return; }
    if ((existing || returning.state === "stale") && !confirmAnother) { setError(t.anotherConfirmError); setErrorSpot("confirm"); document.getElementById("join-confirm")?.focus(); return; }
    setBusy(true);
    // On the way to the card the button stays busy, so the page does not fall back to its idle state before it goes.
    let leaving = false;
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
        // The rule and reward versions this page showed: a change saved since then refuses the join as stale (ENG-100).
        return postJson<{ cardToken: string; cardLocator: string }>("/api/enroll", { slug, acceptedTerms: true, ruleVersionId: program?.ruleVersionId, rewardVersionIds: program?.rewardVersionIds, ...(referralCode ? { referralCode } : {}), ...((existing || returning.state === "stale") ? { additionalCard: true } : {}), ...joinConsent(program !== null && joinOffersMessages(onIphone, program), messagesTicked, program?.demo?.consentVersion) });
      };
      const result = navigator.locks ? await navigator.locks.request(`loynara-join:${slug}`, create) : await create();
      if (!result) return;
      const continuation = sessionStorage.getItem("loynara_tap_return");
      sessionStorage.removeItem("loynara_tap_return");
      const next = afterJoin({ continuation, offer: program !== null && iphoneJoin(platform, program), mark: readWalletStep(result.cardLocator) });
      if (next.mark) markWalletStep(result.cardLocator, next.mark);
      if (program && joinOffersMessages(onIphone, program)) markJoinAsked(result.cardLocator);
      if (plain && next.go !== "tap") {
        // Nothing is drawn before this point: the card exists. A tap return goes on at once, without this.
        const cardHref = `/card/${encodeURIComponent(result.cardToken)}`;
        setCreated(true);
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches, hold = firstTapHold(next.go === "step", still);
        if (next.go !== "step") { router.prefetch(cardHref); if (!still) setTimeout(() => setLeavingPage(true), hold - FIRST_TAP_FADE_MS); }
        await new Promise(done => setTimeout(done, hold));
        leaving = next.go !== "step";
        // The card page opens as a return after this page: it celebrates nothing a second time.
        markJoined();
        if (next.go === "step") setWalletStep(result.cardToken); else router.replace(cardHref);
        return;
      }
      leaving = next.go !== "step";
      if (next.go === "tap") router.push(continuation!);
      else if (next.go === "step") setWalletStep(result.cardToken);
      else router.push(`/card/${encodeURIComponent(result.cardToken)}`);
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.code === "CARD_EXISTS") {
        // The server knows a valid card for this browser that the page did not (failed or outdated check): offer it.
        const found = await checkReturning(slug);
        setReturning(found); setWantsAnother(false); setConfirmAnother(false);
        setError(found.state === "existing" ? "" : t.existsError);
      } else if (cause instanceof ClientApiError && cause.code === "STALE_RULE") {
        // The shop changed the programme while the page was open (W58): the rules reload in place, to be read and accepted again.
        const next = staleJoin(program!, await apiJson<PublicProgram>(`/api/program/${encodeURIComponent(slug)}`).catch(() => null), staleLine(locale, existing ? t.anotherSubmit : t.submit));
        setProgram(next.program); setAcceptedTerms(next.acceptedTerms); setStale(next.stale); setError(next.error);
        // The line says to read the rules, which the message box can push a screen away: rules and line come into view together.
        if (locale !== "fr") { setErrorSpot("rules"); document.getElementById("join-rules")?.scrollIntoView({ block: "start" }); }
      } else if (cause instanceof ClientApiError && cause.code === "INVALID_REFERRAL") {
        setReferralUnavailable(true); setError(t.referralUnavailable);
      } else if (cause instanceof ClientApiError && (cause.status === 0 || (cause.status >= 200 && cause.status < 300))) {
        setError(t.unconfirmed);
      } else if (cause instanceof ClientApiError && cause.code === "CONSENT_TEXT_CHANGED") {
        setError(CONSENT_CHANGED);
      } else setError(t.submitError);
    }
    finally { if (!leaving) setBusy(false); }
  }

  const rewardLine = program && <p className={`join-reward ${styles.reward}`}><Gift size={18} aria-hidden="true" /><span><small>{t.rewardLabel}</small><strong>{program.rewardTitle}</strong> {t.for} {withUnit(program.rewardCost, program.programType, locale)}</span></p>;
  const cardNumber = existing && <p className={`join-card-number ${styles.cardNumber}`}><span>{t.cardNumber}</span><strong>{existing.cardLocator}</strong></p>;

  // ENG-205: a placeholder shaped like the shop row and the card. Once the programme is here it lies over the page and fades.
  const placeholder = <div className={first.placeholder}>
    <div className={first.shop}><Skeleton width={48} height={48} radius="var(--radius-md)" /><div><Skeleton width="60%" height={25} /><Skeleton width="40%" height={21} /></div></div>
    <Skeleton height={firstCardHeight(program ?? undefined)} radius="var(--radius-xl)" />
  </div>;
  const cover = newPage && covered ? { main: placeholder } : undefined;
  if (loading && firstTap) return <CustomerShell locale="de"><div aria-busy="true"><span className={first.wait} role="status">{t.loadingTitle}</span>{placeholder}</div></CustomerShell>;
  if (loading) return <CustomerState loading title={t.loadingTitle} message={t.loadingText} locale={locale} />;
  if (!program) return <CustomerState title={t.missingTitle} message={error} tone="error" locale={locale} focusTitle><Link className={buttonClassName({ variant: "secondary", block: true })} href="/recover">Karte wiederfinden</Link></CustomerState>;
  // ENG-205 blocks 1 and 2: the shop on the page ground, then the card as the only object. No stamp is drawn that does not exist.
  const top = newPage && <div className={first.top} data-leaving={leavingPage || undefined}>
    <div className={first.shop}>
      <span className={first.tile} aria-hidden="true">{Array.from(program.businessName)[0]}</span>
      <div><h1 className={first.name}>{program.businessName}</h1><p className={first.location}>{program.locationName}</p></div>
    </div>
    <section className={`join-hero ${first.card}`} aria-label={t.cardPreview} data-created={created || undefined}>
      {program.programType === "points"
        ? <PointsLadder balance={0} rewards={(program.rewards?.length ? program.rewards : [{ title: program.rewardTitle, cost: program.rewardCost }]).map(item => ({ title: item.title, cost: item.cost }))} locale="de" />
        : <StampGrid earned={0} total={program.rewardCost} locale="de" size="sm" reward={<Gift size={16} />} className={first.stamps} />}
      <p className={`join-reward ${first.foot}`}><Gift size={18} aria-hidden="true" /><span><strong>{program.rewardTitle}</strong> {t.for} {withUnit(program.rewardCost, program.programType, "de")}</span></p>
    </section>
  </div>;
  // One status line for the page, outside the blocks that fade: it speaks when the server has created the card.
  // wording: Design's placeholder, Marketing confirms
  const createdLine = newPage && <p className={first.wait} role="status">{created ? "Deine Karte ist erstellt." : ""}</p>;
  if (walletStep && newPage) return <CustomerShell brandColor={program.brandColor} locale="de">{top}{createdLine}<div className={first.step}><WalletStep token={walletStep} program={program} heading="h2" /></div></CustomerShell>;
  if (walletStep) return <CustomerShell brandColor={program.brandColor} locale="de" header={<div className={styles.merchant}><span className={styles.mono} aria-hidden="true">{Array.from(program.businessName)[0]}</span><p><strong>{program.businessName}</strong><span>Deine Treuekarte</span></p></div>}>
    <WalletStep token={walletStep} program={program} />
  </CustomerShell>;
  const iphone = iphoneJoin(platform, program);
  const errorLine = (spot: typeof errorSpot) => error && errorSpot === spot ? <p id="join-error" className={styles.error} role="alert"><TriangleAlert size={16} aria-hidden="true" />{error}</p> : null;
  // German pages accept by the notice; a closed programme's button is disabled, so nothing can be accepted there.
  const notice = locale !== "fr" && program.active !== false;

  const referralLines = <>
    {referralCode && <p className={styles.note}>{program.referral?.enabled && !referralUnavailable
      ? locale === "fr" ? `Lien de parrainage : après votre premier passage confirmé en caisse et la vérification des conditions, votre parrain peut recevoir ${withUnit(program.referral.referrerBonus, program.programType, locale)} et vous ${withUnit(program.referral.referredBonus, program.programType, locale)}. Ouvrir le lien seul ne donne aucun bonus.` : `Empfehlungslink: Erst nach deinem ersten bestätigten Kassenauftrag und Prüfung der Bedingungen kann die empfehlende Karte ${withUnit(program.referral.referrerBonus, program.programType, locale)} und deine Karte ${withUnit(program.referral.referredBonus, program.programType, locale)} erhalten. Das Öffnen des Links bringt keinen Bonus.`
      : locale === "fr" ? "Ce lien de parrainage est indisponible. Ouvrez le programme sans ce lien pour créer une carte ordinaire." : "Dieser Empfehlungslink ist nicht verfügbar. Öffne das Programm ohne diesen Link für eine normale Karte."}</p>}
    {referralCode && (referralUnavailable || program.referral?.enabled === false) && <p className={styles.link}><a href={`/join/${encodeURIComponent(slug)}`}>{t.withoutReferral}</a></p>}
  </>;
  const rulesBlock = <>
    {/* The rules the guest accepts (German pages: the notice above the button; French: the checkbox): by purchase amount the earning sentence opens them (server), and the fixed
        exclusions stand on the page itself, not only behind the terms link (Legal). */}
    <div id="join-rules" className={styles.rules} data-stale={stale || undefined}>{plain ? <h2>{t.rules}</h2> : <h3>{t.rules}</h3>}{(() => {
      // ENG-100 (W58): reward lines first, the rule's line after the rule, the expiry's after the expiry rule.
      const waiting = changeLines(program), change = (text: string, extra?: React.ReactNode) => <p className={styles.change}><CalendarClock size={18} aria-hidden="true" /><span>{text}{extra}</span></p>;
      const expiryLine = waiting.expiry && change(waiting.expiry);
      return <>
        {waiting.rewards.map(line => <Fragment key={line}>{change(line)}</Fragment>)}
        {signUpRules(program).map((line, index) => <Fragment key={index}>
          <p>{line}</p>
          {index === 0 && waiting.rule && change(waiting.rule.text, waiting.rule.link && <> <button type="button" className={styles.ruleToggle} aria-expanded={showRule} aria-controls="join-new-rule" onClick={() => setShowRule(!showRule)}>{showRule ? t.hideRule : t.readRule}</button></>)}
          {index === 0 && waiting.rule?.link && showRule && <p id="join-new-rule" className={styles.newRule}>{waiting.newRule?.text}</p>}
          {(index === 0 ? !program.pointsExpiryRule : line === program.pointsExpiryRule) && expiryLine}
        </Fragment>)}
      </>;
    })()}</div>
  </>;
  const messagesBox = joinOffersMessages(onIphone, program) && <div className={styles.messages}>
    {/* A demo names Loynara as the sender (Legal): no heading that names the shop, the demo wording as the server sent it. */}
    {!program.demo && <h3>{`Darf dir ${program.businessName} Nachrichten auf deine Karte schicken?`}</h3>}
    {program.demo ? <Checkbox checked={messagesTicked} disabled={plain && busy} onChange={e => setMessagesTicked(e.target.checked)}>{program.demo.consentText}</Checkbox>
      : <Checkbox checked={messagesTicked} disabled={plain && busy} onChange={e => setMessagesTicked(e.target.checked)}>{joinConsentText(program.businessName, program.locationName).replace(PRIVACY_LINK, "")}<Link href="/datenschutz" target="_blank">{PRIVACY_LINK}</Link></Checkbox>}
    <p className={styles.muted}>{consentLines(program.programType === "points" && Boolean(program.pointsExpiryRule || program.pendingExpiry)).under}</p>
  </div>;
  const noticeLine = <>
    {notice && program.demo && <p id="join-notice" className={styles.notice}>{demoJoinLine(existing ? t.anotherSubmit : t.submit).replace(`${DEMO_JOIN_PRIVACY}.`, "")}<Link href="/datenschutz" target="_blank">{DEMO_JOIN_PRIVACY}</Link>.</p>}
    {notice && !program.demo && <p id="join-notice" className={styles.notice}>Mit „{existing ? t.anotherSubmit : t.submit}“ akzeptierst du die Programmregeln oben und die <Link href="/teilnahmebedingungen" target="_blank">Teilnahmebedingungen</Link>. Mehr in den <Link href="/datenschutz" target="_blank">Datenschutzhinweisen</Link>.</p>}
  </>;
  const preview = <section className={`join-hero ${styles.hero}`} aria-label={t.cardPreview}>
    <p className={styles.welcome}>{t.welcome}</p>
    <h1 className={styles.business}>{program.businessName}</h1>
    <p className={styles.location}>{program.locationName}</p>
    {program.programType === "points"
      ? <PointsLadder balance={0} rewards={(program.rewards?.length ? program.rewards : [{ title: program.rewardTitle, cost: program.rewardCost }]).map(item => ({ title: item.title, cost: item.cost }))} locale={locale} titles />
      : <StampGrid earned={0} total={program.rewardCost} locale={locale} size="sm" reward={<Gift size={18} />} className={styles.stamps} />}
    {rewardLine}
  </section>;

  if (plain) return <CustomerShell brandColor={program.brandColor} locale="de" footer={<p className={`${styles.footer} ${first.foot2}`} data-leaving={created || undefined}>{t.footer}</p>} cover={cover}>
    {top}
    {createdLine}
    <div className={first.blocks} data-leaving={created || undefined}>
      {iphone && <ol className={styles.steps}>
        <li><span aria-hidden="true">1</span><p><strong>Karte erstellen</strong>Ohne App und ohne Konto</p></li>
        <li><span aria-hidden="true">2</span><p><strong>In Apple Wallet legen</strong>Dann ist sie bei deinen Karten</p></li>
      </ol>}
      {program.rewards?.length > 1 && <ul className={styles.rewardList} aria-label="Weitere Prämien">{program.rewards.slice(1).map(item => <li key={item.id}><strong>{item.title}</strong><span>{withUnit(item.cost, program.programType, "de")}</span></li>)}</ul>}
      <div className={first.rules}>{rulesBlock}{referralLines}</div>
      {errorLine("rules")}
      <form className={first.form} onSubmit={submit} noValidate>
        <div className={first.terms}>{noticeLine}</div>
        {errorLine("form")}
        {/* Enabled while the returning check runs: the tap looks again itself, and the server refuses a silent second card. */}
        <Button type="submit" size="lg" block loading={busy} aria-describedby={notice ? "join-notice" : undefined}>{busy ? t.submitting : t.submit}</Button>
        {messagesBox && <div className={first.tick}>{messagesBox}</div>}
        <p className={styles.muted}>{t.noEmail}</p>
        {/* Below the button: when the check resolves, nothing under the thumb moves. */}
        <Reveal open={returning.state === "checking"} gap="var(--space-4)"><p className={styles.muted}>{t.checking}</p></Reveal>
      </form>
      <p className={`${styles.link} ${first.recover}`}><span className={styles.muted}>Du hast schon eine Karte?</span> <Link href="/recover">Karte wiederfinden</Link></p>
    </div>
  </CustomerShell>;

  return <CustomerShell brandColor={program.brandColor} locale={locale} footer={<p className={styles.footer}>{t.footer}</p>} cover={cover}>
    {top || preview}
    {/* Keyed: a panel that takes another's place arrives, instead of changing under the guest. */}
    {returning.state === "stale" && !wantsAnother ? <section key="stale" className={styles.panel}>
      <h2 className={styles.title}>{locale === "fr" ? "Retrouver votre carte" : "Deine Karte wiederfinden"}</h2>
      <p className={styles.muted}>{t.staleNote}</p>
      <p className={styles.muted}>{locale === "fr" ? "Ouvrez votre lien privé actuel. Le numéro de carte seul ne prouve pas que la carte vous appartient." : "Öffne deinen aktuellen privaten Kartenlink. Die Kartennummer allein ist kein Eigentumsnachweis."}</p>
      <Link className={buttonClassName({ block: true })} href="/recover">{locale === "fr" ? "Récupération sécurisée" : "Karte wiederfinden"}</Link>
      <Button variant="quiet" onClick={() => setWantsAnother(true)}>{t.anotherLink}</Button>
    </section> : existing && !wantsAnother ? <section key="returning" className={`join-returning ${styles.panel}`}>
      <h2 className={styles.title}>{t.welcomeBack}</h2>
      <p className={styles.muted}>{t.savedHere}</p>
      {cardNumber}
      <a className={buttonClassName({ size: "lg", block: true })} href={openHref}>{t.openCard}</a>
      <Button variant="quiet" className="join-another-link" onClick={() => { setWantsAnother(true); setError(""); }}>{t.anotherLink}</Button>
    </section> : <section key="join" className={styles.panel}>
      {existing ? <>
        <h2 className={styles.title}>{t.anotherTitle}</h2>
        <p className={`join-another-warning ${styles.warning}`} role="note">{locale === "fr" ? `Une nouvelle carte commence à ${withUnit(0, program.programType, locale)}. Vos ${unit} actuels restent sur la carte ${existing.cardLocator} et ne sont pas transférés.` : `Eine weitere Karte startet bei ${withUnit(0, program.programType, locale, "dat")}. Deine bisherigen ${unit} bleiben auf Karte ${existing.cardLocator} und werden nicht übertragen.`}</p>
        <a className={buttonClassName({ variant: "secondary", block: true })} href={openHref}>{t.backToCard}</a>
      </> : iphone ? <>
        <h2 className={styles.headline}>Deine {program.programType === "points" ? "Punktekarte" : "Stempelkarte"}, direkt auf dem iPhone.</h2>
        <ol className={styles.steps}>
          <li><span aria-hidden="true">1</span><p><strong>Karte erstellen</strong>Ohne App und ohne Konto</p></li>
          <li><span aria-hidden="true">2</span><p><strong>In Apple Wallet legen</strong>Dann ist sie bei deinen Karten</p></li>
        </ol>
      </> : <>
        <h2 className={styles.headline}>{t.headline(program.programType === "points")}</h2>
        <p className={styles.lead}>{t.intro} {unit} {t.introEnd}</p>
      </>}
      {returning.state === "stale" && <p className={styles.muted} role="status">{t.staleNote}</p>}
      {program.rewards?.length > 1 && <ul className={styles.rewardList} aria-label={locale === "fr" ? "Autres récompenses" : "Weitere Prämien"}>{program.rewards.slice(1).map(item => <li key={item.id}><strong>{item.title}</strong><span>{withUnit(item.cost, program.programType, locale)}</span></li>)}</ul>}
      {referralLines}
      {rulesBlock}
      {errorLine("rules")}
      {program.active === false && <p className={styles.warning} role="status">{t.inactive}</p>}
      <form className={styles.form} onSubmit={submit} noValidate>
        {locale === "fr" && <Checkbox id="join-consent" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} required aria-invalid={error === copy.fr.acceptError || undefined} aria-describedby={error === copy.fr.acceptError ? "join-error" : undefined}>{copy.fr.consentStart} <Link href="/teilnahmebedingungen" target="_blank">{copy.fr.terms}</Link> {copy.fr.and} <Link href="/datenschutz" target="_blank">{copy.fr.privacy}</Link>.</Checkbox>}
        {(existing || returning.state === "stale") && <Checkbox id="join-confirm" checked={confirmAnother} onChange={e => setConfirmAnother(e.target.checked)} aria-invalid={errorSpot === "confirm" && error ? true : undefined} aria-describedby={errorSpot === "confirm" && error ? "join-error" : undefined}>{t.anotherConfirm}</Checkbox>}
        {errorLine("confirm")}
        {messagesBox}
        {errorLine("form")}
        {returning.state === "checking" && <p className={styles.muted} role="status">{t.checking}</p>}
        {/* The same tinted panel as the notice on the card. */}
        {program.demo && <div className={cardStyles.ending}><p>{program.demo.notice}</p></div>}
        {/* A demo card accepts no terms (Legal): the demo line and its privacy notice instead. */}
        {noticeLine}
        <Button type="submit" variant={existing ? "secondary" : "primary"} size="lg" block loading={busy} aria-describedby={notice ? "join-notice" : undefined} disabled={program.active === false || returning.state === "checking"}>{busy ? t.submitting : existing ? t.anotherSubmit : t.submit}</Button>
        <p className={styles.muted}>{t.noEmail}</p>
      </form>
      <p className={styles.link}>{locale === "fr" ? <Link href="/recover">Vous avez déjà une carte ? Récupération sécurisée</Link> : <><span className={styles.muted}>Du hast schon eine Karte?</span> <Link href="/recover">Karte wiederfinden</Link></>}</p>
    </section>}
  </CustomerShell>;
}
