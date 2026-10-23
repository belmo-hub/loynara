"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { quantityPickerMax, type StaffRole } from "@/lib/award-limits";
import { parsePurchaseAmountMinor, PointsError, purchasePoints } from "@/lib/points";
import { Check, Clock, Menu, Minus, Plus, ScanLine, ShieldAlert, Undo2, WifiOff, X } from "lucide-react";
import type { ProgramType, UiLocale } from "@/components/loyalty-ui";
import { Button, buttonClassName } from "@/components/ui/button";
import { CashierShell, type CashierState } from "@/components/ui/cashier-shell";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { NumberRoll } from "@/components/ui/number-roll";
import { PointsLadder } from "@/components/ui/points-ladder";
import { Sheet } from "@/components/ui/sheet";
import { STAMP_GRID_MAX, StampGrid } from "@/components/ui/stamp-grid";
import { birthdayCashierLine, WINBACK_EXCLUSIONS, winbackCashierLine } from "@/lib/wallet-message-rules";
import styles from "./cashier-view.module.css";

export type CashierReward = { id: string; name: string; cost: number; eligible: boolean };
export type CashierAward = { quantity: number } | { purchaseAmountMinor: number; ruleVersionId: string };
export type CashierCard = { id: string; code: string; cardLocator: string; matchedBy?: "code" | "locator"; balance: number; programType: ProgramType; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; currency: "EUR" | "MAD"; ruleVersionId: string; rewards: CashierReward[]; /** Bonuses booked with the next award: win-back (ENG-044), birthday (ENG-049); 0 = none. */ winbackBonus?: number; birthdayBonus?: number; level?: { name: string; perk?: string } };
export type CashierBooked = { tone: "success" | "pending" | "undone"; title: string; headline?: string; detail: string; meta?: string; hint?: string; undo?: "available" | "staff-only"; error?: string };
export type CashierViewProps = {
  locationName: string;
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
  onLookup: (code: string) => void | Promise<void>;
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

function previewMonth(isoMonth: string, locale: UiLocale) {
  const [year, month] = isoMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale === "fr" ? "fr-FR" : "de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function CashierView({ locationName, card, preview, booked, onUndo, onConfirmPreview, onCancelPreview, busy = false, status = "idle", message, onLookup, focusCodeInput = false, camera, nfcPanel, resetToken = 0, onStartCamera, onAward, onRedeem, onQueueOffline, offlineLeaseExpiresAt, offlinePanel, onClear, locale = "de", onLocaleChange, showOverview = true, role, logoutControl }: CashierViewProps) {
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const maxQuantity = quantityPickerMax(role);
  const [purchaseAmount, setPurchaseAmount] = useState("");
  // Points shops: the amount is typed in a bottom sheet, next to the keyboard and the thumb.
  const [amountOpen, setAmountOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "award"; award: CashierAward } | { kind: "redeem"; reward: CashierReward } | null>(null);
  // Each card (and each booking) starts from a clean form. Reset during render instead of remounting the view, which
  // would also restart the counter camera.
  const formKey = `${card?.id ?? (preview ? "preview" : "empty")}:${resetToken}`;
  const [seenFormKey, setSeenFormKey] = useState(formKey);
  if (seenFormKey !== formKey) {
    setSeenFormKey(formKey);
    setQuantity(1); setPurchaseAmount(""); setConfirm(null); setAmountOpen(false);
    if (card || preview) setCode("");
  }
  const t = locale === "fr" ? {
    overview: "Vue d’ensemble", menu: "Menu : langue et déconnexion", found: "Carte trouvée.", scanTitle: "Scanner la carte. Puis décider.", success: "Enregistré", pending: "En attente", offline: "Hors connexion", rejected: "Impossible", ready: "Prêt pour la prochaine carte", scanHelp: "Présentez le QR code à la caméra.", camera: "Ouvrir la caméra", manual: "Numéro ou code de la carte", codeHint: "Sous le QR code de la carte.", check: "Vérifier", cameraFallback: "Sans caméra : saisissez le numéro.", verified: "Carte vérifiée", other: "Autre carte", balance: "Solde actuel", stamps: "tampons", points: "points", decrease: "Diminuer la quantité", increase: "Augmenter la quantité", enterAmount: "Saisir le montant", book: "Enregistrer", newBalance: "Nouveau solde", amountInvalid: "Vérifiez le montant, p. ex. 16,70.", noPoints: "Trop faible pour un point.", redeem: "Utiliser une récompense", rewards: "Récompenses", redeemShort: "Utiliser", still: "encore", noRewards: "Aucune récompense pour cette carte.", undo: "Annuler l’opération", undoStaff: "Erreur ? La direction peut corriger.", locatorNote: "Ouverte sans scan : récompense seulement pour sa propre carte.", offlineNote: "Pas de connexion. En attente ne compte qu’après la synchronisation.", confirmAward: "Confirmer l’ajout ?", confirmRedeem: "Confirmer la récompense ?", bookFor: "à ajouter à la carte", redeemFor: "à utiliser sur la carte", cancel: "Annuler", yesAward: "Oui, ajouter", yesRedeem: "Oui, utiliser", working: "Un instant …", cardOpen: "Carte ouverte", cardCheck: "Vérifier la carte", cardFound: "Carte trouvée",
  } : {
    overview: "Zur Übersicht", menu: "Menü: Sprache und Abmelden", found: "Karte gefunden.", scanTitle: "Karte scannen. Dann entscheiden.", success: "Gebucht", pending: "Ausstehend", offline: "Keine Verbindung", rejected: "Nicht möglich", ready: "Bereit für die nächste Karte", scanHelp: "QR-Code in die Kamera halten.", camera: "Kamera öffnen", manual: "Kartennummer oder Kartencode", codeHint: "Steht unter dem QR-Code.", check: "Prüfen", cameraFallback: "Ohne Kamera: Kartennummer eingeben.", verified: "Geprüfte Karte", other: "Andere Karte", balance: "Aktueller Kontostand", stamps: "Stempel", points: "Punkte", decrease: "Menge verringern", increase: "Menge erhöhen", enterAmount: "Kaufbetrag eingeben", book: "Buchen", newBalance: "Neuer Stand", amountInvalid: "Betrag prüfen, z. B. 16,70.", noPoints: "Zu klein für einen Punkt.", redeem: "Prämie einlösen", rewards: "Prämien", redeemShort: "Einlösen", still: "noch", noRewards: "Für diese Karte ist keine Prämie eingerichtet.", undo: "Rückgängig", undoStaff: "Falsch? Die Leitung kann es korrigieren.", locatorNote: "Ohne Scan geöffnet: Prämie nur für die eigene Karte.", offlineNote: "Keine Verbindung. Vorgemerkt zählt erst nach dem Abgleich.", confirmAward: "Vergabe bestätigen?", confirmRedeem: "Einlösung bestätigen?", bookFor: "für Karte", redeemFor: "auf Karte", cancel: "Abbrechen", yesAward: "Ja, vergeben", yesRedeem: "Ja, einlösen", working: "Einen Moment …", cardOpen: "Karte offen", cardCheck: "Karte prüfen", cardFound: "Karte gefunden",
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
  function lookup(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const value = code.trim(); if (!value) return; if (value.startsWith("sc_")) setCode(""); onLookup(value); }
  // One stamp is booked with one tap: the scan identified the card and this button is the deliberate decision. More
  // than one, or a choice between online and offline booking, still goes through the confirmation dialog. Points are
  // booked from the amount sheet, whose „Buchen“ is that decision, after the preview of points and new balance.
  const offlineChoice = Boolean(onQueueOffline && offlineLeaseExpiresAt);
  const awardCount = Math.min(quantity, maxQuantity);
  const singleUnit = card?.programType === "points" ? locale === "fr" ? "point" : "Punkt" : locale === "fr" ? "tampon" : "Stempel";
  const winback = card?.winbackBonus ?? 0, birthday = card?.birthdayBonus ?? 0;
  const awardLabel = winback + birthday > 0
    ? `${awardCount === 1 ? `1 ${singleUnit}` : `${awardCount} ${unit}`} + ${winback + birthday} ${locale === "fr" ? "en plus" : "extra"}`
    : awardCount === 1 && !offlineChoice
      ? locale === "fr" ? `Ajouter 1 ${singleUnit}` : `1 ${singleUnit} vergeben`
      : locale === "fr" ? `Vérifier ${awardCount === 1 ? `1 ${singleUnit}` : `${awardCount} ${unit}`}` : `${awardCount === 1 ? `1 ${singleUnit}` : `${awardCount} ${unit}`} prüfen`;
  function awardQuantity(selected: CashierCard) {
    const award = { quantity: awardCount };
    if (awardCount === 1 && !offlineChoice) onAward(selected, award);
    else setConfirm({ kind: "award", award });
  }
  const purchaseAward = purchaseMode && purchasePreview ? { purchaseAmountMinor: purchasePreview.amountMinor, ruleVersionId: card.ruleVersionId } : null;
  // The sheet closes on the tap, so the outcome (or an error) shows on the counter; the amount stays for a retry.
  function bookPurchase(offline: boolean) {
    if (!card || !purchaseAward) return;
    setAmountOpen(false);
    if (offline) onQueueOffline?.(card, purchaseAward); else onAward(card, purchaseAward);
  }
  // A card with a reward ready leads with redeeming; with several ready, the choice is the reward list on the card.
  const readyRewards = card?.rewards.filter(reward => reward.eligible) ?? [];
  const rewardFirst = readyRewards.length > 0;
  function redeemReady() {
    if (readyRewards.length === 1) { setConfirm({ kind: "redeem", reward: readyRewards[0] }); return; }
    const first = document.querySelector<HTMLButtonElement>(".reward-action-list button:not(:disabled)");
    first?.scrollIntoView({ block: "center" }); first?.focus();
  }
  function submitConfirmed() { if (!card || !confirm) return; if (confirm.kind === "award") onAward(card, confirm.award); else onRedeem(card, confirm.reward); setConfirm(null); }

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

  // Progress towards the cheapest reward; long programmes (more than STAMP_GRID_MAX stamps) show the number only.
  const cheapest = card && card.programType !== "points" && card.rewards.length ? Math.min(...card.rewards.map(reward => reward.cost)) : 0;
  const stampGoal = cheapest > 0 && cheapest <= STAMP_GRID_MAX ? cheapest : 0;
  // Bottom of the dock = the one primary action in thumb reach: redeeming when a reward is ready, otherwise earning.
  const earnLook = rewardFirst ? { variant: "secondary" as const, size: "lg" as const } : { variant: "go" as const, size: "xl" as const };
  const dock = card ? <>
    {purchaseMode
      ? <Button {...earnLook} block disabled={busy}
        // Opened and focused inside the tap, so phones raise the number keyboard at once.
        onClick={() => { flushSync(() => setAmountOpen(true)); document.getElementById("purchase-amount")?.focus(); }}>{t.enterAmount}</Button>
      : <>
        <div className={cx("quantity-row", styles.stepper)}>
          <Button variant="secondary" size="lg" className={styles.step} aria-label={t.decrease} onClick={() => setQuantity(q => Math.max(1, q - 1))} disabled={quantity <= 1 || busy}><Minus size={22} aria-hidden="true" /></Button>
          <output aria-live="polite">{quantity}</output>
          <Button variant="secondary" size="lg" className={styles.step} aria-label={t.increase} onClick={() => setQuantity(q => Math.min(maxQuantity, q + 1))} disabled={quantity >= maxQuantity || busy}><Plus size={22} aria-hidden="true" /></Button>
        </div>
        <Button {...earnLook} block className="cashier-award-now" onClick={() => awardQuantity(card)} disabled={busy}>{awardLabel}</Button>
      </>}
    {rewardFirst && <Button variant="go" size="xl" block className="cashier-redeem-now" onClick={redeemReady} disabled={busy}>{t.redeem}</Button>}
  </> : undefined;

  // The strip mirrors the state; the outcome panels below announce it, so the strip is not a second live region.
  return <CashierShell lang={locale} live={false} location={<span className="cashier-location">{locationName}</span>} actions={headerActions}
    state={shellState} stateLabel={stateLabel} stateDetail={stateDetail} dock={dock}>
    {/* The status strip says where the counter is; the heading stays for screen readers and page structure. */}
    <h1 className={styles.srOnly}>{card ? t.found : t.scanTitle}</h1>
    {nfcPanel}
      {status !== "idle" && !booked && <div className={cx(`cashier-status cashier-status--${status}`, styles.outcome)} data-tone={status} role="status" aria-live="polite">
        <span className={styles.outcomeIcon} aria-hidden="true">{status === "success" ? <Check size={22} /> : status === "offline" ? <WifiOff size={22} /> : status === "pending" ? <Clock size={22} /> : <ShieldAlert size={22} />}</span>
        <span className={styles.outcomeText}><strong>{status === "success" ? t.success : status === "pending" ? t.pending : status === "offline" ? t.offline : t.rejected}</strong>{message && <span>{message}</span>}</span>
      </div>}
      {/* After a booking the result owns the top of the screen, readable from arm's length: what was booked, the new balance. */}
      {booked && <section key={resetToken} className={cx(`cashier-booked cashier-booked--${booked.tone}`, styles.booked)} data-tone={booked.tone} role="status" aria-live="polite">
        <span className={styles.bookedIcon} aria-hidden="true">{booked.tone === "success" ? <Check size={36} strokeWidth={3} /> : booked.tone === "undone" ? <Undo2 size={32} /> : <Clock size={32} />}</span>
        <h2>{booked.title}</h2>
        {booked.headline && <p className={styles.bookedHeadline}>{booked.headline}</p>}
        <p className={styles.bookedDetail}>{booked.detail}</p>
        {booked.meta && <p className={styles.bookedMeta}>{booked.meta}</p>}
        {booked.hint && <p className={styles.bookedHint}>{booked.hint}</p>}
        {booked.error && <p className={styles.bookedError} role="alert">{booked.error}</p>}
        {booked.undo === "staff-only" && <p className={styles.bookedMeta}>{t.undoStaff}</p>}
        {(booked.undo === "available" && onUndo || !camera) && <div className={styles.bookedActions}>
          {booked.undo === "available" && onUndo && <Button variant="quiet" size="lg" icon={<Undo2 size={20} />} onClick={onUndo} disabled={busy}>{t.undo}</Button>}
          {!camera && <Button variant="secondary" size="lg" onClick={onClear}>{t.other}</Button>}
        </div>}
      </section>}
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
      <form className={styles.stack} onSubmit={lookup}>
        <TextField id="cashier-code" label={t.manual} hint={t.codeHint}
          autoFocus={focusCodeInput} value={code} onChange={event => setCode(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          placeholder={locale === "fr" ? "p. ex. K-7QX2MA" : "z. B. K-7QX2MA"} required />
        <Button type="submit" variant={camera || onStartCamera ? "secondary" : "primary"} size="lg" block disabled={busy}>{t.check}</Button>
      </form>
      <p className={styles.help}>{camera ? t.scanHelp : t.cameraFallback}</p>
    </section> : <section className={styles.card} aria-labelledby="cashier-card-title">
      <div className={cx("card-result-head", styles.cardHead)}>
        <div>
          <span className={styles.eyebrow}>{t.verified}</span>
          <h2 id="cashier-card-title" className={styles.locator}>{card.cardLocator}</h2>
        </div>
        <Button variant="quiet" size="sm" icon={<X size={18} />} onClick={() => { setConfirm(null); onClear(); }}>{t.other}</Button>
      </div>
      {card.matchedBy === "locator" && <p className={styles.note} role="note">{t.locatorNote}</p>}
      {winback + birthday > 0 && <p className={styles.winback} role="note">
        {winback > 0 && <strong>{locale === "fr" ? `Bon retour : +${winback} ${unit} en plus` : winbackCashierLine(card.programType === "points" ? "points" : "stamp", winback)}</strong>}
        {birthday > 0 && <strong>{locale === "fr" ? `Anniversaire : +${birthday} ${unit} en plus` : birthdayCashierLine(card.programType === "points" ? "points" : "stamp", birthday)}</strong>}
        <small>{WINBACK_EXCLUSIONS}</small></p>}
      <div className={cx("balance-display", styles.balance)}>
        <span>{t.balance}</span>
        <strong><NumberRoll value={card.balance}>{number.format(card.balance)}</NumberRoll> <em>{unit}</em></strong>
      </div>
      {card.level && <p className={styles.note} role="note"><strong>{card.level.name}</strong>{card.level.perk ? ` · ${locale === "fr" ? "Avantage" : "Vorteil"}: ${card.level.perk}` : ""}</p>}
      {card.programType === "points"
        ? card.rewards.length > 0 && <PointsLadder balance={card.balance} rewards={card.rewards.map(reward => ({ title: reward.name, cost: reward.cost }))} locale={locale} />
        : stampGoal > 0 && <StampGrid earned={Math.min(card.balance, stampGoal)} total={stampGoal} locale={locale} size="sm" className={styles.stamps} />}
      {purchaseMode && <Sheet open={amountOpen} onClose={() => setAmountOpen(false)} side="bottom" title={t.enterAmount} closeLabel={locale === "fr" ? "Fermer" : "Schließen"}
        footer={<div className={styles.stack}>
          {offlineChoice && <Button variant="secondary" size="lg" block disabled={busy || !purchaseAward} onClick={() => bookPurchase(true)}>{locale === "fr" ? "Mettre l’ajout hors ligne en attente" : "Offline-Vergabe vormerken"}</Button>}
          <Button variant="go" size="xl" block className="cashier-book" disabled={busy || !purchaseAward} onClick={() => bookPurchase(false)}>{t.book}</Button>
        </div>}>
        <div className={styles.stack}>
          <TextField id="purchase-amount" label={amountLabel} type="text" inputMode="decimal" autoComplete="off" placeholder="16,70" value={purchaseAmount}
            onChange={event => setPurchaseAmount(event.target.value)} aria-describedby="purchase-preview" />
          <div id="purchase-preview" className={styles.preview} aria-live="polite">{purchasePreview
            ? <>
              <strong>+{number.format(purchasePreview.points)} {t.points}{winback + birthday > 0 ? ` + ${winback + birthday} extra` : ""}</strong>
              <span>{t.newBalance}: {number.format(card.balance + purchasePreview.points + winback + birthday)} {t.points}</span>
            </>
            : <span className={amountProblem ? styles.previewProblem : undefined}>{amountProblem || (locale === "fr" ? `${card.pointsPerCurrencyUnit} point(s) par 1 ${card.currency}` : `${card.pointsPerCurrencyUnit} ${card.pointsPerCurrencyUnit === 1 ? "Punkt" : "Punkte"} pro 1 ${card.currency}`)}</span>}</div>
          {offlineChoice && <p className={styles.note} role="note">{t.offlineNote}</p>}
        </div>
      </Sheet>}
      <div className={styles.rewards}>
        <h3>{t.rewards}</h3>
        {card.rewards.length ? <div className={cx("reward-action-list", styles.rewardList)}>
          {card.rewards.map(reward => <button type="button" key={reward.id} className={styles.reward} disabled={!reward.eligible || busy} onClick={() => setConfirm({ kind: "redeem", reward })}>
            <span><strong>{reward.name}</strong><small>{reward.cost} {unit}</small></span>
            <span className={styles.rewardAction}>{reward.eligible ? t.redeemShort : `${t.still} ${number.format(reward.cost - card.balance)}`}</span>
          </button>)}
        </div> : <p className={styles.help}>{t.noRewards}</p>}
      </div>
    </section>}
      {card && offlineLeaseExpiresAt && <p className={styles.footnote} role="status">{locale === "fr" ? "Tampon hors ligne préparé jusqu’à" : "Offline-Puffer bereit bis"} {new Date(offlineLeaseExpiresAt).toLocaleTimeString(locale === "fr" ? "fr-FR" : "de-DE", { hour: "2-digit", minute: "2-digit" })}. {locale === "fr" ? "En attente ne change pas le solde." : "Vorgemerktes ändert den Kontostand nicht."}</p>}
      {offlinePanel}
    {confirm && card && <Dialog open onClose={() => setConfirm(null)} title={confirm.kind === "award" ? t.confirmAward : t.confirmRedeem}
      description={confirm.kind === "award" ? `${"quantity" in confirm.award ? `${confirm.award.quantity} ${unit}` : `${number.format(purchasePoints(confirm.award.purchaseAmountMinor, card.pointsPerCurrencyUnit))} ${unit} ${locale === "fr" ? "pour un achat de" : "für einen Kauf über"} ${number.format(confirm.award.purchaseAmountMinor / 100)} ${card.currency}`} ${t.bookFor} ${card.cardLocator}.` : `${confirm.reward.name} (${confirm.reward.cost} ${unit}) ${t.redeemFor} ${card.cardLocator}.`}
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
