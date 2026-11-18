"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { MixCard } from "@/components/customer/mix-card";
import { flushSync } from "react-dom";
import { quantityPickerMax, type StaffRole } from "@/lib/award-limits";
import { parsePurchaseAmountMinor, PointsError, purchasePoints } from "@/lib/points";
import { ArrowRight, Check, Clock, Gift, Menu, Minus, Plus, ScanLine, ShieldAlert, Undo2, WifiOff, X } from "lucide-react";
import type { ProgramType, UiLocale } from "@/components/loyalty-ui";
import { Button, buttonClassName } from "@/components/ui/button";
import { CashierShell, type CashierState } from "@/components/ui/cashier-shell";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { useFormCheck } from "@/components/ui/form-check";
import { mixStyles } from "@/components/ui/mix";
import { NumberRoll } from "@/components/ui/number-roll";
import { PointsLadder } from "@/components/ui/points-ladder";
import { Sheet } from "@/components/ui/sheet";
import { unitWord, withUnit } from "@/lib/units";
import { birthdayCashierLine, WINBACK_EXCLUSIONS, winbackCashierLine } from "@/lib/wallet-message-rules";
import styles from "./cashier-view.module.css";

export type CashierReward = { id: string; name: string; cost: number; eligible: boolean };
export type CashierAward = { quantity: number } | { purchaseAmountMinor: number; ruleVersionId: string };
export type CashierCard = { id: string; code: string; cardLocator: string; matchedBy?: "code" | "locator"; balance: number; programType: ProgramType; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; currency: "EUR" | "MAD"; ruleVersionId: string; rewards: CashierReward[]; /** Bonuses booked with the next award: Startbonus (first award), win-back (ENG-044), birthday (ENG-049); 0 = none. */ welcomeBonus?: number; winbackBonus?: number; birthdayBonus?: number; /** A happy-hour window is running: purchase points count twice. */ happyHour?: boolean; level?: { name: string; perk?: string } };
export type CashierBooked = { tone: "success" | "pending" | "undone"; title: string; headline?: string; /** How the headline adds up: „1 Punkt + 5 Startbonus“. */ parts?: string; detail: string; meta?: string; hint?: string; undo?: "available" | "staff-only"; error?: string;
  /** The closed card with its new balance, shown (never bookable) while „Gebucht“ holds the dock. */ card?: CashierCard };
export type CashierViewProps = {
  locationName: string;
  /** The shop's name (the card's mark) and colour; without a colour the card takes the house palette. */
  businessName?: string;
  brandColor?: string;
  card?: CashierCard | null;
  /** Minimal result for a typed card number; the card is opened only after the cashier confirms it. */
  preview?: { cardLocator: string; programName: string; issuedAt: string } | null;
  /**
   * Shown right after a booking, above the scan form: the card is already closed, so nothing on it can be tapped again,
   * and the next card can be scanned at once. `undo` "available" offers „Rückgängig“ (owner and manager may correct);
   * "staff-only" says who can.
   */
  booked?: CashierBooked | null;
  /** Reverses the booking just shown, through the same correction path as the owner dashboard. */
  onUndo?: () => void;
  onConfirmPreview?: () => void;
  onCancelPreview?: () => void;
  busy?: boolean;
  status?: "idle" | "success" | "pending" | "rejected" | "offline";
  message?: string;
  /** The cause of a refusal, where the page knows it: the panel's title instead of the strip's own word. */
  rejectedTitle?: string;
  onLookup: (code: string) => void | Promise<void>;
  /** The typed card number was rejected (unknown or malformed): its field shakes once and is marked invalid until it is edited. */
  codeRejected?: boolean;
  onCodeEdit?: () => void;
  /** Focus the card-number field when the scan form appears (handheld scanners type into it). */
  focusCodeInput?: boolean;
  /**
   * The counter camera, rendered in a fixed place so it keeps running from one customer to the next. While it is
   * present the scan form offers no separate "Kamera öffnen".
   */
  camera?: ReactNode;
  /**
   * NFC confirmations (pending taps and the notification switch), shown at the top in a fixed place whatever the QR
   * counter is doing, so new taps stay visible and the panel keeps polling while cards are scanned below.
   */
  nfcPanel?: ReactNode;
  /** Changes after every booking: clears the quantity, amount and open dialog without remounting the camera. */
  resetToken?: number;
  onStartCamera?: () => void;
  onAward: (card: CashierCard, award: CashierAward) => void | Promise<void>;
  onRedeem: (card: CashierCard, reward: CashierReward) => void | Promise<void>;
  onQueueOffline?: (card: CashierCard, award: CashierAward) => void | Promise<void>;
  offlineLeaseExpiresAt?: string;
  offlinePanel?: ReactNode;
  onClear: () => void;
  locale?: UiLocale;
  onLocaleChange?: (locale: UiLocale) => void;
  showOverview?: boolean;
  /** Staff role of the signed-in user; caps the quantity picker at the server limit. Missing means the strictest cap. */
  role?: StaffRole;
  logoutControl?: ReactNode;
};

/** Bonuses booked with an award, by source (ENG-133). */
export type AwardBonuses = { welcomeBonus?: number; happyHourBonus?: number; winbackBonus?: number; birthdayBonus?: number; challengeBonus?: number; referralBonus?: number };
// The names the owner's ledger export uses for these sources (lib/export.ts), in the order the line names them: happy hour
// first, since it doubles the purchase itself (Marketing, 30 Oct).
const BONUS_NAMES: Record<keyof AwardBonuses, string> = { happyHourBonus: "Happy Hour", welcomeBonus: "Startbonus", winbackBonus: "Willkommen-zurück-Bonus", birthdayBonus: "Geburtstags-Bonus", challengeBonus: "Challenge-Bonus", referralBonus: "Empfehlungsbonus" };
/** Only the bonus fields of a server result, so other numbers on it are never summed. */
export const bonusesOf = (r: AwardBonuses): AwardBonuses => ({ welcomeBonus: r.welcomeBonus, happyHourBonus: r.happyHourBonus, winbackBonus: r.winbackBonus, birthdayBonus: r.birthdayBonus, challengeBonus: r.challengeBonus, referralBonus: r.referralBonus });
export const bonusTotal = (bonuses: AwardBonuses) => Object.values(bonusesOf(bonuses)).reduce((sum: number, n) => sum + (n ?? 0), 0);

/**
 * „1 Punkt + 5 Punkte Startbonus“: the quantity and each bonus by name. French sums the bonuses (« + 5 en plus »). Each part
 * keeps its words together with no-break spaces, so a narrow line only breaks at a „+“.
 */
export function awardParts(quantity: number, kind: ProgramType, bonuses: AwardBonuses, locale: UiLocale) {
  const n = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE").format;
  const base = `${n(quantity)} ${unitWord(quantity, kind, locale)}`;
  const parts = locale === "fr" ? [base, ...(bonusTotal(bonuses) ? [`${n(bonusTotal(bonuses))} en plus`] : [])]
    : [base, ...(Object.keys(BONUS_NAMES) as Array<keyof AwardBonuses>).filter(key => (bonuses[key] ?? 0) > 0).map(key => `${n(bonuses[key]!)} ${unitWord(bonuses[key]!, kind, locale)} ${BONUS_NAMES[key]}`)];
  return parts.map(part => part.replace(/ /g, "\u00a0")).join(" + ");
}

/**
 * What a booking added: the balance change the cashier sees, and whether the credited quantity plus the bonuses the server
 * named add up to it. A mismatch (a bonus the server did not name, or a balance that moved meanwhile) is logged; the
 * screen shows the real change either way.
 */
export function awardDelta(balanceBefore: number, result: AwardBonuses & { balance: number; creditedQuantity: number }) {
  const delta = result.balance - balanceBefore;
  const known = result.creditedQuantity + bonusTotal(result);
  if (known !== delta) console.warn(`Kasse: booked ${known} (quantity and bonuses) but the balance moved by ${delta}`);
  return { delta, matches: known === delta };
}

/** The booked screen's chip and the line under it: „+6 Punkte“ and „1 Punkt + 5 Punkte Startbonus“; no line without a bonus. */
export function bookedAward(card: Pick<CashierCard, "balance" | "programType">, credited: number, result: AwardBonuses & { balance: number; balanceBefore?: number }, locale: UiLocale) {
  // The server's balance under the booking's lock; the lookup's balance only if an older server leaves it out.
  const { delta, matches } = awardDelta(result.balanceBefore ?? card.balance, { ...result, creditedQuantity: credited });
  const headline = `+${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE").format(delta)} ${unitWord(delta, card.programType, locale)}`;
  return { headline, parts: bonusTotal(result) || !matches ? awardParts(credited, card.programType, bonusesOf(result), locale) : undefined };
}

/** What the amount sheet previews, read like the booked screen: the total („+29 Punkte“), its parts if any bonus comes with it, the balance after. */
export function purchasePreviewOf(card: Pick<CashierCard, "balance" | "happyHour" | "welcomeBonus" | "winbackBonus" | "birthdayBonus">, points: number, locale: UiLocale) {
  const bonuses: AwardBonuses = { happyHourBonus: card.happyHour ? points : 0, welcomeBonus: card.welcomeBonus, winbackBonus: card.winbackBonus, birthdayBonus: card.birthdayBonus };
  const total = points + bonusTotal(bonuses);
  return { total: `+${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE").format(total)} ${unitWord(total, "points", locale)}`, parts: bonusTotal(bonuses) ? awardParts(points, "points", bonuses, locale) : undefined, balanceAfter: card.balance + total };
}

/** The lookup's open card as the counter holds it (ENG-133: the bonuses the next award books come along). */
export type CashierLookup = { membershipId: string; cardLocator: string; matchedBy: "code" | "locator"; balance: number; programType: "stamp" | "points"; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; currency: "EUR" | "MAD"; ruleVersionId: string; rewards: Array<{ id: string; title: string; cost: number }>; welcomeBonus?: number; happyHour?: boolean; winbackBonus?: number; birthdayBonus?: number; level?: { name: "Bronze" | "Silber" | "Gold" | null; perk?: string } };
export function cashierCard(result: CashierLookup, code: string): CashierCard {
  return { id: result.membershipId, code, cardLocator: result.cardLocator, matchedBy: result.matchedBy, balance: result.balance, programType: result.programType === "stamp" ? "stamps" : "points", earningMode: result.earningMode, pointsPerCurrencyUnit: result.pointsPerCurrencyUnit, currency: result.currency, ruleVersionId: result.ruleVersionId, rewards: result.rewards.map(reward => ({ id: reward.id, name: reward.title, cost: reward.cost, eligible: result.balance >= reward.cost })), welcomeBonus: result.welcomeBonus ?? 0, happyHour: result.happyHour === true, winbackBonus: result.winbackBonus ?? 0, birthdayBonus: result.birthdayBonus ?? 0, level: result.level?.name ? { name: result.level.name, perk: result.level.perk } : undefined };
}

function previewMonth(isoMonth: string, locale: UiLocale) {
  const [year, month] = isoMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale === "fr" ? "fr-FR" : "de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function CashierView({ locationName, businessName = "", brandColor, card, preview, booked, onUndo, onConfirmPreview, onCancelPreview, busy = false, status = "idle", message, rejectedTitle, onLookup, codeRejected = false, onCodeEdit, focusCodeInput = false, camera, nfcPanel, resetToken = 0, onStartCamera, onAward, onRedeem, onQueueOffline, offlineLeaseExpiresAt, offlinePanel, onClear, locale = "de", onLocaleChange, showOverview = true, role, logoutControl }: CashierViewProps) {
  const [code, setCode] = useState("");
  const fields = useFormCheck();
  const [quantity, setQuantity] = useState(1);
  const maxQuantity = quantityPickerMax(role);
  const [purchaseAmount, setPurchaseAmount] = useState("");
  // Points shops: the amount is typed in a bottom sheet, next to the keyboard and the thumb.
  const [amountOpen, setAmountOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "award"; award: CashierAward } | { kind: "redeem"; reward: CashierReward } | null>(null);
  // The booking on its way: its own button shows that it is working (and keeps its colour) while the others step back.
  const [working, setWorking] = useState<"award" | "redeem" | null>(null);
  const awarding = busy && working === "award", redeeming = busy && working === "redeem";
  const award = (selected: CashierCard, what: CashierAward) => { setWorking("award"); return onAward(selected, what); };
  // Each card (and each booking) starts from a clean form. Reset during render instead of remounting the view, which
  // would also restart the counter camera.
  const formKey = `${card?.id ?? (preview ? "preview" : "empty")}:${resetToken}`;
  const [seenFormKey, setSeenFormKey] = useState(formKey);
  if (seenFormKey !== formKey) {
    setSeenFormKey(formKey);
    setQuantity(1); setPurchaseAmount(""); setConfirm(null); setAmountOpen(false); setWorking(null);
    if (card || preview) setCode("");
  }
  const t = locale === "fr" ? {
    overview: "Vue d’ensemble", menu: "Menu : langue et déconnexion", found: "Carte trouvée.", scanTitle: "Scanner la carte. Puis décider.", success: "Enregistré", pending: "En attente", offline: "Hors connexion", rejected: "Impossible", ready: "Prêt pour la prochaine carte", scanHelp: "Présentez le QR code à la caméra.", camera: "Ouvrir la caméra", manual: "Numéro ou code de la carte", codeHint: "Sous le QR code de la carte.", check: "Vérifier", cameraFallback: "Sans caméra : saisissez le numéro.", verified: "Carte vérifiée", other: "Autre carte", balance: "Solde actuel", stamps: "tampons", points: "points", decrease: "Diminuer la quantité", increase: "Augmenter la quantité", enterAmount: "Saisir le montant", book: "Enregistrer", newBalance: "Nouveau solde", amountInvalid: "Vérifiez le montant, p. ex. 16,70.", noPoints: "Trop faible pour un point.", redeem: "Utiliser une récompense", rewards: "Récompenses", redeemShort: "Utiliser", still: "encore", noRewards: "Aucune récompense pour cette carte.", left: "Encore", undo: "Annuler l’opération", undoStaff: "Erreur ? La direction peut corriger.", locatorNote: "Ouverte sans scan : récompense seulement pour sa propre carte.", offlineNote: "Pas de connexion. En attente ne compte qu’après la synchronisation.", confirmAward: "Confirmer l’ajout ?", confirmRedeem: "Confirmer la récompense ?", bookFor: "à ajouter à la carte", redeemFor: "à utiliser sur la carte", cancel: "Annuler", yesAward: "Oui, ajouter", yesRedeem: "Oui, utiliser", working: "Un instant …", cardOpen: "Carte ouverte", cardCheck: "Vérifier la carte", cardFound: "Carte trouvée",
  } : {
    overview: "Zur Übersicht", menu: "Menü: Sprache und Abmelden", found: "Karte gefunden.", scanTitle: "Karte scannen. Dann entscheiden.", success: "Gebucht", pending: "Ausstehend", offline: "Keine Verbindung", rejected: "Nicht möglich", ready: "Bereit für die nächste Karte", scanHelp: "QR-Code in die Kamera halten.", camera: "Kamera öffnen", manual: "Kartennummer oder Kartencode", codeHint: "Steht unter dem QR-Code.", check: "Prüfen", cameraFallback: "Ohne Kamera: Kartennummer eingeben.", verified: "Geprüfte Karte", other: "Andere Karte", balance: "Aktueller Kontostand", stamps: "Stempel", points: "Punkte", decrease: "Menge verringern", increase: "Menge erhöhen", enterAmount: "Kaufbetrag eingeben", book: "Buchen", newBalance: "Neuer Stand", amountInvalid: "Betrag prüfen, z. B. 16,70.", noPoints: "Zu klein für einen Punkt.", redeem: "Prämie einlösen", rewards: "Prämien", redeemShort: "Einlösen", still: "noch", noRewards: "Für diese Karte ist keine Prämie eingerichtet.", left: "Noch", undo: "Rückgängig", undoStaff: "Falsch? Die Leitung kann es korrigieren.", locatorNote: "Ohne Scan geöffnet: Prämie nur für die eigene Karte.", offlineNote: "Keine Verbindung. Vorgemerkt zählt erst nach dem Abgleich.", confirmAward: "Vergabe bestätigen?", confirmRedeem: "Einlösung bestätigen?", bookFor: "für Karte", redeemFor: "auf Karte", cancel: "Abbrechen", yesAward: "Ja, vergeben", yesRedeem: "Ja, einlösen", working: "Einen Moment …", cardOpen: "Karte offen", cardCheck: "Karte prüfen", cardFound: "Karte gefunden",
  };
  const unit = card?.programType === "points" ? t.points : t.stamps;
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const purchaseMode = card?.programType === "points" && card.earningMode === "purchase";
  // What „Buchen“ will book, shown before the tap: the points, any bonus booked with them, and the new balance.
  let purchasePreview: { amountMinor: number; points: number } | null = null;
  let amountProblem = "";
  if (purchaseMode && purchaseAmount.trim()) {
    try {
      const amountMinor = parsePurchaseAmountMinor(purchaseAmount);
      purchasePreview = { amountMinor, points: purchasePoints(amountMinor, card.pointsPerCurrencyUnit) };
    } catch (error) { amountProblem = error instanceof PointsError && error.code === "NO_POINTS" ? t.noPoints : t.amountInvalid; }
  }
  const amountLabel = locale === "fr" ? `Montant de l’achat (${card?.currency ?? "EUR"})` : `Kaufbetrag (${card?.currency ?? "EUR"})`;
  // A handheld scanner types the QR content into the field; do not leave that code on screen after submitting it.
  function lookup(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!fields.check(event.currentTarget)) return; const value = code.trim(); if (!value) return; if (value.startsWith("sc_")) setCode(""); onLookup(value); }
  // One stamp is booked with one tap: the scan identified the card and this button is the deliberate decision. More
  // than one, or a choice between online and offline booking, still goes through the confirmation dialog. Points are
  // booked from the amount sheet, whose „Buchen“ is that decision, after the preview of points and new balance.
  const offlineChoice = Boolean(onQueueOffline && offlineLeaseExpiresAt);
  const awardCount = Math.min(quantity, maxQuantity);
  const singleUnit = card?.programType === "points" ? locale === "fr" ? "point" : "Punkt" : locale === "fr" ? "tampon" : "Stempel";
  const welcome = card?.welcomeBonus ?? 0, winback = card?.winbackBonus ?? 0, birthday = card?.birthdayBonus ?? 0;
  const purchaseOutcome = card && purchasePreview ? purchasePreviewOf(card, purchasePreview.points, locale) : null;
  // The Startbonus by name; win-back and birthday as „extra“, since the note above the balance names them.
  const extras = locale === "fr" ? welcome + winback + birthday ? [`${welcome + winback + birthday} en plus`] : []
    : [welcome ? `${welcome} Startbonus` : "", winback + birthday ? `${winback + birthday} extra` : ""].filter(Boolean);
  const awardLabel = extras.length
    ? [awardCount === 1 ? `1 ${singleUnit}` : `${awardCount} ${unit}`, ...extras].join(" + ")
    : awardCount === 1 && !offlineChoice
      ? locale === "fr" ? `Ajouter 1 ${singleUnit}` : `1 ${singleUnit} vergeben`
      : locale === "fr" ? `Vérifier ${awardCount === 1 ? `1 ${singleUnit}` : `${awardCount} ${unit}`}` : `${awardCount === 1 ? `1 ${singleUnit}` : `${awardCount} ${unit}`} prüfen`;
  function awardQuantity(selected: CashierCard) {
    if (awardCount === 1 && !offlineChoice) award(selected, { quantity: awardCount });
    else setConfirm({ kind: "award", award: { quantity: awardCount } });
  }
  const purchaseAward = purchaseMode && purchasePreview ? { purchaseAmountMinor: purchasePreview.amountMinor, ruleVersionId: card.ruleVersionId } : null;
  // The sheet closes on the tap, so the outcome (or an error) shows on the counter; the amount stays for a retry.
  function bookPurchase(offline: boolean) {
    if (!card || !purchaseAward) return;
    setAmountOpen(false);
    if (offline) onQueueOffline?.(card, purchaseAward); else award(card, purchaseAward);
  }
  // A card with a reward ready leads with redeeming; with several ready, the choice is the reward list on the card.
  const readyRewards = card?.rewards.filter(reward => reward.eligible) ?? [];
  const rewardFirst = readyRewards.length > 0;
  // The band names the one ready reward (copy R21); with several, its tap opens the list, so it names none. No French yet.
  const readyLine = locale === "de" && readyRewards.length === 1 ? `${readyRewards[0].name} · Stand reicht` : "";
  function redeemReady() {
    if (readyRewards.length === 1) { setConfirm({ kind: "redeem", reward: readyRewards[0] }); return; }
    const first = document.querySelector<HTMLButtonElement>(".reward-action-list button:not(:disabled)");
    first?.scrollIntoView({ block: "center" }); first?.focus();
  }
  function submitConfirmed() { if (!card || !confirm) return; if (confirm.kind === "award") award(card, confirm.award); else { setWorking("redeem"); onRedeem(card, confirm.reward); } setConfirm(null); }

  const shellState: CashierState = booked ? booked.tone === "pending" ? "busy" : "done"
    : status === "rejected" || status === "offline" ? "error"
      : status === "pending" || busy ? "busy"
        : card || preview ? "open" : "ready";
  const stateLabel = booked ? booked.title
    : status === "rejected" ? t.rejected : status === "offline" ? t.offline : status === "pending" ? t.pending : busy ? t.working
      : card ? t.cardOpen : preview ? t.cardCheck : t.ready;
  const stateDetail = booked || status === "rejected" || status === "offline" ? undefined : card?.cardLocator ?? preview?.cardLocator;
  // Status and "Kamera öffnen" come first; language, overview and sign-out wait behind one menu button.
  const headerActions = <div className={styles.headerActions}>
    <button type="button" className={styles.menuButton} popoverTarget="cashier-menu" aria-label={t.menu}><Menu size={22} aria-hidden="true" /></button>
    <div id="cashier-menu" popover="auto" className={styles.menu}>
    {onLocaleChange && <select className={styles.locale} aria-label={locale === "fr" ? "Langue" : "Sprache"} value={locale} onChange={event => onLocaleChange(event.target.value as UiLocale)}>
      <option value="de">DE</option>
      <option value="fr">FR</option>
    </select>}
    {showOverview && <Link href="/merchant" className={buttonClassName({ variant: "quiet", size: "sm" })}>{t.overview}</Link>}
    {logoutControl}
    </div>
  </div>;

  // The card on the counter: the open card, or after a booking the closed card with its new balance (display only).
  const shown = card ?? booked?.card ?? null;
  // The card counts to the cheapest reward. Points programmes, and a card without any reward, keep today's card until
  // Design draws them on the mix card (Design, 17 Nov).
  const goal = shown?.programType !== "points" && shown?.rewards.length ? shown.rewards.reduce((low, reward) => reward.cost < low.cost ? reward : low) : null;
  const ofGoal = (n: number) => goal && shown?.programType !== "points" ? `${number.format(n)} von ${number.format(goal.cost)}` : withUnit(n, shown?.programType ?? "stamps", locale);
  const after = (card?.balance ?? 0) + awardCount + welcome + winback + birthday;
  // Bottom of the dock = the one primary action in thumb reach: redeeming when a reward is ready, otherwise earning.
  const earnLook = rewardFirst ? { variant: "secondary" as const, size: "lg" as const } : { variant: "primary" as const, size: "xl" as const };
  const dock = booked ? <section key={resetToken} className={cx(`cashier-booked cashier-booked--${booked.tone}`, styles.booked)} data-tone={booked.tone} role="status" aria-live="polite">
    <span key={booked.tone} className={styles.bookedIcon} aria-hidden="true">{booked.tone === "success" ? <Check size={24} strokeWidth={3} /> : booked.tone === "undone" ? <Undo2 size={24} /> : <Clock size={24} />}</span>
    <h2>{booked.title}</h2>
    {booked.headline && <p className={styles.bookedHeadline}>{booked.headline}</p>}
    {booked.parts && <p className={styles.bookedMeta}>{booked.parts}</p>}
    <p className={styles.bookedDetail}>{booked.detail}</p>
    {booked.meta && <p className={styles.bookedMeta}>{booked.meta}</p>}
    {booked.hint && <p className={styles.bookedHint}>{booked.hint}</p>}
    {booked.error && <p className={styles.bookedError} role="alert">{booked.error}</p>}
    {booked.undo === "staff-only" && <p className={styles.bookedMeta}>{t.undoStaff}</p>}
    {(booked.undo === "available" && onUndo || !camera && !booked.card) && <div className={styles.bookedActions}>
      {booked.undo === "available" && onUndo && <Button variant="quiet" size="lg" icon={<Undo2 size={20} />} onClick={onUndo} disabled={busy}>{t.undo}</Button>}
      {!camera && !booked.card && <Button variant="secondary" size="lg" onClick={onClear}>{t.other}</Button>}
    </div>}
    {booked.tone !== "pending" && <p className={styles.bookedMeta}>{t.ready}</p>}
  </section> : card ? <>
    {purchaseMode
      ? <Button {...earnLook} block loading={awarding} disabled={busy && !awarding}
        // Opened and focused inside the tap, so phones raise the number keyboard at once.
        onClick={() => { flushSync(() => setAmountOpen(true)); document.getElementById("purchase-amount")?.focus(); }}>{t.enterAmount}</Button>
      : <>
        <div className={cx("quantity-row", styles.stepper)}>
          <Button variant="secondary" size="lg" className={styles.step} aria-label={t.decrease} onClick={() => setQuantity(q => Math.max(1, q - 1))} disabled={quantity <= 1 || busy}><Minus size={24} aria-hidden="true" /></Button>
          <output aria-live="polite"><NumberRoll value={quantity}>{quantity}</NumberRoll></output>
          <Button variant="secondary" size="lg" className={styles.step} aria-label={t.increase} onClick={() => setQuantity(q => Math.min(maxQuantity, q + 1))} disabled={quantity >= maxQuantity || busy}><Plus size={24} aria-hidden="true" /></Button>
        </div>
        <p className={styles.newBalance}><span>{t.newBalance}</span><b><NumberRoll value={after}>{ofGoal(after)}</NumberRoll></b></p>
        <Button {...earnLook} block className={cx("cashier-award-now", !rewardFirst && styles.book)} icon={rewardFirst ? undefined : <Check size={22} />} onClick={() => awardQuantity(card)} loading={awarding} disabled={busy && !awarding}>{awardLabel}</Button>
      </>}
    {rewardFirst && <button type="button" className={cx("cashier-redeem-now", styles.band)} onClick={redeeming ? undefined : redeemReady} disabled={busy && !redeeming} aria-busy={redeeming || undefined} aria-disabled={redeeming || undefined}>
      <span className={styles.bandIcon} aria-hidden="true"><Gift size={22} /></span>
      <span className={styles.bandText}><b>{t.redeem}</b>{readyLine && <small>{readyLine}</small>}</span>
      <span className={styles.bandNext} aria-hidden="true"><ArrowRight size={22} />{redeeming && <span className={styles.bandWait} />}</span>
    </button>}
    {role === "cashier" && <p className={styles.hint}>{t.undoStaff}</p>}
  </> : undefined;

  // The strip mirrors the state; the outcome panels below announce it, so the strip is not a second live region. After a
  // booking the result carries its own title, so the strip steps aside.
  // The strip mirrors the state; the outcome panels below announce it, so the strip is not a second live region. With a
  // card on the counter the state sits in the card's foot; after a booking the result carries its own title.
  return <CashierShell lang={locale} live={false} brandColor={brandColor} location={<span className="cashier-location">{locationName}</span>} actions={headerActions}
    state={shellState} stateLabel={booked || card ? null : stateLabel} stateDetail={stateDetail} dock={dock}>
    {/* The scan state asks its question; with a card or a result on screen the heading stays for screen readers only. */}
    <h1 className={cx(styles.question, card || preview || booked ? styles.srOnly : styles.title)}>{card ? t.found : t.scanTitle}</h1>
    {nfcPanel}
      {/* While a booking is on its way the card's foot and the button already say so: the panel stays the same live region but takes no room, so the open card does not move. A refusal or an unclear result shows it again. */}
      {status !== "idle" && !booked && <div className={cx(`cashier-status cashier-status--${status}`, awarding || redeeming ? styles.srOnly : styles.outcome)} data-tone={status} role="status" aria-live="polite">
        <span className={styles.outcomeIcon} aria-hidden="true">{status === "success" ? <Check size={22} /> : status === "offline" ? <WifiOff size={22} /> : status === "pending" ? <Clock size={22} /> : <ShieldAlert size={22} />}</span>
        <span className={styles.outcomeText}><strong>{status === "success" ? t.success : status === "pending" ? t.pending : status === "offline" ? t.offline : rejectedTitle ?? t.rejected}</strong>{message && <span id="cashier-outcome-text">{message}</span>}</span>
      </div>}
    {/* One card element for the open card and, after a booking, the same card with its new balance: it stays mounted, so
        only the newly earned stamps pop (cashier-view.module.css › .kasse). */}
    {shown && goal && <div className={cx("card-result-head", styles.kasse)} data-booked={booked ? "" : undefined}>
      {/* The card number as the open card's heading, for screen readers; the card draws it as its name. */}
      {card && <h2 className={styles.srOnly}>{card.cardLocator}</h2>}
      <MixCard size="kasse" businessName={businessName || locationName} locationName={locationName} programType={shown.programType} balance={shown.balance}
        reward={{ id: goal.id, title: goal.name, cost: goal.cost }} rewards={shown.rewards.map(reward => ({ id: reward.id, title: reward.name, cost: reward.cost }))}
        title={shown.cardLocator} sub={t.verified} label={t.balance} locale={locale}
        foot={<>{card || !camera ? <button type="button" className={styles.pill} onClick={() => { setConfirm(null); onClear(); }}><X size={20} aria-hidden="true" />{t.other}</button> : <span className={styles.pillSpace} aria-hidden="true" />}
          {card && <span className={styles.state} data-state={shellState}><i aria-hidden="true" />{stateLabel}</span>}</>} />
    </div>}
    {shown && !goal && <section className={styles.card} aria-labelledby="cashier-card-title">
      <div className={cx("card-result-head", styles.cardHead)}>
        <div><span className={styles.eyebrow}>{t.verified}</span><h2 id="cashier-card-title" className={styles.locator}>{shown.cardLocator}</h2></div>
        {card || !camera ? <Button variant="quiet" size="sm" icon={<X size={16} />} onClick={() => { setConfirm(null); onClear(); }}>{t.other}</Button> : null}
      </div>
      <div className={cx(card && "balance-display", styles.balance)}>
        <span className={styles.srOnly}>{t.balance}</span>
        <strong><NumberRoll value={shown.balance}>{number.format(shown.balance)}</NumberRoll> <em>{unitWord(shown.balance, shown.programType, locale)}</em></strong>
        {card?.level && <span className={styles.level}>{card.level.name}</span>}
      </div>
      {shown.programType === "points" && shown.rewards.length > 0 && <PointsLadder balance={shown.balance} rewards={shown.rewards.map(reward => ({ title: reward.name, cost: reward.cost }))} locale={locale} />}
    </section>}
    {/* On the mix card the figure is drawn clamped to the goal (its label is the card's); the balance in words stays for screen readers and the specs. */}
    {card && goal && <div className={cx("balance-display", styles.srOnly)}>
      <strong><NumberRoll value={card.balance}>{number.format(card.balance)}</NumberRoll> <em>{unitWord(card.balance, card.programType, locale)}</em></strong>
    </div>}
    {shown && <section className={styles.rewards} aria-label={t.rewards}>
      {shown.rewards.length ? <div className={cx(card && "reward-action-list", mixStyles.panel)}>
        {shown.rewards.map(reward => {
          const left = reward.cost - shown.balance, ready = card ? reward.eligible : left <= 0;
          const body = <>
            <span className={mixStyles.tile} data-tone={ready ? "coral" : "mute"}><Gift size={20} aria-hidden="true" /></span>
            <span className={mixStyles.body}>
              <span className={mixStyles.text}><b>{reward.name}</b><small>{ready ? withUnit(reward.cost, shown.programType, locale) : `${t.left} ${number.format(left)} ${unitWord(left, shown.programType, locale)}`}</small></span>
              <span className={cx(mixStyles.val, ready && card && styles.go)}>{ready && card ? t.redeemShort : withUnit(reward.cost, shown.programType, locale)}</span>
            </span>
          </>;
          return card ? <button type="button" key={reward.id} className={cx(mixStyles.row, styles.reward)} data-lead="tile" disabled={!reward.eligible || busy} onClick={() => setConfirm({ kind: "redeem", reward })}>{body}</button>
            : <div key={reward.id} className={mixStyles.row} data-lead="tile">{body}</div>;
        })}
      </div> : card && <p className={styles.help}>{t.noRewards}</p>}
    </section>}
    {card && card.matchedBy === "locator" && <p className={styles.note} role="note">{t.locatorNote}</p>}
    {card && winback + birthday > 0 && <p className={styles.winback} role="note">
      {winback > 0 && <strong>{locale === "fr" ? `Bon retour : +${withUnit(winback, card.programType, locale)} en plus` : winbackCashierLine(card.programType === "points" ? "points" : "stamp", winback)}</strong>}
      {birthday > 0 && <strong>{locale === "fr" ? `Anniversaire : +${withUnit(birthday, card.programType, locale)} en plus` : birthdayCashierLine(card.programType === "points" ? "points" : "stamp", birthday)}</strong>}
      <small>{WINBACK_EXCLUSIONS}</small></p>}
    {card?.level && goal && <p className={styles.note} role="note"><b>{card.level.name}</b>{card.level.perk && <> · {locale === "fr" ? "Avantage" : "Vorteil"}: {card.level.perk}</>}</p>}
    {card?.level?.perk && !goal && <p className={styles.note} role="note">{locale === "fr" ? "Avantage" : "Vorteil"}: {card.level.perk}</p>}
    {camera}
    {!card && preview ? <section className={cx("cashier-preview", styles.panel)} aria-labelledby="cashier-preview-title">
      <span className={styles.eyebrow}>{t.cardFound}</span>
      <h2 id="cashier-preview-title" className={styles.locator}>{preview.cardLocator}</h2>
      <p className={styles.meta}>{preview.programName} · {locale === "fr" ? "émise" : "ausgestellt"} {previewMonth(preview.issuedAt, locale)}</p>
      <p className={styles.help}>{locale === "fr" ? "Est-ce la carte devant vous ?" : "Liegt diese Karte vor dir?"}</p>
      <div className={cx("cashier-preview-actions", styles.stack)}>
        <Button variant="primary" size="lg" block onClick={onConfirmPreview} disabled={busy} data-autofocus>{locale === "fr" ? "Ouvrir la carte" : "Karte öffnen"}</Button>
        <Button variant="quiet" size="sm" onClick={onCancelPreview} disabled={busy}>{locale === "fr" ? "Autre numéro" : "Andere Nummer"}</Button>
      </div>
    </section> : !card ? <section className={styles.ready} aria-label={t.ready}>
      {onStartCamera && !camera && <Button variant="primary" size="lg" block icon={<ScanLine size={20} />} onClick={onStartCamera} disabled={busy}>{t.camera}</Button>}
      <form className={cx(styles.stack, codeRejected && styles.rejected)} onSubmit={lookup} onInput={fields.onInput} noValidate>
        <TextField id="cashier-code" error={fields.error("cashier-code")} label={t.manual} hint={t.codeHint}
          autoFocus={focusCodeInput} value={code} onChange={event => { setCode(event.target.value); if (codeRejected) onCodeEdit?.(); }} {...(codeRejected ? { "aria-invalid": true, "aria-describedby": "cashier-code-hint cashier-outcome-text" } : {})} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          placeholder={locale === "fr" ? "p. ex. K-7QX2MA" : "z. B. K-7QX2MA"} required />
        <Button type="submit" variant={camera || onStartCamera ? "secondary" : "primary"} size="lg" block disabled={busy}>{t.check}</Button>
      </form>
      <p className={styles.help}>{camera ? t.scanHelp : t.cameraFallback}</p>
    </section> : null}
    {card && purchaseMode && <Sheet open={amountOpen} onClose={() => setAmountOpen(false)} side="bottom" title={t.enterAmount} closeLabel={locale === "fr" ? "Fermer" : "Schließen"}
        footer={<div className={styles.stack}>
          {offlineChoice && <Button variant="secondary" size="lg" block disabled={busy || !purchaseAward} onClick={() => bookPurchase(true)}>{locale === "fr" ? "Mettre l’ajout hors ligne en attente" : "Offline-Vergabe vormerken"}</Button>}
          <Button variant="primary" size="xl" block className="cashier-book" disabled={busy || !purchaseAward} onClick={() => bookPurchase(false)}>{t.book}</Button>
        </div>}>
        <div className={styles.stack}>
          <TextField id="purchase-amount" label={amountLabel} type="text" inputMode="decimal" autoComplete="off" placeholder="16,70" value={purchaseAmount}
            onChange={event => setPurchaseAmount(event.target.value)} aria-describedby="purchase-preview" />
          <div id="purchase-preview" className={styles.preview} aria-live="polite">{purchasePreview
            ? <>
              <strong>{purchaseOutcome?.total}</strong>
              {purchaseOutcome?.parts && <span className={styles.previewParts}>{purchaseOutcome.parts}</span>}
              <span>{t.newBalance}: {number.format(purchaseOutcome?.balanceAfter ?? 0)} {unitWord(purchaseOutcome?.balanceAfter ?? 0, "points", locale)}</span>
            </>
            : <span className={amountProblem ? styles.previewProblem : undefined}>{amountProblem || (locale === "fr" ? `${card.pointsPerCurrencyUnit} point(s) par 1 ${card.currency}` : `${card.pointsPerCurrencyUnit} ${card.pointsPerCurrencyUnit === 1 ? "Punkt" : "Punkte"} pro 1 ${card.currency}`)}</span>}</div>
          {offlineChoice && <p className={styles.note} role="note">{t.offlineNote}</p>}
        </div>
      </Sheet>}
      {card && offlineLeaseExpiresAt && <p className={styles.footnote} role="status">{locale === "fr" ? "Tampon hors ligne préparé jusqu’à" : "Offline-Puffer bereit bis"} {new Date(offlineLeaseExpiresAt).toLocaleTimeString(locale === "fr" ? "fr-FR" : "de-DE", { hour: "2-digit", minute: "2-digit" })}. {locale === "fr" ? "En attente ne change pas le solde." : "Vorgemerktes ändert den Kontostand nicht."}</p>}
      {offlinePanel}
    {confirm && card && <Dialog open onClose={() => setConfirm(null)} title={confirm.kind === "award" ? t.confirmAward : t.confirmRedeem}
      description={confirm.kind === "award" ? `${"quantity" in confirm.award ? withUnit(confirm.award.quantity, card.programType, locale) : `${number.format(purchasePoints(confirm.award.purchaseAmountMinor, card.pointsPerCurrencyUnit))} ${unit} ${locale === "fr" ? "pour un achat de" : "für einen Kauf über"} ${number.format(confirm.award.purchaseAmountMinor / 100)} ${card.currency}`} ${t.bookFor} ${card.cardLocator}.` : `${confirm.reward.name} (${withUnit(confirm.reward.cost, card.programType, locale)}) ${t.redeemFor} ${card.cardLocator}.`}
      actions={<>
        <Button variant="secondary" onClick={() => setConfirm(null)}>{t.cancel}</Button>
        {confirm.kind === "award" && onQueueOffline && offlineLeaseExpiresAt && <Button variant="secondary" onClick={() => { onQueueOffline(card, confirm.award); setConfirm(null); }} disabled={busy}>{locale === "fr" ? "Mettre l’ajout hors ligne en attente" : "Offline-Vergabe vormerken"}</Button>}
        <Button variant="primary" onClick={submitConfirmed} disabled={busy}>{confirm.kind === "award" ? t.yesAward : t.yesRedeem}</Button>
      </>}>
      {confirm.kind === "award" && onQueueOffline && offlineLeaseExpiresAt && <p className={styles.note} role="note">{locale === "fr" ? "Connexion perturbée. « Oui, ajouter » essaie en ligne ; en attente ne compte qu’après la synchronisation." : "Verbindung gestört. „Ja, vergeben“ versucht es online; vorgemerkt zählt erst nach dem Abgleich."}</p>}
    </Dialog>}
  </CashierShell>;
}

/**
 * Loading and blocked states of /cashier, on the same dark shell so the counter never flashes a light page first.
 * `app-state-card` stays as a hook for the session specs (it has no styles of its own).
 */
export function CashierAccessState({ state, message, logoutControl }: { state: "loading" | "blocked"; message: string; logoutControl?: ReactNode }) {
  const loading = state === "loading";
  return <CashierShell lang="de" live={false} location={<span className="cashier-location">Kasse</span>} state={loading ? "busy" : "error"} stateLabel={loading ? "Einen Moment …" : "Kein Zugang"}>
    <section className={cx("app-state-card", styles.access)}>
      <h1>{loading ? "Kassenzugang wird geprüft" : "Zugang gesperrt oder nicht eingerichtet"}</h1>
      <p>{loading ? "Dein Standort und deine Berechtigung werden geladen." : message}</p>
      {!loading && <div className={styles.stack}>
        <a href="/login" className={buttonClassName({ variant: "primary", size: "lg", block: true })}>Zur Anmeldung</a>
        {logoutControl}
      </div>}
    </section>
  </CashierShell>;
}
