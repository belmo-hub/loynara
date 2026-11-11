"use client";

import { CreditCard } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { apiJson, ClientApiError, postJson, type CardResponse, type ReferralShare } from "./client-api";
import { type CardRead, type CardReadOutcome, createAutoRefresh, createRefreshGate } from "@/lib/refresh-gate";
import { CustomerCard, CustomerCardLoading, CustomerCardReturning } from "./customer/customer-card";
import { keepShare, laterMark, markSeen, MOMENT_LAND_MS, MOMENT_PILL_MS, MOMENT_STEP_MS, momentFor, readSeen, referralHoldFor, referralPlace, type ReferralHold } from "./customer/booking-moment";
import { CustomerState } from "./customer/customer-state";
import { CardContact } from "./card-contact";
import { EmailOffer, EmailSheet, emailRow, useEmailStatus } from "./card-email";
import { CardReferral } from "./card-referral";
import { CardBirthday } from "./card-birthday";
import { CardWalletMessages } from "./card-wallet-messages";
import { Reveal } from "./customer/reveal";
import { Button, buttonClassName } from "./ui/button";
import noticeStyles from "./customer/customer-notice.module.css";
import { peekJoined, takeJoined } from "./customer/booking-moment";
import { prepareAppleWallet, readWalletStatus, walletMessage, walletPlatform, type WalletStatus } from "./wallet-preparation";
import { joinAsked, markWalletStep, readWalletStep } from "./wallet-step";
import { cardChanges } from "@/lib/change-lines";

const never = () => () => {};
/** A return shows the bare ground this long; a read slower than that gets the placeholder. */
export const RETURN_WAIT_MS = 300;

type WalletAvailability = { apple: "available" | "unavailable"; google: "available" | "test_only" | "unavailable"; appleReAdd?: boolean; appleSaved?: boolean };

/** Never re-read the card more often than this when the guest comes back to the page. */
const REFRESH_INTERVAL_MS = 5_000;
const noticeClass = noticeStyles.notice;
const GONE_MESSAGE = "Dieser Kartenlink ist nicht mehr gültig. Wurde deine Karte neu ausgestellt, öffne bitte den neuen Link. Sonst wende dich mit deiner Kartennummer an das Geschäft.";

function cardError(cause: unknown) {
  if (cause instanceof ClientApiError && cause.status === 404) return GONE_MESSAGE;
  return cause instanceof Error ? cause.message : "Karte nicht gefunden.";
}

// A tap that found no card binding stored its path in this tab; once the card has bound this browser, continue it.
function continueTap() {
  const path = sessionStorage.getItem("loynara_tap_return");
  if (!path || !/^\/tap\/[A-Za-z0-9_-]{24}\?e=[a-fA-F0-9]{32}&c=[a-fA-F0-9]{16}$/.test(path)) return;
  sessionStorage.removeItem("loynara_tap_return");
  window.location.assign(path);
}

/** ENG-130 (08): the panel moves under the card while a device holds the pass and this device has not yet shown it there. */
export const savedViewDue = (cardLocator: string, status: Pick<WalletStatus, "appleSaved">) => status.appleSaved === true && readWalletStep(cardLocator) !== "saved" && !joinAsked(cardLocator);
/** „In Apple Wallet gespeichert“ shows on the first card view after the pass registers, once per card on this device, with its
 *  own flag: it hides on later visits even while the panel still waits for walletMessages (Design, 30 Oct). */
export function savedLineDue(cardLocator: string, status: Pick<WalletStatus, "appleSaved">) {
  if (status.appleSaved !== true) return false;
  const key = `loynara_wallet_saved_line:${cardLocator}`;
  try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, "1"); } catch { /* blocked storage: the line may repeat */ }
  return true;
}
/** The „saved“ mark is left only once the moved-up panel has rendered (CTO, 30 Oct): with walletMessages off, it still comes after the switch. */
export function savedPanelShown(cardLocator: string, savedView: boolean, panelShown: boolean) {
  if (!savedView || !panelShown) return false;
  markWalletStep(cardLocator, "saved");
  return true;
}
/** F-2: older versions named these flags after the private card link, the whole credential. Move every entry that
 *  contains it to the card number (a flag already set there wins), so no step shows again, and drop the old one. */
export function moveTokenFlags(token: string, cardLocator: string) {
  try {
    const old = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => key?.includes(token) === true);
    for (const key of old) {
      const value = localStorage.getItem(key), moved = key.replace(token, cardLocator);
      if (value !== null && localStorage.getItem(moved) === null) localStorage.setItem(moved, value);
      localStorage.removeItem(key);
    }
  } catch { /* blocked storage: nothing was kept there */ }
}

export function CardClient({ token }: { token: string }) {
  const [card, setCard] = useState<CardResponse | null>(null);
  const [switchRequired, setSwitchRequired] = useState(false);
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  // The words stay while the notice closes; `shown` opens and closes it.
  const [bindingError, setBindingError] = useState({ text: "", shown: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [walletScope, setWalletScope] = useState<{ token: string; availability: WalletAvailability } | null>(null);
  const wallet = walletScope?.token === token ? walletScope.availability : null;
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [walletBusy, setWalletBusy] = useState<"apple" | "google" | null>(null);
  const [walletError, setWalletError] = useState("");
  const walletOperation = useRef<AbortController | null>(null);
  const downloadReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  // ENG-130 (08): the first card view after a device registered the pass, once per card on this device; the consent panel then sits under the card.
  const [savedView, setSavedView] = useState(false);
  const [consentUp, setConsentUp] = useState(false);
  const [savedLine, setSavedLine] = useState(false);
  // ENG-165: the e-mail offer shows once per card view and stays (as the pending panel) after sending; the Wallet panel has the slot first.
  const email = useEmailStatus(token);
  const [offerKept, setOfferKept] = useState(false);
  const [offerClosed, setOfferClosed] = useState(false);
  const offerShown = !offerClosed && (offerKept || email.status?.offer === true);
  const cardLocator = card?.cardLocator;
  useEffect(() => { if (cardLocator) moveTokenFlags(token, cardLocator); }, [token, cardLocator]);
  useEffect(() => { if (cardLocator) savedPanelShown(cardLocator, savedView, consentUp); }, [cardLocator, savedView, consentUp]);
  // The booking moment: a booking this device has not shown yet (made while the card was open, or found when it is
  // opened) shows the pill, and the card steps from the balance last seen to the new one, so the new stamps land.
  // ENG-205: this card was created on the join page a moment ago; its first read here is a return.
  const [returned, setReturned] = useState(false);
  // Before that read answers: the bare ground instead of the placeholder; after 300 ms of waiting the placeholder
  // fades in after all. The server never knows about a return, so it renders the placeholder.
  const pendingReturn = useSyncExternalStore(never, () => peekJoined(), () => false);
  const [waited, setWaited] = useState(false);
  useEffect(() => { if (!(pendingReturn && loading)) return; const timer = setTimeout(() => setWaited(true), RETURN_WAIT_MS); return () => clearTimeout(timer); }, [pendingReturn, loading]);
  const [moment, setMoment] = useState<{ credited: number; stepped: boolean } | null>(null);
  const momentTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playMoment = useCallback((credited: number) => {
    const timers = momentTimers.current;
    timers.splice(0).forEach(clearTimeout);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setMoment({ credited, stepped: still });
    // ENG-206: as the stamp lands, one short buzz where the browser has it (Chrome on Android; no iPhone browser does)
    // and the guest has touched the page (Chrome refuses it before). Never under reduced motion.
    if (!still) timers.push(setTimeout(() => { setMoment(current => current && { ...current, stepped: true }); if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(10); }, MOMENT_STEP_MS));
    timers.push(setTimeout(() => setMoment(null), MOMENT_PILL_MS));
  }, []);
  useEffect(() => { const timers = momentTimers.current; return () => timers.forEach(clearTimeout); }, []);
  // ENG-206: „Karte empfehlen“ becomes due with the second team-confirmed booking, and the card read brings its content.
  // Only when the read after exactly that booking also plays a moment is the block held shut until the stamp has landed
  // (900 ms, with the reward band if there is one) and then opened; under reduced motion it is there at once. On every
  // later visit it stands in the card's first paint.
  const referralDue = card?.stampMoment?.referralDue === true;
  const [referralHold, setReferralHold] = useState<ReferralHold>("none");
  const [referralWasDue, setReferralWasDue] = useState(false);
  // ENG-218: the block became due on a timed re-read, which brings no share; it mounts shut and asks for it itself.
  const [shareAwaited, setShareAwaited] = useState(false);
  if (referralDue && !referralWasDue) { setReferralWasDue(true); setReferralHold(referralHoldFor(card?.stampMoment, moment, shareAwaited)); }
  // One clock with the band: the landing counts from the step itself.
  const stepped = moment?.stepped === true;
  useEffect(() => {
    if (referralHold !== "held" || !stepped) return;
    const timer = setTimeout(() => setReferralHold("released"), MOMENT_LAND_MS);
    return () => clearTimeout(timer);
  }, [referralHold, stepped]);
  // ENG-218: timed re-reads bring no share. The card keeps the one an untimed read brought; a read the guest caused
  // that is due and has none means there is nothing to share (referrals off). Only when a timed re-read finds the block
  // newly due (the second booking arrived while the card was open) does the block ask for the share itself, once.
  const shareHeld = useRef<ReferralShare | undefined>(undefined), shareOff = useRef(false);
  const noteShare = useCallback((read: CardResponse, timed: boolean) => {
    if (read.stampMoment?.referral) shareHeld.current = read.stampMoment.referral;
    else if (!timed && read.stampMoment?.referralDue) shareOff.current = true;
    return keepShare(read, shareHeld.current);
  }, []);
  const balanceSeen = useRef<number | null>(null);
  // The newest entry any read has brought: bookings up to it are shown or were never a moment.
  const newestShown = useRef<string | null>(null);
  const [closeError, setCloseError] = useState("");
  const [closed, setClosed] = useState(false);
  const gate = useRef(createRefreshGate(REFRESH_INTERVAL_MS));
  const live = useRef(false);
  const refreshNow = useRef<() => void>(() => {});
  const startAutoRefresh = useRef<() => void>(() => {});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    void apiJson<CardResponse>(`/api/enroll/card/${encodeURIComponent(token)}`).then(result => { if (mounted) { const back = takeJoined(); if (back) setReturned(true); const unseen = momentFor(result, { balance: null, seenAt: back ? new Date().toISOString() : readSeen(result.cardLocator) }, Date.now()); balanceSeen.current = result.balance; newestShown.current = unseen.newest; if (unseen.newest) markSeen(result.cardLocator, unseen.newest); if (unseen.credited > 0) playMoment(unseen.credited); setCard(noteShare(result, false)); setRefreshFailed(false); setLoading(false); live.current = true; gate.current.markLoaded(); startAutoRefresh.current(); } void apiJson(`/api/tap/card/${encodeURIComponent(token)}/session`, { method: "POST" }).then(() => { if (mounted) setSwitchRequired(false); continueTap(); }).catch(cause => { if (mounted) { if (cause instanceof ClientApiError && cause.code === "ACCOUNT_SWITCH_REQUIRED") setSwitchRequired(true); else setAuthenticationRequired(true); } }); }).catch(cause => { if (mounted) { setError(cardError(cause)); setLoading(false); } });
    return () => { mounted = false; };
  }, [token, playMoment, noteShare]);
  // The guest shows the phone and the cashier books on another device, often with no focus or visibility event in
  // between. So while the card is visible it re-reads the balance by itself for a short window (createAutoRefresh),
  // coalesced and at most every REFRESH_INTERVAL_MS; a grown balance lands the new stamp. A card that stopped existing
  // (closed or reissued elsewhere) is replaced by a plain message; network trouble keeps the last known state; a read
  // the server refuses (rate limit) ends the window. Timed re-reads are marked, so the server counts them apart from the
  // per-network card-read limit that every guest's page load on one shop Wi-Fi relies on.
  useEffect(() => {
    let mounted = true;
    function refresh(read: CardRead): Promise<CardReadOutcome> {
      const manual = read === "button";
      if (!live.current || document.visibilityState !== "visible" || !gate.current.tryStart()) return Promise.resolve("skipped");
      if (manual) setRefreshing(true);
      return apiJson<CardResponse>(`/api/card/${encodeURIComponent(token)}`, read === "timed" ? { headers: { "x-loynara-card-read": "poll" } } : undefined)
        .then(result => {
          if (!mounted || !live.current) return "stop" as const;
          const grew = balanceSeen.current !== null && result.balance > balanceSeen.current;
          // The record may have moved since the last read (the tap page marks its own moment), so both marks count.
          const unseen = momentFor(result, { balance: balanceSeen.current, seenAt: laterMark(newestShown.current, readSeen(result.cardLocator)) }, Date.now());
          if (unseen.credited > 0) playMoment(unseen.credited);
          if (unseen.newest) { newestShown.current = unseen.newest; markSeen(result.cardLocator, unseen.newest); }
          balanceSeen.current = result.balance;
          const kept = noteShare(result, read === "timed");
          if (read === "timed" && kept.stampMoment?.referralDue && !kept.stampMoment.referral && !shareOff.current) setShareAwaited(true);
          setCard(kept); setRefreshFailed(false);
          return grew ? "grew" as const : "ok" as const;
        })
        .catch(cause => {
          if (!mounted) return "stop" as const;
          if (cause instanceof ClientApiError && cause.status === 404) { live.current = false; setCard(null); setError(GONE_MESSAGE); return "stop" as const; }
          if (manual) setRefreshFailed(true);
          return cause instanceof ClientApiError && cause.code === "RATE_LIMIT" ? "stop" as const : "failed" as const;
        })
        .finally(() => { gate.current.finish(); if (mounted) setRefreshing(false); });
    }
    const auto = createAutoRefresh(refresh, () => document.visibilityState === "visible");
    function onPageShow(event: PageTransitionEvent) { if (event.persisted) auto.visibility(); }
    refreshNow.current = auto.button;
    startAutoRefresh.current = auto.loaded;
    document.addEventListener("visibilitychange", auto.visibility);
    window.addEventListener("focus", auto.focus);
    window.addEventListener("pageshow", onPageShow);
    return () => { mounted = false; auto.stop(); document.removeEventListener("visibilitychange", auto.visibility); window.removeEventListener("focus", auto.focus); window.removeEventListener("pageshow", onPageShow); };
  }, [token, playMoment, noteShare]);
  useEffect(() => {
    // The Wallet flags are kept under the card number (F-2), so the status is read once the card is in.
    if (!cardLocator) return;
    let mounted = true;
    const controller = new AbortController();
    // Capability belongs to this card's tenant/location. A failed check leaves the action hidden.
    const saved = (result: WalletStatus) => { if (!mounted) return; if (savedViewDue(cardLocator, result)) setSavedView(true); if (savedLineDue(cardLocator, result)) setSavedLine(true); };
    void readWalletStatus(token, controller.signal).then(result => { if (mounted) { setPlatform(walletPlatform()); setWalletScope({ token, availability: result }); setWalletBusy(null); saved(result); } }).catch(() => {});
    // Back from Apple's sheet: the page becomes visible again, and only a registered pass counts.
    const visible = () => { if (document.visibilityState === "visible") void readWalletStatus(token, controller.signal).then(result => { if (mounted) { setWalletScope({ token, availability: result }); saved(result); } }).catch(() => {}); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted = false; controller.abort(); walletOperation.current?.abort(); walletOperation.current = null; document.removeEventListener("visibilitychange", visible);
      if (downloadReset.current) clearTimeout(downloadReset.current);
    };
  }, [token, cardLocator]);

  // Only a ready projection yields a fresh two-minute download ticket. Pending work stays in the worker.
  async function addToAppleWallet() {
    if (walletOperation.current) return;
    const controller = new AbortController(); walletOperation.current = controller;
    setWalletBusy("apple"); setWalletError("");
    try {
      const url = await prepareAppleWallet(token, controller.signal);
      if (controller.signal.aborted) return;
      // The new pass supersedes the previous provider's one, so the re-add prompt has done its job.
      setWalletScope(scope => scope && { ...scope, availability: { ...scope.availability, appleReAdd: false } });
      window.location.assign(url);
      downloadReset.current = setTimeout(() => { walletOperation.current = null; setWalletBusy(null); }, 4000);
    } catch (cause) {
      if (!controller.signal.aborted) { setWalletError(walletMessage(cause, card?.locale === "fr")); setWalletBusy(null); }
      if (walletOperation.current === controller) walletOperation.current = null;
    }
  }

  async function addToGoogleWallet() {
    if (walletOperation.current) return;
    const controller = new AbortController(); walletOperation.current = controller;
    setWalletBusy("google"); setWalletError("");
    try {
      const { url } = await apiJson<{ url: string }>("/api/wallet/google", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const target = new URL(url);
      if (target.protocol !== "https:" || target.hostname !== "pay.google.com") throw new Error("Unexpected Google Wallet link");
      window.location.assign(target.href);
    } catch (cause) {
      if (!controller.signal.aborted) { setWalletError(walletMessage(cause, card?.locale === "fr")); setWalletBusy(null); }
    } finally {
      if (walletOperation.current === controller) walletOperation.current = null;
    }
  }

  async function bindBrowser(data: { authenticate: true } | { switchAccount: true }) {
    setBindingError(current => ({ ...current, shown: false }));
    try {
      await postJson(`/api/tap/card/${encodeURIComponent(token)}/session`, data);
      setAuthenticationRequired(false); setSwitchRequired(false); continueTap();
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.code === "ACCOUNT_SWITCH_REQUIRED") {
        setAuthenticationRequired(false); setSwitchRequired(true);
      } else setBindingError({ text: cardError(cause), shown: true });
    }
  }

  async function closeCurrentCard() {
    setCloseBusy(true); setCloseError("");
    try {
      await postJson<{ closed: true }>(`/api/card/${encodeURIComponent(token)}/close`, { confirm: "CLOSE_CARD" });
      live.current = false;
      walletOperation.current?.abort();
      setClosed(true);
      setCard(null);
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : "Die Karte konnte nicht geschlossen werden.");
    } finally { setCloseBusy(false); }
  }

  if (closed) return <CardState title="Karte geschlossen" message={wallet && (wallet.apple !== "unavailable" || wallet.google !== "unavailable") ? "Dieser Kartenlink, der QR-Code und eine in Wallet gespeicherte Karte sind nicht mehr nutzbar. Frühere Buchungen bleiben vorerst unter einer pseudonymen Karten-ID gespeichert, bis eine geprüfte Aufbewahrungsregel feststeht." : "Dieser Kartenlink und der QR-Code sind nicht mehr nutzbar. Frühere Buchungen bleiben vorerst unter einer pseudonymen Karten-ID gespeichert, bis eine geprüfte Aufbewahrungsregel feststeht."} />;
  if (loading) return pendingReturn && !waited ? <CustomerCardReturning label="Deine Karte wird geladen." /> : <CustomerCardLoading label="Deine Karte wird geladen." late={pendingReturn} />;
  if (!card) return <CardState title="Karte nicht erreichbar" message={error} tone="error" icon={<CreditCard size={24} />}>
    <Link className={buttonClassName({ block: true })} href="/recover">Karte wiederfinden</Link>
  </CardState>;
  const french = card.locale === "fr";
  const expiry = card.programType === "points" && Boolean(card.pointsExpiry || card.pendingExpiry);
  // Keyed from the old end (entries of one instant are told apart by how many older ones share it), so a new booking
  // adds one row and leaves the others as they are.
  const activity = card.activity.map((entry, index) => ({ id: `${entry.createdAt}-${card.activity.slice(index + 1).filter(older => older.createdAt === entry.createdAt).length}`, label: entry.kind === "award" && entry.isWelcomeBonus ? french ? "Bonus de bienvenue" : "Startbonus" : entry.kind === "award" && entry.isHappyHour ? "Happy Hour" : entry.kind === "award" && entry.isWinbackBonus ? french ? "Bonus de retour" : "Willkommen-zurück-Bonus" : entry.kind === "award" && entry.isBirthdayBonus ? french ? "Bonus d’anniversaire" : "Geburtstags-Bonus" : entry.kind === "award" && entry.isChallengeBonus ? french ? "Défi du mois" : "Monats-Challenge" : entry.kind === "award" ? entry.isPurchase ? french ? "Achat enregistré" : "Kauf erfasst" : french ? "Visite enregistrée" : "Gesammelt" : entry.kind === "redeem" ? french ? "Récompense utilisée" : "Prämie eingelöst" : entry.kind === "expiry" ? french ? "Points expirés" : "Punkte verfallen" : french ? "Correction" : "Korrektur", date: activityDay(entry.createdAt, french ? "fr-FR" : "de-DE"), change: entry.delta }));
  const shop = { shop: card.merchantName, location: card.locationName };
  const emailStatus = !french && email.status?.available ? email.status : null;
  const notices = <>
    {/* Each notice opens and closes in place (Row add / remove), so the sections below never jump. */}
    <Reveal open={authenticationRequired} gap="var(--space-4)"><section role="status" className={noticeClass}><p>Bestätige deinen Browserzugang mit diesem privaten Kartenlink.</p><Button variant="secondary" size="sm" onClick={() => void bindBrowser({ authenticate: true })}>Mit meinem privaten Kartenlink anmelden</Button></section></Reveal>
    <Reveal open={switchRequired} gap="var(--space-4)"><section role="alert" className={noticeClass}><p>Auf diesem Gerät ist eine andere Karte gespeichert. Soll künftig diese Karte für NFC verwendet werden? Auf einem geteilten Gerät bestätigen wir die Karte bei jeder Berührung.</p><Button variant="secondary" size="sm" onClick={() => void bindBrowser({ switchAccount: true })}>Diese Karte für NFC verwenden</Button></section></Reveal>
    <Reveal open={bindingError.shown} gap="var(--space-4)"><p role="alert" className={noticeClass}>{bindingError.text}</p></Reveal>
    {savedView && <CardWalletMessages token={token} expiry={expiry} onShown={setConsentUp} />}
    <Reveal open={!french && offerShown && !savedView} gap="var(--space-4)"><EmailOffer token={token} shop={shop} reload={email.reload} onSent={() => setOfferKept(true)} onClose={() => setOfferClosed(true)} /></Reveal>
    <Reveal open={wallet?.apple === "available" && wallet.appleReAdd === true && platform !== "android"} gap="var(--space-4)"><section role="status" className={noticeClass}><p>{french ? "Votre carte Apple Wallet change de version. Ajoutez-la une nouvelle fois pour que votre solde y reste à jour. L’ancienne carte ne sera ensuite plus mise à jour : vous pouvez la supprimer." : "Deine Karte in Apple Wallet bekommt eine neue Version. Füge sie bitte einmal neu hinzu, damit dein Stand dort aktuell bleibt. Die alte Karte wird danach nicht mehr aktualisiert. Du kannst sie aus Wallet löschen."}</p><Button variant="secondary" size="sm" disabled={walletBusy !== null} onClick={() => void addToAppleWallet()}>{french ? "Ajouter de nouveau à Apple Wallet" : "Neu zu Apple Wallet hinzufügen"}</Button></section></Reveal>
  </>;
  return <CustomerCard changes={cardChanges({ programType: card.programType === "points" ? "points" : "stamp", rewards: card.rewards, pending: card.pending, pendingExpiry: card.pendingExpiry })} notices={notices} businessName={card.merchantName} locationName={card.locationName} programType={card.programType === "stamp" ? "stamps" : "points"} balance={moment && !moment.stepped ? Math.max(0, card.balance - moment.credited) : card.balance} landed={moment?.stepped ? card.balance : undefined} landedCount={moment?.credited} quiet={returned} waited={waited} moment={moment ? { credited: moment.credited, balance: card.balance } : undefined} rewards={card.rewards.map(reward => ({ id: reward.id, title: reward.title, cost: reward.cost }))} cardLocator={card.cardLocator} qrSrc={`/api/qr?value=${encodeURIComponent(card.scanCode)}`} brandColor={card.brandColor} activity={activity} rulesText={card.rulesText} news={card.news} demoNotice={card.demoNotice} reviewUrl={card.reviewUrl} pointsExpiry={card.pointsExpiry} winback={card.winback} challenge={card.challenge} level={card.level} endsOn={card.endsOn ? new Intl.DateTimeFormat(french ? "fr-FR" : "de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${card.endsOn}T00:00:00Z`)) : undefined} happyHourUntil={card.happyHourUntil} locale={french ? "fr" : "de"} exportUrl={`/api/card/${encodeURIComponent(token)}/export`} walletSaved={savedLine && !french} appleSaved={wallet?.appleSaved === true} email={emailStatus ? { ...emailRow(emailStatus), sheet: (open, onClose) => <EmailSheet token={token} shop={shop} status={emailStatus} reload={email.reload} open={open} onClose={onClose} /> } : undefined} recoverUrl={emailStatus?.emailVerified ? emailStatus.recoverUrl : undefined} contactPanel={<>{french && !(savedView && consentUp) && <CardContact token={token} locale="fr" />}{!savedView && <CardWalletMessages token={token} expiry={expiry} />}<CardBirthday token={token} />{referralPlace(card.stampMoment) === "below" && <CardReferral token={token} locale={french ? "fr" : "de"} />}</>} referral={referralPlace(card.stampMoment, shareAwaited) === "card" && <CardReferral token={token} locale={french ? "fr" : "de"} hold={referralHold} share={card.stampMoment?.referral} />} titleAlone={card.stampMoment !== undefined} onRefresh={() => refreshNow.current()} refreshing={refreshing} refreshFailed={refreshFailed} onCloseCard={closeCurrentCard} closeBusy={closeBusy} closeError={closeError} onAppleWallet={wallet?.apple === "available" ? addToAppleWallet : undefined} onGoogleWallet={wallet && wallet.google !== "unavailable" ? addToGoogleWallet : undefined} walletBusy={walletBusy} googleTestOnly={wallet?.google === "test_only"} walletPlatform={platform} walletError={walletError} />;
}

function CardState({ title, message, tone = "info", icon, children }: { title: string; message: string; tone?: "info" | "error"; icon?: ReactNode; children?: ReactNode }) {
  // The page turns into this state after the card was shown, so focus the title to announce it.
  return <CustomerState title={title} message={message} tone={tone} icon={icon} focusTitle>{children}</CustomerState>;
}

/** Activity dates (G-M3), by calendar day: „Heute“, „Gestern“, the weekday within the week, then „30. Okt.“, the year only
 *  when it is not this one. French cards keep the plain date (no new French copy for now). */
export function activityDay(iso: string, locale: string, now = new Date()) {
  const date = new Date(iso);
  if (locale.startsWith("fr")) return date.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return "Heute";
  if (days === 1) return "Gestern";
  if (days > 1 && days < 7) return date.toLocaleDateString(locale, { weekday: "short" });
  return date.toLocaleDateString(locale, { day: "numeric", month: "short", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}
