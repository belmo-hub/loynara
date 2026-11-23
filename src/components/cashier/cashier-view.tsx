"use client";

import { BERLIN } from "@/lib/german-date";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { MixCard } from "@/components/customer/mix-card";
import { useKasseLocation } from "./kasse-sheet";
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
import { Sheet } from "@/components/ui/sheet";
import { unitWord, withUnit as plainWithUnit } from "@/lib/units";
// Every figure in the Kasse keeps its unit on its line: a no-break space between them (Design, 18 Nov).
const withUnit = (...args: Parameters<typeof plainWithUnit>) => plainWithUnit(...args).replace(" ", "\u00a0");
import { formatMinor } from "@/lib/spend-copy";
import { birthdayCashierLine, WINBACK_EXCLUSIONS, winbackCashierLine } from "@/lib/wallet-message-rules";
import styles from "./cashier-view.module.css";

export type CashierReward = { id: string; name: string; cost: number; eligible: boolean };
export type CashierAward = { quantity: number } | { purchaseAmountMinor: number; ruleVersionId: string };
export type CashierCard = { appointment?: { start: string; startLabel: string; serviceName: string; done: boolean }; id: string; code: string; cardLocator: string; matchedBy?: "code" | "locator"; balance: number; programType: ProgramType; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; currency: "EUR" | "MAD"; ruleVersionId: string; rewards: CashierReward[]; /** Bonuses booked with the next award: Startbonus (first award), win-back (ENG-044), birthday (ENG-049); 0 = none. */ welcomeBonus?: number; winbackBonus?: number; birthdayBonus?: number; /** A happy-hour window is running: purchase points count twice. */ happyHour?: boolean; level?: { name: string; perk?: string } };
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
/** The phone's open dock is never shorter than the booked dock it will hold, so a booking keeps its top (Design, 18 Nov).
 * Typed path, measured at 390: the 64 badge 16 under the outer edge, the 275 px stack, 24 under the field. Scan path:
 * the 104 badge 16 under it over the 264 px stack, 24 under that; a taller stack takes the compact metrics (`compact`). */
const TYPED_FLOOR = 315, SCAN_FLOOR = 319;
/** Focuses the „Gebucht“ dock's field once, where it is: the dock is sticky, and a plain focus scrolls a page taller than
 * the screen (a card with its notice) to the dock's place in the flow, moving the card under the result. */
const focusInPlace = (field: HTMLInputElement | null) => field?.focus({ preventScroll: true });
/** Only the bonus fields of a server result, so other numbers on it are never summed. */
export const bonusesOf = (r: AwardBonuses): AwardBonuses => ({ welcomeBonus: r.welcomeBonus, happyHourBonus: r.happyHourBonus, winbackBonus: r.winbackBonus, birthdayBonus: r.birthdayBonus, challengeBonus: r.challengeBonus, referralBonus: r.referralBonus });
export const bonusTotal = (bonuses: AwardBonuses) => Object.values(bonusesOf(bonuses)).reduce((sum: number, n) => sum + (n ?? 0), 0);

/**
 * „1 Punkt + 5 Punkte Startbonus“: the quantity and each bonus by name. French sums the bonuses (« + 5 en plus »). Each part
 * keeps its words together with no-break spaces, so a narrow line only breaks at a „+“.
 */
export function awardParts(quantity: number, kind: ProgramType, bonuses: AwardBonuses, locale: UiLocale) {
  const n = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE").format;
  const base = `${n(quantity)}\u00a0${unitWord(quantity, kind, locale)}`;
  const parts = locale === "fr" ? [base, ...(bonusTotal(bonuses) ? [`${n(bonusTotal(bonuses))} en plus`] : [])]
    : [base, ...(Object.keys(BONUS_NAMES) as Array<keyof AwardBonuses>).filter(key => (bonuses[key] ?? 0) > 0).map(key => `${n(bonuses[key]!)}\u00a0${unitWord(bonuses[key]!, kind, locale)} ${BONUS_NAMES[key]}`)];
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
  const headline = `+${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE").format(delta)}\u00a0${unitWord(delta, card.programType, locale)}`;
  return { headline, parts: bonusTotal(result) || !matches ? awardParts(credited, card.programType, bonusesOf(result), locale) : undefined };
}

/** What the amount sheet previews, read like the booked screen: the total („+29 Punkte“), its parts if any bonus comes with it, the balance after. */
export function purchasePreviewOf(card: Pick<CashierCard, "balance" | "happyHour" | "welcomeBonus" | "winbackBonus" | "birthdayBonus">, points: number, locale: UiLocale) {
  const bonuses: AwardBonuses = { happyHourBonus: card.happyHour ? points : 0, welcomeBonus: card.welcomeBonus, winbackBonus: card.winbackBonus, birthdayBonus: card.birthdayBonus };
  const total = points + bonusTotal(bonuses);
  return { total: `+${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE").format(total)}\u00a0${unitWord(total, "points", locale)}`, parts: bonusTotal(bonuses) ? awardParts(points, "points", bonuses, locale) : undefined, balanceAfter: card.balance + total };
}

/** The lookup's open card as the counter holds it (ENG-133: the bonuses the next award books come along). */
export type CashierLookup = { membershipId: string; cardLocator: string; matchedBy: "code" | "locator"; balance: number; programType: "stamp" | "points"; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; currency: "EUR" | "MAD"; ruleVersionId: string; rewards: Array<{ id: string; title: string; cost: number }>; welcomeBonus?: number; happyHour?: boolean; winbackBonus?: number; birthdayBonus?: number; level?: { name: "Bronze" | "Silber" | "Gold" | null; perk?: string }; appointment?: { start: string; startLabel: string; serviceName: string; done: boolean } };
export function cashierCard(result: CashierLookup, code: string): CashierCard {
  return { id: result.membershipId, code, cardLocator: result.cardLocator, matchedBy: result.matchedBy, balance: result.balance, programType: result.programType === "stamp" ? "stamps" : "points", earningMode: result.earningMode, pointsPerCurrencyUnit: result.pointsPerCurrencyUnit, currency: result.currency, ruleVersionId: result.ruleVersionId, rewards: result.rewards.map(reward => ({ id: reward.id, name: reward.title, cost: reward.cost, eligible: result.balance >= reward.cost })), welcomeBonus: result.welcomeBonus ?? 0, happyHour: result.happyHour === true, winbackBonus: result.winbackBonus ?? 0, birthdayBonus: result.birthdayBonus ?? 0, level: result.level?.name ? { name: result.level.name, perk: result.level.perk } : undefined, appointment: result.appointment };
}

function previewMonth(isoMonth: string, locale: UiLocale) {
  const [year, month] = isoMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale === "fr" ? "fr-FR" : "de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function CashierView({ locationName, businessName = "", brandColor, card, preview, booked, onUndo, onConfirmPreview, onCancelPreview, busy = false, status = "idle", message, rejectedTitle, onLookup, codeRejected = false, onCodeEdit, focusCodeInput = false, camera, nfcPanel, resetToken = 0, onStartCamera, onAward, onRedeem, onQueueOffline, offlineLeaseExpiresAt, offlinePanel, onClear, locale = "de", showOverview = true, role, logoutControl }: CashierViewProps) {
  const [code, setCode] = useState("");
  // The access check answered: the next visit's wait starts its own clock (the waiting frame unmounts, it does not re-render).
  useEffect(() => { waitingSince = 0; }, []);
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
  // The booked dock keeps the open dock's height through „Gebucht“, in every case (Design, 18 Nov): measured in the
  // booking tap, so the dock's edge stays and nothing slides under it.
  const [dockHold, setDockHold] = useState<number>();
  const holdDock = () => { const dock = document.querySelector<HTMLElement>("[data-dock]"); if (dock) setDockHold(dock.getBoundingClientRect().height); };
  const award = (selected: CashierCard, what: CashierAward) => { holdDock(); setWorking("award"); return onAward(selected, what); };
  // Each card (and each booking) starts from a clean form. Reset during render instead of remounting the view, which
  // would also restart the counter camera.
  const formKey = `${card?.id ?? (preview ? "preview" : "empty")}:${resetToken}`;
  const [seenFormKey, setSeenFormKey] = useState(formKey);
  // One reward and it ready when the card opens: the row gives way to the dock's band. Decided at the open and kept
  // through „Gebucht“, so the booking that reaches the goal moves nothing; the next card decides afresh (Design, 18 Nov).
  const singleReady = (opened: CashierCard) => opened.rewards.length === 1 && opened.rewards[0].eligible;
  const [rowGivesWay, setRowGivesWay] = useState(() => Boolean(card && singleReady(card)));
  // The reward the card draws, chosen at the open and held through „Gebucht“ like the row, so the card keeps its size.
  const [goalId, setGoalId] = useState(() => card ? kasseGoal(card)?.id : undefined);
  // The notice an open card carries (a booking on it seconds ago, an unclear result) stays in its place through the
  // booking and „Gebucht“: it is still true, and the page must not move under the result. It leaves with the card
  // (Design, 18 Nov).
  const [heldNotice, setHeldNotice] = useState<{ id: string; status: string; message: string }>();
  const liveNotice = card && !booked && !busy && status === "pending" && message ? { id: card.id, status, message } : undefined;
  const noticeCard = (card ?? booked?.card)?.id;
  if (liveNotice ? liveNotice.id !== heldNotice?.id || liveNotice.message !== heldNotice?.message : heldNotice && (noticeCard !== heldNotice.id || !(busy || booked))) setHeldNotice(liveNotice);
  // The open card's balance, so the closed card after its booking presses the ladder markers it crossed (points).
  const [opened, setOpened] = useState<{ id: string; balance: number }>();
  if (card && (card.id !== opened?.id || card.balance !== opened.balance)) setOpened({ id: card.id, balance: card.balance });
  const keptNotice = heldNotice && (busy || booked) && noticeCard === heldNotice.id ? heldNotice : undefined;
  if (seenFormKey !== formKey) {
    setSeenFormKey(formKey);
    if (card) { setRowGivesWay(singleReady(card)); setGoalId(kasseGoal(card)?.id); setDockHold(undefined); }
    setQuantity(1); setPurchaseAmount(""); setConfirm(null); setAmountOpen(false); setWorking(null);
    if (card || preview) setCode("");
  }
  const t = locale === "fr" ? {
    overview: "Vue d’ensemble", menu: "Menu", found: "Carte trouvée.", scanTitle: "Scanner la carte. Puis décider.", success: "Enregistré", pending: "En attente", offline: "Hors connexion", rejected: "Impossible", ready: "Prêt pour la prochaine carte", scanHelp: "Présentez le QR code à la caméra.", camera: "Ouvrir la caméra", manual: "Numéro ou code de la carte", codeHint: "Sous le QR code de la carte.", check: "Vérifier", cameraFallback: "Sans caméra : saisissez le numéro.", verified: "Carte vérifiée", other: "Autre carte", balance: "Solde actuel", stamps: "tampons", points: "points", decrease: "Diminuer la quantité", increase: "Augmenter la quantité", enterAmount: "Saisir le montant", book: "Enregistrer", newBalance: "Nouveau solde", amountInvalid: "Vérifiez le montant, p. ex. 16,70.", noPoints: "Trop faible pour un point.", redeem: "Utiliser une récompense", rewards: "Récompenses", redeemShort: "Utiliser", still: "encore", noRewards: "Aucune récompense pour cette carte.", left: "Encore", undo: "Annuler l’opération", undoStaff: "Erreur ? La direction peut corriger.", locatorNote: "Ouverte sans scan : récompense seulement pour sa propre carte.", offlineNote: "Pas de connexion. En attente ne compte qu’après la synchronisation.", confirmAward: "Confirmer l’ajout ?", confirmRedeem: "Confirmer la récompense ?", bookFor: "à ajouter à la carte", redeemFor: "à utiliser sur la carte", cancel: "Annuler", yesAward: "Oui, ajouter", yesRedeem: "Oui, utiliser", working: "Un instant …", cardOpen: "Carte ouverte", cardCheck: "Vérifier la carte", cardFound: "Carte trouvée",
  } : {
    overview: "Zur Übersicht", menu: "Menü", found: "Karte gefunden.", scanTitle: "Karte scannen. Dann entscheiden.", success: "Gebucht", pending: "Ausstehend", offline: "Keine Verbindung", rejected: "Nicht möglich", ready: "Bereit für die nächste Karte", scanHelp: "QR-Code in die Kamera halten.", camera: "Kamera öffnen", manual: "Kartennummer oder Kartencode", codeHint: "Steht unter dem QR-Code.", check: "Prüfen", cameraFallback: "Ohne Kamera: Kartennummer eingeben.", verified: "Geprüfte Karte", other: "Andere Karte", balance: "Aktueller Kontostand", stamps: "Stempel", points: "Punkte", decrease: "Menge verringern", increase: "Menge erhöhen", enterAmount: "Kaufbetrag eingeben", book: "Buchen", newBalance: "Neuer Stand", amountInvalid: "Betrag prüfen, z. B. 16,70.", noPoints: "Zu klein für einen Punkt.", redeem: "Prämie einlösen", rewards: "Prämien", redeemShort: "Einlösen", still: "noch", noRewards: "Für diese Karte ist keine Prämie eingerichtet.", left: "Noch", undo: "Rückgängig", undoStaff: "Falsch? Die Leitung kann es korrigieren.", locatorNote: "Ohne Scan geöffnet: Prämie nur für die eigene Karte.", offlineNote: "Keine Verbindung. Vorgemerkt zählt erst nach dem Abgleich.", confirmAward: "Vergabe bestätigen?", confirmRedeem: "Einlösung bestätigen?", bookFor: "für Karte", redeemFor: "auf Karte", cancel: "Abbrechen", yesAward: "Ja, vergeben", yesRedeem: "Ja, einlösen", working: "Einen Moment …", cardOpen: "Karte offen", cardCheck: "Karte prüfen", cardFound: "Karte gefunden",
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
  // than one, or a choice between online and offline booking, still goes through the confirmation dialog. A typed amount
  // always does (ENG-271): „1500“ instead of „15,00“ would otherwise book a hundred times the purchase with one tap.
  const offlineChoice = Boolean(onQueueOffline && offlineLeaseExpiresAt);
  const awardCount = Math.min(quantity, maxQuantity);
  const singleUnit = card?.programType === "points" ? locale === "fr" ? "point" : "Punkt" : locale === "fr" ? "tampon" : "Stempel";
  const welcome = card?.welcomeBonus ?? 0, winback = card?.winbackBonus ?? 0, birthday = card?.birthdayBonus ?? 0;
  const purchaseOutcome = card && purchasePreview ? purchasePreviewOf(card, purchasePreview.points, locale) : null;
  // The Startbonus by name; win-back and birthday as „extra“, since the note above the balance names them.
  const extras = locale === "fr" ? welcome + winback + birthday ? [`${welcome + winback + birthday} en plus`] : []
    : [welcome ? `${welcome} Startbonus` : "", winback + birthday ? `${winback + birthday} extra` : ""].filter(Boolean);
  const counted = `${awardCount}\u00a0${awardCount === 1 ? singleUnit : unit}`, direct = awardCount === 1 && !offlineChoice;
  // German without extras leads with the count, which rolls on + and −: the label is the count and what follows it.
  const awardTail = !extras.length && locale !== "fr" ? `${counted.slice(String(awardCount).length)} ${direct ? "vergeben" : "prüfen"}` : undefined;
  const awardLabel = extras.length ? [counted, ...extras].join(" + ")
    : awardTail ? `${awardCount}${awardTail}` : `${direct ? "Ajouter" : "Vérifier"} ${counted}`;
  // A visit the owner already finished (Design, 22 Nov): even one stamp goes through „Trotzdem vergeben?“.
  const appointmentDone = Boolean(card?.appointment?.done);
  function awardQuantity(selected: CashierCard) {
    if (awardCount === 1 && !offlineChoice && !selected.appointment?.done) award(selected, { quantity: awardCount });
    else setConfirm({ kind: "award", award: { quantity: awardCount } });
  }
  const purchaseAward = purchaseMode && purchasePreview ? { purchaseAmountMinor: purchasePreview.amountMinor, ruleVersionId: card.ruleVersionId } : null;
  // The sheet closes on the tap and the confirmation (with the offline choice, if any) takes over; the amount stays for a retry.
  function bookPurchase() {
    if (!card || !purchaseAward) return;
    setAmountOpen(false);
    setConfirm({ kind: "award", award: purchaseAward });
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
  // Cancelling a typed amount goes back to the amount, selected, so the right one is typed over it. A task later, so the
  // Esc that closed the confirmation does not also close the sheet.
  function cancelConfirm() {
    const typed = confirm?.kind === "award" && "purchaseAmountMinor" in confirm.award;
    setConfirm(null);
    if (typed) window.setTimeout(() => {
      flushSync(() => setAmountOpen(true));
      const field = document.getElementById("purchase-amount") as HTMLInputElement | null;
      field?.focus(); field?.select();
    });
  }
  function submitConfirmed() { if (!card || !confirm) return; if (confirm.kind === "award") award(card, confirm.award); else { holdDock(); setWorking("redeem"); onRedeem(card, confirm.reward); } setConfirm(null); }

  const shellState: CashierState = booked ? booked.tone === "pending" ? "busy" : "done"
    : status === "rejected" || status === "offline" ? "error"
      : status === "pending" || busy ? "busy"
        : card || preview ? "open" : "ready";
  const stateLabel = booked ? booked.title
    : status === "rejected" ? t.rejected : status === "offline" ? t.offline : status === "pending" ? t.pending : busy ? t.working
      : card ? t.cardOpen : preview ? t.cardCheck : t.ready;
  // Design r2: the booked appointment sits in the card head for every way of opening a card (scan or typed number), never in the foot.
  // A visit the owner already finished says so in that same line (Design r2: one line, at most six words, nothing pushed
  // under the dock); „Trotzdem vergeben?“ still guards the stamp.
  const verifiedLine = card?.appointment && !card.appointment.done ? `${t.verified} · Termin ${card.appointment.startLabel}` : t.verified;
  // Design r4: a finished visit is its own full-width warning line under the head row, above the stamps, never in the title column.
  const doneNote = appointmentDone ? <p className={styles.doneLine} role="status"><Clock size={16} aria-hidden="true" />Termin schon gutgeschrieben</p> : null;
  const stateDetail = booked || status === "rejected" || status === "offline" ? undefined : card?.cardLocator ?? preview?.cardLocator;
  // Status and "Kamera öffnen" come first; overview and sign-out wait behind one menu button.
  const headerActions = <div className={styles.headerActions}>
    <button type="button" className={styles.menuButton} popoverTarget="cashier-menu" aria-label={t.menu}><Menu size={22} aria-hidden="true" /></button>
    <div id="cashier-menu" popover="auto" className={styles.menu}>
    {showOverview && <Link href="/merchant" className={buttonClassName({ variant: "quiet", size: "sm" })}>{t.overview}</Link>}
    {logoutControl}
    </div>
  </div>;

  // The card on the counter: the open card, or after a booking the closed card with its new balance (display only).
  const shown = card ?? booked?.card ?? null;
  // The card counts to the cheapest reward not reached, stamps and points alike (Design, 19 Nov). A card without any
  // reward keeps today's card.
  const goal = shown?.rewards.length ? shown.rewards.find(reward => reward.id === goalId) ?? kasseGoal(shown) ?? null : null;
  // The booked line reads in the card's terms whenever the closed card is shown: „6 von 8 · K-…“, „121 Punkte · K-…“.
  const bookedGoal = Boolean(booked?.card);
  // After a booking on the typed-number path the code field stands in the „Gebucht“ dock instead of under it.
  const typedNext = Boolean(booked?.card && focusCodeInput);
  // The card's terms: „6 von 8“ up to the goal, the true count with its unit above it („10 Stempel“), as the card itself.
  const ofGoal = (n: number) => goal && shown?.programType !== "points" && n <= goal.cost ? `${number.format(n)}\u00a0von ${number.format(goal.cost)}` : withUnit(n, shown?.programType ?? "stamps", locale);
  const after = (card?.balance ?? 0) + awardCount + welcome + winback + birthday;
  // Bottom of the dock = the one primary action in thumb reach: redeeming when a reward is ready, otherwise earning.
  const earnLook = rewardFirst ? { variant: "secondary" as const, size: "lg" as const } : { variant: "primary" as const, size: "xl" as const };
  // Scan path: the 104 badge and the scan metrics while they sit at least 16 under the held dock's outer edge (the 1 px
  // edge, then the stack, at most 264 px or 328 with „Rückgängig“, centred above the 24 px foot); otherwise the compact
  // 64, so the booked stack never outgrows the open dock. Without a held height only a hint asks for the compact stack.
  const scanStack = booked?.undo === "available" ? 328 : 264;
  const roomFor104 = dockHold ? 1 + (dockHold - 25 - scanStack) / 2 >= 16 : !booked?.hint;
  const compact = Boolean(booked && (typedNext || !roomFor104));
  const dock = booked ? <section key={resetToken} className={cx(`cashier-booked cashier-booked--${booked.tone}`, styles.booked, compact && styles.bookedCompact, typedNext && styles.bookedTyped)} data-tone={booked.tone}>
    {/* The live region holds only what is announced; the typed path's code field stands beside it, not in it. */}
    <div className={styles.live} role="status" aria-live="polite">
    <span key={booked.tone} className={styles.bookedIcon} aria-hidden="true">{/* A drawn mark, not an icon: 48 in the 104 badge, 32 in the typed path's 64 one (Design, 18 Nov). */}{booked.tone === "success" ? <Check size={compact ? 32 : 48} strokeWidth={3} /> : booked.tone === "undone" ? <Undo2 size={compact ? 32 : 48} /> : <Clock size={compact ? 32 : 48} />}</span>
    <h2>{booked.title}</h2>
    {booked.headline && <p className={styles.bookedHeadline}>{booked.headline}</p>}
    {booked.parts && <p className={styles.bookedMeta}>{booked.parts}</p>}
    {/* With a goal the moment reads in the card's terms, one line („6 von 8 · K-…“); the live sentence and the card
        number stay for screen readers and the specs. Without a goal the live lines show. */}
    {bookedGoal ? <>
      {/* Announced: „Gebucht“, the chip, this sentence. The card number stays in the text (the specs read it), not in the announcement. */}
      <p className={styles.srOnly}>{booked.detail}</p>{booked.meta && <p className={styles.srOnly} aria-hidden="true">{booked.meta}</p>}
      <p className={styles.bookedDetail} aria-hidden="true">{ofGoal(booked.card!.balance)}{booked.meta && ` · ${booked.meta}`}</p>
    </> : <>
      <p className={styles.bookedDetail}>{booked.detail}</p>
      {booked.meta && <p className={styles.bookedMeta} aria-hidden="true">{booked.meta}</p>}
    </>}
    {/* A one-line status shows without its full stop; the live region keeps the sentence. */}
    {booked.hint && <p className={styles.bookedHint}><span aria-hidden="true">{booked.hint.replace(/\.$/, "")}</span><span className={styles.srOnly}>{booked.hint}</span></p>}
    {booked.error && <p className={styles.bookedError} role="alert">{booked.error}</p>}
    {/* The open dock already showed who corrects a mistake; here it stays for screen readers only. */}
    {booked.undo === "staff-only" && <p className={styles.srOnly} aria-hidden="true">{t.undoStaff}</p>}
    {(booked.undo === "available" && onUndo && !typedNext || !camera && !booked.card) && <div className={styles.bookedActions}>
      {booked.undo === "available" && onUndo && !typedNext && <Button variant="quiet" size={compact ? "sm" : "lg"} icon={<Undo2 size={20} />} onClick={onUndo} disabled={busy}>{t.undo}</Button>}
      {!camera && !booked.card && <Button variant="secondary" size="lg" onClick={onClear}>{t.other}</Button>}
    </div>}
    {/* On the typed path a hint (a reward now ready) takes this line's place: the focused field already says the counter
        is ready, and the dock keeps the open dock's height. */}
    {booked.tone !== "pending" && !booked.hint && <p className={styles.bookedReady} aria-hidden="true">{t.ready}</p>}
    </div>
    {/* Typed path: the next card's number goes in right here, and the field keeps the focus a handheld scanner types into. */}
    {typedNext && <form className={cx(styles.dockCode, codeRejected && styles.rejected)} onSubmit={lookup} noValidate>
      {/* Beside „Rückgängig“ the full words do not fit: the placeholder says „Kartennummer“, the name keeps them all. */}
      <input id="cashier-code" aria-label={t.manual} placeholder={booked.undo === "available" && onUndo && locale === "de" ? "Kartennummer" : t.manual} ref={focusInPlace} value={code} onChange={event => { setCode(event.target.value); if (codeRejected) onCodeEdit?.(); }} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      {/* On the typed path „Rückgängig“ stands beside the field, so the stack keeps the open dock's height. */}
      {booked.undo === "available" && onUndo && <Button variant="quiet" size="sm" icon={<Undo2 size={20} />} onClick={onUndo} disabled={busy}>{t.undo}</Button>}
    </form>}
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
        <Button {...earnLook} block className={cx("cashier-award-now", !rewardFirst && styles.book)} icon={rewardFirst ? undefined : <Check size={22} />} onClick={() => awardQuantity(card)} loading={awarding} disabled={busy && !awarding}>{awardTail ? <><NumberRoll value={awardCount}>{awardCount}</NumberRoll>{awardTail}</> : awardLabel}</Button>
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
    state={shellState} stateLabel={booked || card ? null : stateLabel} stateDetail={stateDetail} dock={dock} dockLabel={t.book} dockMinHeight={booked ? dockHold : undefined} holdTop={Boolean(dockHold && (busy || booked))} dockFloor={card && !booked ? (focusCodeInput ? TYPED_FLOOR : SCAN_FLOOR) : undefined}>
    {/* The scan state asks its question; with a card or a result on screen the heading stays for screen readers only. */}
    <h1 className={cx(styles.question, card || preview || booked ? styles.srOnly : styles.title)}>{card || booked?.card ? t.found : t.scanTitle}</h1>
    {nfcPanel}
      {/* While a booking is on its way the card's foot and the button already say so: the panel stays the same live region but takes no room, so the open card does not move. A refusal or an unclear result shows it again. */}
      {/* The open card's notice, kept in place while its booking runs and „Gebucht“ holds; already announced, so no live region. */}
      {keptNotice && <div className={cx("cashier-notice-kept", styles.outcome)} data-tone={keptNotice.status}>
        <span className={styles.outcomeIcon} aria-hidden="true"><Clock size={22} /></span>
        <span className={styles.outcomeText}><strong>{t.pending}</strong><span>{keptNotice.message}</span></span>
      </div>}
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
        title={shown.cardLocator} sub={verifiedLine} note={card ? doneNote : null} label={t.balance} locale={locale} landedFrom={booked?.card && booked.card.id === opened?.id ? opened.balance : undefined}
        foot={<>{shown ? <button type="button" className={styles.pill} onClick={() => { setConfirm(null); onClear(); }}><X size={20} aria-hidden="true" />{t.other}</button> : <span className={styles.pillSpace} aria-hidden="true" />}
          {/* While „Gebucht“ holds the dock the foot keeps its state, so the pill is not left alone (Design, 18 Nov). */}
          {/* Safety first: a card opened by its typed number says so in the foot, in view before anything is booked. */}
          {shown.matchedBy === "locator" ? <p className={cx("cashier-locator-note", styles.footNote)} role="note">{t.locatorNote}</p>
            : <span className={styles.state} data-state={appointmentDone ? "busy" : card ? shellState : "open"}><i aria-hidden="true" />{appointmentDone ? "Schon gutgeschrieben" : card ? stateLabel : t.cardOpen}</span>}</>} />
    </div>}
    {shown && !goal && <section className={styles.card} aria-labelledby="cashier-card-title">
      <div className={cx("card-result-head", styles.cardHead)}>
        <div><span className={styles.eyebrow}>{verifiedLine}</span><h2 id="cashier-card-title" className={styles.locator}>{shown.cardLocator}</h2></div>
        {card || !camera ? <Button variant="quiet" size="sm" icon={<X size={16} />} onClick={() => { setConfirm(null); onClear(); }}>{t.other}</Button> : null}
      </div>
      {doneNote}
      <div className={cx(card && "balance-display", styles.balance)}>
        <span className={styles.srOnly}>{t.balance}</span>
        <strong><NumberRoll value={shown.balance}>{number.format(shown.balance)}</NumberRoll>{"\u00a0"}<em>{unitWord(shown.balance, shown.programType, locale)}</em></strong>
        {card?.level && <span className={styles.level}>{card.level.name}</span>}
      </div>
    </section>}
    {/* Today's card (points, no reward) keeps the note right under it. */}
    {shown?.matchedBy === "locator" && !goal && <p className={cx("cashier-locator-note", styles.note, styles.pretty)} role="note">{t.locatorNote}</p>}
    {/* The balance in words for the specs; the card's figure already says it, so screen readers skip this copy. */}
    {card && goal && <div className={cx("balance-display", styles.srOnly)} aria-hidden="true">
      <strong><NumberRoll value={card.balance}>{number.format(card.balance)}</NumberRoll>{"\u00a0"}<em>{unitWord(card.balance, card.programType, locale)}</em></strong>
    </div>}
    {/* One reward and it is ready: the dock's band names and redeems it, so the row is left out and nothing sits under the
        dock (Design, 18 Nov). With several the list stays and scrolls clear of the dock. */}
    {shown && !(rowGivesWay && shown.rewards.length === 1) && <section className={styles.rewards} aria-label={t.rewards}>
      {shown.rewards.length ? <div className={cx(card && "reward-action-list", mixStyles.panel)}>
        {shown.rewards.map(reward => {
          const left = reward.cost - shown.balance, ready = card ? reward.eligible : left <= 0;
          // The one ready reward the band names and redeems: its row shows the price only, as on the closed card (Design, 19 Nov).
          const priced = ready && (!card || (rewardFirst && readyRewards.length === 1 && readyRewards[0].id === reward.id));
          const body = <>
            <span className={mixStyles.tile} data-tone={ready ? "coral" : "mute"}><Gift size={20} aria-hidden="true" /></span>
            <span className={mixStyles.body}>
              <span className={mixStyles.text}><b>{reward.name}</b><small>{ready ? withUnit(reward.cost, shown.programType, locale) : <>{t.left} <span className={card ? undefined : styles.rollDigit}>{number.format(left)}</span>{"\u00a0"}{unitWord(left, shown.programType, locale)}</>}</small></span>
              {/* A ready row on the closed card already names its price in the line; it has no „Einlösen“ there. */}
              {!priced && <span className={cx(mixStyles.val, ready && card && styles.go)}>{ready && card ? t.redeemShort : withUnit(reward.cost, shown.programType, locale)}</span>}
            </span>
          </>;
          return card && !priced ? <button type="button" key={reward.id} className={cx(mixStyles.row, styles.reward)} data-lead="tile" disabled={!reward.eligible || busy} onClick={() => setConfirm({ kind: "redeem", reward })}>{body}</button>
            : <div key={reward.id} className={mixStyles.row} data-lead="tile">{body}</div>;
        })}
      </div> : card && <p className={styles.help}>{t.noRewards}</p>}
    </section>}
    {card && winback + birthday > 0 && <p className={styles.winback} role="note">
      {winback > 0 && <strong>{locale === "fr" ? `Bon retour : +${withUnit(winback, card.programType, locale)} en plus` : winbackCashierLine(card.programType === "points" ? "points" : "stamp", winback)}</strong>}
      {birthday > 0 && <strong>{locale === "fr" ? `Anniversaire : +${withUnit(birthday, card.programType, locale)} en plus` : birthdayCashierLine(card.programType === "points" ? "points" : "stamp", birthday)}</strong>}
      <small>{WINBACK_EXCLUSIONS}</small></p>}
    {card?.level && goal && <p className={styles.note} role="note"><b>{card.level.name}</b>{card.level.perk && <> · {locale === "fr" ? "Avantage" : "Vorteil"}: {card.level.perk}</>}</p>}
    {card?.level?.perk && !goal && <p className={styles.note} role="note">{locale === "fr" ? "Avantage" : "Vorteil"}: {card.level.perk}</p>}
    {/* While „Gebucht“ holds the dock over the closed card, the camera and the scan form stay mounted and working (a
        read or a handheld scanner opens the next card at once) but out of sight, under the dock. */}
    <div className={booked?.card ? styles.srOnly : styles.contents}>{camera}</div>
    {!card && preview ? <section className={cx("cashier-preview", styles.panel)} aria-labelledby="cashier-preview-title">
      <span className={styles.eyebrow}>{t.cardFound}</span>
      <h2 id="cashier-preview-title" className={styles.locator}>{preview.cardLocator}</h2>
      <p className={styles.meta}>{preview.programName} · {locale === "fr" ? "émise" : "ausgestellt"} {previewMonth(preview.issuedAt, locale)}</p>
      <p className={styles.help}>{locale === "fr" ? "Est-ce la carte devant vous ?" : "Liegt diese Karte vor dir?"}</p>
      <div className={cx("cashier-preview-actions", styles.stack)}>
        <Button variant="primary" size="lg" block onClick={onConfirmPreview} disabled={busy} data-autofocus>{locale === "fr" ? "Ouvrir la carte" : "Karte öffnen"}</Button>
        <Button variant="quiet" size="sm" onClick={onCancelPreview} disabled={busy}>{locale === "fr" ? "Autre numéro" : "Andere Nummer"}</Button>
      </div>
    </section> : !card && !typedNext ? <section className={cx(styles.ready, booked?.card && styles.srOnly)} aria-label={t.ready}>
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
          <Button variant="primary" size="xl" block className="cashier-book" disabled={busy || !purchaseAward} onClick={bookPurchase}>{t.book}</Button>
        </div>}>
        <div className={styles.stack}>
          <TextField id="purchase-amount" label={amountLabel} type="text" inputMode="decimal" autoComplete="off" placeholder="16,70" value={purchaseAmount}
            onChange={event => setPurchaseAmount(event.target.value)} aria-describedby="purchase-preview" />
          <div id="purchase-preview" className={styles.preview} aria-live="polite">{purchasePreview
            ? <>
              <strong>{purchaseOutcome?.total}</strong>
              {purchaseOutcome?.parts && <span className={styles.previewParts}>{purchaseOutcome.parts}</span>}
              <span>{t.newBalance}: {number.format(purchaseOutcome?.balanceAfter ?? 0)}{"\u00a0"}{unitWord(purchaseOutcome?.balanceAfter ?? 0, "points", locale)}</span>
            </>
            : <span className={amountProblem ? styles.previewProblem : undefined}>{amountProblem || (locale === "fr" ? `${card.pointsPerCurrencyUnit}\u00a0point(s) par 1\u00a0${card.currency}` : `${card.pointsPerCurrencyUnit}\u00a0${card.pointsPerCurrencyUnit === 1 ? "Punkt" : "Punkte"} pro 1\u00a0${card.currency}`)}</span>}</div>
        </div>
      </Sheet>}
      {card && offlineLeaseExpiresAt && <p className={styles.footnote} role="status">{locale === "fr" ? "Tampon hors ligne préparé jusqu’à" : "Offline-Puffer bereit bis"} {new Date(offlineLeaseExpiresAt).toLocaleTimeString(locale === "fr" ? "fr-FR" : "de-DE", { hour: "2-digit", minute: "2-digit", timeZone: BERLIN })}. {locale === "fr" ? "En attente ne change pas le solde." : "Vorgemerktes ändert den Kontostand nicht."}</p>}
      {offlinePanel}
    {confirm && card && <Dialog open onClose={cancelConfirm} title={confirm.kind === "award" ? (appointmentDone ? "Trotzdem vergeben?" : t.confirmAward) : t.confirmRedeem}
      description={<>{confirm.kind === "award" && appointmentDone ? "Termin schon gutgeschrieben. " : null}{confirm.kind === "award" ? <>{"quantity" in confirm.award ? withUnit(confirm.award.quantity, card.programType, locale) : <><strong className={styles.figure}>{number.format(purchasePoints(confirm.award.purchaseAmountMinor, card.pointsPerCurrencyUnit))}{"\u00a0"}{unit}</strong> {locale === "fr" ? "pour un achat de" : "für einen Kauf über"} <strong className={styles.figure}>{formatMinor(confirm.award.purchaseAmountMinor, card.currency)}</strong></>} {t.bookFor}</> : `${confirm.reward.name} (${withUnit(confirm.reward.cost, card.programType, locale)}) ${t.redeemFor}`} <span className={styles.nowrap}>{card.cardLocator}</span>.</>}
      actions={<>
        <Button variant="secondary" onClick={cancelConfirm}>{t.cancel}</Button>
        {confirm.kind === "award" && onQueueOffline && offlineLeaseExpiresAt && <Button variant="secondary" onClick={() => { holdDock(); onQueueOffline(card, confirm.award); setConfirm(null); }} disabled={busy}>{locale === "fr" ? "Mettre l’ajout hors ligne en attente" : "Offline-Vergabe vormerken"}</Button>}
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
  // Opened from the owner's „Kasse“ link the frame already names the location, so the sliding sheet's head does not change.
  const location = useKasseLocation("Kasse");
  const { stage: wait, since } = useWaitStage(loading);
  // One layout from the slide to the form (Design, 18 Nov): the sheet lands on the scan form's own still shape; 300 ms
  // after the slide the live strip says „Einen Moment …“ above the same shape; the form then replaces it in place. Only a
  // long wait shows the words panel below.
  if (loading) return <CashierShell lang="de" live={false} location={<span className="cashier-location">{location}</span>} state="busy" actions={<span className={styles.phKey} aria-hidden="true" />}
    stateLabel="Einen Moment …" placeholder={wait === "quiet" ? true : wait === "long" ? "empty" : false}>
    <section className={cx("cashier-placeholder", styles.phMain)} aria-busy="true" aria-label="Kassenzugang wird geprüft" data-since={since === undefined ? undefined : Math.round(since)}>
      <h1 className={cx(styles.title, wait === "long" && styles.covered)} aria-hidden="true"><span className={styles.phLine}>Karte scannen. Dann entscheiden.</span></h1>
      <div className={cx(styles.ready, wait === "long" && styles.covered)} aria-hidden="true">
        <span className={styles.phButton} />
        <div className={styles.phField}><span className={styles.phLabel} /><span className={styles.phInput} /><span className={styles.phHint} /></div>
        <span className={cx(styles.phButton, styles.phQuiet)} />
        <span className={styles.phHelp} />
      </div>
      {/* After LONG_MS the one waiting message fades in over the same shape; the strip keeps its slot, empty. */}
      {wait === "long" && <div className={cx("app-state-card", styles.access, styles.accessLate, styles.accessOver)}>
        <h1>Kassenzugang wird geprüft</h1>
        <p>Dein Standort und deine Berechtigung werden geladen.</p>
      </div>}
    </section>
  </CashierShell>;
  return <CashierShell lang="de" live={false} location={<span className="cashier-location">Kasse</span>} state="error" stateLabel="Kein Zugang">
    <section className={cx("app-state-card", styles.access)}>
      <h1>Zugang gesperrt oder nicht eingerichtet</h1>
      <p>{message}</p>
      <div className={styles.stack}>
        <a href="/login" className={buttonClassName({ variant: "primary", size: "lg", block: true })}>Zur Anmeldung</a>
        {logoutControl}
      </div>
    </section>
  </CashierShell>;
}

/**
 * Waiting stages of the access check, counted from the first waiting frame (the route's loading frame or the page's):
 * quiet until the slide (260 ms) plus 300 ms, then the strip's words; past LONG_MS the words panel.
 * LONG_MS: Design confirmed 3 s (18 Nov); the words panel fades in over --dur-ui when it comes.
 */
const LATE_MS = 560;
const LONG_MS = 3_000;
let waitingSince = 0;
function useWaitStage(waiting: boolean) {
  const [stage, setStage] = useState<"quiet" | "late" | "long">("quiet");
  const [since, setSince] = useState<number>();
  useEffect(() => {
    if (!waiting) { waitingSince = 0; return; }
    const now = performance.now();
    if (!waitingSince || now - waitingSince > 10_000) waitingSince = now;
    const passed = now - waitingSince, start = waitingSince;
    // The frame carries its clock's start (data-since), which the waiting spec measures from.
    const arm = setTimeout(() => setSince(start), 0);
    const late = setTimeout(() => setStage(current => current === "quiet" ? "late" : current), Math.max(0, LATE_MS - passed));
    const long = setTimeout(() => setStage("long"), Math.max(0, LONG_MS - passed));
    return () => { clearTimeout(arm); clearTimeout(late); clearTimeout(long); };
  }, [waiting]);
  return { stage, since };
}

/**
 * The reward the Kasse's card counts to (Design, 18 Nov): the cheapest one the balance has not reached yet; once every
 * reward is reached, the largest (the card then reads the true count, „9 Stempel“). A ready reward below it is redeemed
 * from the band and the list. One reward: that reward.
 */
export function kasseGoal(card: Pick<CashierCard, "balance" | "rewards">) {
  if (!card.rewards.length) return undefined;
  const byCost = [...card.rewards].sort((a, b) => a.cost - b.cost);
  return byCost.find(reward => reward.cost > card.balance) ?? byCost[byCost.length - 1];
}
