"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { quantityPickerMax, type StaffRole } from "@/lib/award-limits";
import { parsePurchaseAmountMinor, purchasePoints } from "@/lib/points";
import { ArrowRight, Check, Clock, Minus, Plus, ScanLine, ShieldAlert, ShieldCheck, WifiOff, X } from "lucide-react";
import type { ProgramType, UiLocale } from "@/components/loyalty-ui";
import { Button, buttonClassName } from "@/components/ui/button";
import { CashierShell, type CashierState } from "@/components/ui/cashier-shell";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { PointsLadder } from "@/components/ui/points-ladder";
import { StampGrid } from "@/components/ui/stamp-grid";
import styles from "./cashier-view.module.css";

export type CashierReward = { id: string; name: string; cost: number; eligible: boolean };
export type CashierAward = { quantity: number } | { purchaseAmountMinor: number; ruleVersionId: string };
export type CashierCard = { id: string; code: string; cardLocator: string; matchedBy?: "code" | "locator"; balance: number; programType: ProgramType; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; currency: "EUR" | "MAD"; ruleVersionId: string; rewards: CashierReward[] };
export type CashierViewProps = {
  locationName: string;
  card?: CashierCard | null;
  /** Minimal result for a typed card number; the card is opened only after the cashier confirms it. */
  preview?: { cardLocator: string; programName: string; issuedAt: string } | null;
  /**
   * Shown right after a booking, above the scan form: the card is already closed, so nothing on it can be tapped again,
   * and the next card can be scanned at once.
   */
  booked?: { tone: "success" | "pending"; title: string; detail: string; hint?: string } | null;
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

export function CashierView({ locationName, card, preview, booked, onConfirmPreview, onCancelPreview, busy = false, status = "idle", message, onLookup, focusCodeInput = false, camera, nfcPanel, resetToken = 0, onStartCamera, onAward, onRedeem, onQueueOffline, offlineLeaseExpiresAt, offlinePanel, onClear, locale = "de", onLocaleChange, showOverview = true, role, logoutControl }: CashierViewProps) {
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const maxQuantity = quantityPickerMax(role);
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [confirm, setConfirm] = useState<{ kind: "award"; award: CashierAward } | { kind: "redeem"; reward: CashierReward } | null>(null);
  // Each card (and each booking) starts from a clean form. Reset during render instead of remounting the view, which
  // would also restart the counter camera.
  const formKey = `${card?.id ?? (preview ? "preview" : "empty")}:${resetToken}`;
  const [seenFormKey, setSeenFormKey] = useState(formKey);
  if (seenFormKey !== formKey) {
    setSeenFormKey(formKey);
    setQuantity(1); setPurchaseAmount(""); setConfirm(null);
    if (card || preview) setCode("");
  }
  const t = locale === "fr" ? {
    overview: "Vue d’ensemble", mode: "MODE CAISSE", found: "Carte trouvée.", scanTitle: "Scanner la carte. Puis décider.", foundIntro: "Vérifiez le solde et confirmez chaque opération.", scanIntro: "Le scan identifie seulement la carte. Aucune opération n’est enregistrée automatiquement.", success: "Enregistré", pending: "En attente", offline: "Hors connexion", rejected: "Impossible", ready: "Prêt pour la prochaine carte", scanHelp: "Présentez le QR code à la caméra ou saisissez le numéro de la carte.", camera: "Ouvrir la caméra", manual: "Numéro ou code de la carte", check: "Vérifier", cameraFallback: "Caméra indisponible ? Le numéro de carte fonctionne aussi sans caméra.", verified: "Carte vérifiée", other: "Autre carte", balance: "Solde actuel", stamps: "tampons", points: "points", award: "Ajouter", awardHint: "Un tampon s’ajoute d’un seul geste. Pour davantage, augmentez la quantité ; vous confirmerez ensuite.", decrease: "Diminuer la quantité", increase: "Augmenter la quantité", reviewAward: "Vérifier l’ajout", redeem: "Utiliser une récompense", review: "Vérifier →", unavailable: "Indisponible", noRewards: "Aucune récompense n’est configurée pour cette carte.", footnote: "Une connexion est nécessaire pour utiliser une récompense. Le serveur confirme les opérations.", confirmAward: "Confirmer l’ajout ?", confirmRedeem: "Confirmer la récompense ?", bookFor: "à ajouter à la carte", redeemFor: "à utiliser sur la carte", cancel: "Annuler", yesAward: "Oui, ajouter", yesRedeem: "Oui, utiliser", working: "Un instant …", cardOpen: "Carte ouverte", cardCheck: "Vérifier la carte", cardFound: "Carte trouvée",
  } : {
    overview: "Zur Übersicht", mode: "KASSENMODUS", found: "Karte gefunden.", scanTitle: "Karte scannen. Dann entscheiden.", foundIntro: "Prüfe den Kontostand und bestätige jeden Vorgang bewusst.", scanIntro: "Ein Scan identifiziert nur die Karte. Es wird nichts automatisch gebucht.", success: "Gebucht", pending: "Ausstehend", offline: "Keine Verbindung", rejected: "Nicht möglich", ready: "Bereit für die nächste Karte", scanHelp: "Halte den QR-Code in die Kamera oder gib die Kartennummer ein.", camera: "Kamera öffnen", manual: "Kartennummer oder Kartencode", check: "Prüfen", cameraFallback: "Kamera nicht verfügbar? Die Kartennummer funktioniert auch ohne Kamerafreigabe.", verified: "Geprüfte Karte", other: "Andere Karte", balance: "Aktueller Kontostand", stamps: "Stempel", points: "Punkte", award: "vergeben", awardHint: "Ein Stempel wird mit einem Tippen gebucht. Für mehr die Menge erhöhen; das bestätigst du dann.", decrease: "Menge verringern", increase: "Menge erhöhen", reviewAward: "Vergabe prüfen", redeem: "Prämie einlösen", review: "Prüfen →", unavailable: "Nicht verfügbar", noRewards: "Für diese Karte ist keine Prämie eingerichtet.", footnote: "Einlösungen brauchen eine Verbindung. Buchungen werden vom Server bestätigt.", confirmAward: "Vergabe bestätigen?", confirmRedeem: "Einlösung bestätigen?", bookFor: "für Karte", redeemFor: "auf Karte", cancel: "Abbrechen", yesAward: "Ja, vergeben", yesRedeem: "Ja, einlösen", working: "Einen Moment …", cardOpen: "Karte offen", cardCheck: "Karte prüfen", cardFound: "Karte gefunden",
  };
  const unit = card?.programType === "points" ? t.points : t.stamps;
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const purchaseMode = card?.programType === "points" && card.earningMode === "purchase";
  let purchasePreview: { amountMinor: number; points: number } | null = null;
  if (purchaseMode) {
    try {
      const amountMinor = parsePurchaseAmountMinor(purchaseAmount);
      purchasePreview = { amountMinor, points: purchasePoints(amountMinor, card.pointsPerCurrencyUnit) };
    } catch { purchasePreview = null; }
  }
  const amountLabel = locale === "fr" ? `Montant de l’achat (${card?.currency ?? "EUR"})` : `Kaufbetrag (${card?.currency ?? "EUR"})`;
  // A handheld scanner types the QR content into the field; do not leave that code on screen after submitting it.
  function lookup(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const value = code.trim(); if (!value) return; if (value.startsWith("sc_")) setCode(""); onLookup(value); }
  // One stamp is booked with one tap: the scan identified the card and this button is the deliberate decision. More
  // than one, or a choice between online and offline booking, still goes through the confirmation dialog.
  const offlineChoice = Boolean(onQueueOffline && offlineLeaseExpiresAt);
  const awardCount = Math.min(quantity, maxQuantity);
  const singleUnit = card?.programType === "points" ? locale === "fr" ? "point" : "Punkt" : locale === "fr" ? "tampon" : "Stempel";
  const awardLabel = awardCount === 1 && !offlineChoice
    ? locale === "fr" ? `Ajouter 1 ${singleUnit}` : `1 ${singleUnit} vergeben`
    : locale === "fr" ? `Vérifier ${awardCount === 1 ? `1 ${singleUnit}` : `${awardCount} ${unit}`}` : `${awardCount === 1 ? `1 ${singleUnit}` : `${awardCount} ${unit}`} prüfen`;
  function awardQuantity(selected: CashierCard) {
    const award = { quantity: awardCount };
    if (awardCount === 1 && !offlineChoice) onAward(selected, award);
    else setConfirm({ kind: "award", award });
  }
  function submitConfirmed() { if (!card || !confirm) return; if (confirm.kind === "award") onAward(card, confirm.award); else onRedeem(card, confirm.reward); setConfirm(null); }

  const shellState: CashierState = booked ? booked.tone === "success" ? "done" : "busy"
    : status === "rejected" || status === "offline" ? "error"
      : status === "pending" || busy ? "busy"
        : card || preview ? "open" : "ready";
  const stateLabel = booked ? booked.title
    : status === "rejected" ? t.rejected : status === "offline" ? t.offline : status === "pending" ? t.pending : busy ? t.working
      : card ? t.cardOpen : preview ? t.cardCheck : t.ready;
  const stateDetail = booked || status === "rejected" || status === "offline" ? undefined : card?.cardLocator ?? preview?.cardLocator;
  const headerActions = <div className={styles.headerActions}>
    {onLocaleChange && <select className={styles.locale} aria-label={locale === "fr" ? "Langue" : "Sprache"} value={locale} onChange={event => onLocaleChange(event.target.value as UiLocale)}>
      <option value="de">DE</option>
      <option value="fr">FR</option>
    </select>}
    {showOverview && <Link href="/merchant" className={buttonClassName({ variant: "quiet", size: "sm" })}>{t.overview}</Link>}
    {logoutControl}
  </div>;

  // Progress towards the cheapest reward; long programmes (more than 30 stamps) show the number only.
  const cheapest = card && card.programType !== "points" && card.rewards.length ? Math.min(...card.rewards.map(reward => reward.cost)) : 0;
  const stampGoal = cheapest > 0 && cheapest <= 30 ? cheapest : 0;
  const dock = card ? purchaseMode
    ? <Button variant="go" size="xl" block icon={<ArrowRight size={20} />} disabled={busy || !purchasePreview}
      onClick={() => { if (purchasePreview) setConfirm({ kind: "award", award: { purchaseAmountMinor: purchasePreview.amountMinor, ruleVersionId: card.ruleVersionId } }); }}>{t.reviewAward}</Button>
    : <>
      <div className={cx("quantity-row", styles.stepper)}>
        <Button variant="secondary" size="lg" className={styles.step} aria-label={t.decrease} onClick={() => setQuantity(q => Math.max(1, q - 1))} disabled={quantity <= 1 || busy}><Minus size={22} aria-hidden="true" /></Button>
        <output aria-live="polite">{quantity}</output>
        <Button variant="secondary" size="lg" className={styles.step} aria-label={t.increase} onClick={() => setQuantity(q => Math.min(maxQuantity, q + 1))} disabled={quantity >= maxQuantity || busy}><Plus size={22} aria-hidden="true" /></Button>
      </div>
      <Button variant="go" size="xl" block className="cashier-award-now" onClick={() => awardQuantity(card)} disabled={busy}>{awardLabel}</Button>
    </> : undefined;

  // The strip mirrors the state; the outcome panels below announce it, so the strip is not a second live region.
  return <CashierShell lang={locale} live={false} location={<span className="cashier-location">{locationName}</span>} actions={headerActions}
    state={shellState} stateLabel={stateLabel} stateDetail={stateDetail} dock={dock}>
    <div className={styles.intro}>
      <h1>{card ? t.found : t.scanTitle}</h1>
      <p>{card ? t.foundIntro : t.scanIntro}</p>
    </div>
    {nfcPanel}
      {status !== "idle" && !booked && <div className={cx(`cashier-status cashier-status--${status}`, styles.outcome)} data-tone={status} role="status" aria-live="polite">
        <span className={styles.outcomeIcon} aria-hidden="true">{status === "success" ? <Check size={22} /> : status === "offline" ? <WifiOff size={22} /> : status === "pending" ? <Clock size={22} /> : <ShieldAlert size={22} />}</span>
        <span className={styles.outcomeText}><strong>{status === "success" ? t.success : status === "pending" ? t.pending : status === "offline" ? t.offline : t.rejected}</strong>{message && <span>{message}</span>}</span>
      </div>}
      {booked && <section key={resetToken} className={cx(`cashier-booked cashier-booked--${booked.tone}`, styles.booked)} data-tone={booked.tone} role="status" aria-live="polite">
        <span className={styles.outcomeIcon} aria-hidden="true">{booked.tone === "success" ? <Check size={24} /> : <Clock size={24} />}</span>
        <div className={styles.outcomeText}>
          <h2>{booked.title}</h2>
          <p>{booked.detail}</p>
          {booked.hint && <p className={styles.bookedHint}>{booked.hint}</p>}
        </div>
        {!camera && <Button variant="secondary" size="lg" block className={styles.bookedAction} onClick={onClear}>{t.other}</Button>}
      </section>}
    {camera}
    {!card && preview ? <section className={cx("cashier-preview", styles.panel)} aria-labelledby="cashier-preview-title">
      <span className={styles.eyebrow}>{t.cardFound}</span>
      <h2 id="cashier-preview-title" className={styles.locator}>{preview.cardLocator}</h2>
      <p className={styles.meta}>{preview.programName} · {locale === "fr" ? "émise" : "ausgestellt"} {previewMonth(preview.issuedAt, locale)}</p>
      <p className={styles.help}>{locale === "fr" ? "Est-ce la carte devant vous ? Le solde n’est affiché qu’après l’ouverture." : "Ist das die Karte, die vor dir liegt? Der Kontostand erscheint erst nach dem Öffnen."}</p>
      <div className={cx("cashier-preview-actions", styles.stack)}>
        <Button variant="primary" size="lg" block onClick={onConfirmPreview} disabled={busy} data-autofocus>{locale === "fr" ? "Ouvrir la carte" : "Karte öffnen"}</Button>
        <Button variant="quiet" size="sm" onClick={onCancelPreview} disabled={busy}>{locale === "fr" ? "Autre numéro" : "Andere Nummer"}</Button>
      </div>
    </section> : !card ? <section className={styles.ready} aria-label={t.ready}>
      {onStartCamera && !camera && <Button variant="primary" size="lg" block icon={<ScanLine size={20} />} onClick={onStartCamera} disabled={busy}>{t.camera}</Button>}
      <form className={styles.stack} onSubmit={lookup}>
        <TextField id="cashier-code" label={t.manual} hint={locale === "fr" ? "Le numéro figure sous le QR code de la carte client." : "Die Nummer steht unter dem QR-Code der Kundenkarte."}
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
      {card.matchedBy === "locator" && <p className={styles.note} role="note">{locale === "fr" ? "Ouverte par numéro, sans scan. Utilisez une récompense seulement si la personne présente sa propre carte." : "Per Kartennummer geöffnet, ohne Scan. Prämien nur einlösen, wenn die Person ihre eigene Karte zeigt."}</p>}
      <div className={cx("balance-display", styles.balance)}>
        <span>{t.balance}</span>
        <strong>{number.format(card.balance)} <em>{unit}</em></strong>
      </div>
      {card.programType === "points"
        ? card.rewards.length > 0 && <PointsLadder balance={card.balance} rewards={card.rewards.map(reward => ({ title: reward.name, cost: reward.cost }))} locale={locale} />
        : stampGoal > 0 && <StampGrid earned={Math.min(card.balance, stampGoal)} total={stampGoal} locale={locale} size="sm" />}
      {purchaseMode ? <div className={styles.stack}>
        <TextField id="purchase-amount" label={amountLabel} type="text" inputMode="decimal" autoComplete="off" placeholder="16,70" value={purchaseAmount}
          onChange={event => setPurchaseAmount(event.target.value)} aria-describedby="purchase-preview" />
        <p id="purchase-preview" className={styles.help} aria-live="polite">{purchasePreview
          ? locale === "fr" ? `${number.format(purchasePreview.points)} point(s) prévus pour cet achat. Le serveur calcule le montant final.` : `${number.format(purchasePreview.points)} Punkte voraussichtlich für diesen Kauf. Der Server berechnet die endgültige Menge.`
          : purchaseAmount
            ? locale === "fr" ? "Saisissez un montant positif avec au plus deux décimales. Les achats sans point ne peuvent pas être enregistrés." : "Positiven Kaufbetrag mit höchstens zwei Nachkommastellen eingeben. Käufe ohne Punkt können nicht gebucht werden."
            : locale === "fr" ? "Saisissez le montant payé; vérifiez les points avant de confirmer." : "Gezahlten Betrag eingeben und Punkte vor der Bestätigung prüfen."}</p>
        <p className={styles.help}>{locale === "fr" ? `${card.pointsPerCurrencyUnit} point(s) par 1 ${card.currency}. Les fractions sont arrondies vers le bas. Le serveur confirme le calcul.` : `${card.pointsPerCurrencyUnit} ${card.pointsPerCurrencyUnit === 1 ? "Punkt" : "Punkte"} pro 1 ${card.currency}. Punktbruchteile werden abgerundet. Der Server bestätigt die Berechnung.`}</p>
      </div> : <p className={styles.help}>{t.awardHint}</p>}
      <div className={styles.rewards}>
        <h3>{t.redeem}</h3>
        {card.rewards.length ? <div className={cx("reward-action-list", styles.rewardList)}>
          {card.rewards.map(reward => <button type="button" key={reward.id} className={styles.reward} disabled={!reward.eligible || busy} onClick={() => setConfirm({ kind: "redeem", reward })}>
            <span><strong>{reward.name}</strong><small>{reward.cost} {unit}</small></span>
            <span className={styles.rewardAction}>{reward.eligible ? t.review : t.unavailable}</span>
          </button>)}
        </div> : <p className={styles.help}>{t.noRewards}</p>}
      </div>
    </section>}
      {card && offlineLeaseExpiresAt && <p className={styles.footnote} role="status">{locale === "fr" ? "Tampon hors ligne préparé jusqu’à" : "Offline-Puffer bereit bis"} {new Date(offlineLeaseExpiresAt).toLocaleTimeString(locale === "fr" ? "fr-FR" : "de-DE", { hour: "2-digit", minute: "2-digit" })}. {locale === "fr" ? "Un ajout en attente ne change pas le solde." : "Eine vorgemerkte Vergabe ändert den Kontostand nicht."}</p>}
      {offlinePanel}
      <p className={styles.footnote}><ShieldCheck size={16} aria-hidden="true" /> {t.footnote}</p>
    {confirm && card && <Dialog open onClose={() => setConfirm(null)} title={confirm.kind === "award" ? t.confirmAward : t.confirmRedeem}
      description={confirm.kind === "award" ? `${"quantity" in confirm.award ? `${confirm.award.quantity} ${unit}` : `${number.format(purchasePoints(confirm.award.purchaseAmountMinor, card.pointsPerCurrencyUnit))} ${unit} ${locale === "fr" ? "pour un achat de" : "für einen Kauf über"} ${number.format(confirm.award.purchaseAmountMinor / 100)} ${card.currency}`} ${t.bookFor} ${card.cardLocator}.` : `${confirm.reward.name} (${confirm.reward.cost} ${unit}) ${t.redeemFor} ${card.cardLocator}.`}
      actions={<>
        <Button variant="secondary" onClick={() => setConfirm(null)}>{t.cancel}</Button>
        {confirm.kind === "award" && onQueueOffline && offlineLeaseExpiresAt && <Button variant="secondary" onClick={() => { onQueueOffline(card, confirm.award); setConfirm(null); }} disabled={busy}>{locale === "fr" ? "Mettre l’ajout hors ligne en attente" : "Offline-Vergabe vormerken"}</Button>}
        <Button variant="primary" onClick={submitConfirmed} disabled={busy}>{confirm.kind === "award" ? t.yesAward : t.yesRedeem}</Button>
      </>}>
      {confirm.kind === "award" && onQueueOffline && offlineLeaseExpiresAt && <p className={styles.note} role="note">{locale === "fr" ? "Connexion au serveur perturbée. « Oui, ajouter » tente l’enregistrement en ligne. La mise en attente hors ligne garde l’ajout seulement sur cet appareil ; il ne compte qu’après la synchronisation." : "Verbindung zum Server gestört. „Ja, vergeben“ versucht die Buchung online. „Offline-Vergabe vormerken“ speichert sie nur auf diesem Gerät; sie zählt erst nach der Synchronisierung."}</p>}
    </Dialog>}
  </CashierShell>;
}
