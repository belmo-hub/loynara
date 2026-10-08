"use client";

import type { StaffRole } from "@/lib/award-limits";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, ClientApiError, newRequestId, postJson, type MeResponse } from "@/components/client-api";
import { BrandMark, CashierView, type CashierAward, type CashierCard, type CashierReward, type UiLocale } from "@/components/loyalty-ui";
import { QrScanner } from "@/components/qr-scanner";
import { OfflineQueuePanel } from "@/components/offline-queue-panel";
import { LogoutButton } from "@/components/logout-button";
import { CashierTapPanel } from "@/components/cashier-tap-panel";
import { CashierNotifications } from "@/components/cashier-notifications";
import { acknowledgeOfflineEvent, addOfflineEvent, getOfflineDeviceId, readOfflineEvents, resolveOfflineEvent, type OfflineQueuedEvent } from "@/lib/offline-queue";

type LookupPreview = { stage: "preview"; cardLocator: string; programName: string; issuedAt: string };
type LookupResult = { stage: "open"; membershipId: string; cardLocator: string; matchedBy: "code" | "locator"; balance: number; programType: "stamp" | "points"; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; currency: "EUR" | "MAD"; ruleVersionId: string; rewards: Array<{ id: string; title: string; cost: number }> };
type TransactionResult = { balance: number; duplicate: boolean; entryId: string; creditedQuantity?: number };
type PendingOperation = { signature: string; idempotencyKey: string; requestId: string };
type OfflineLease = { leaseId: string; expiresAt: string; membershipId: string };
type OfflineSyncResult = { status: "accepted" | "rejected"; reason?: string; balance?: number; duplicate?: boolean };
type Booked = { tone: "success" | "pending"; title: string; detail: string; hint?: string };

/**
 * After a booking the card is closed at once and a short confirmation is shown; then the counter is ready for the next
 * card. The previous card is never left open with booking controls, so a second tap cannot credit the wrong guest.
 */
const NEXT_CUSTOMER_DELAY_MS = 4_000;
/** How long an unclear booking stays attached to its card, so that reopening the card resumes the same request. */
const UNRESOLVED_TTL_MS = 10 * 60_000;
/** The counter camera stays on between customers; this remembers that the cashier works with it. */
const CAMERA_PREFERENCE_KEY = "loynara_cashier_camera";
/** A camera that has read nothing for this long is put to sleep (battery, privacy); one tap wakes it. */
const CAMERA_IDLE_MS = 3 * 60_000;
/**
 * After a card is closed, the camera ignores its code until the code has been out of view this long: the guest is
 * usually still holding the phone up, and the card must not simply reopen for a second booking.
 */
const SAME_CODE_GAP_MS = 2_000;
/** A lookup that failed for a passing reason (no connection, server trouble, rate limit) is retried by the camera after this. */
const TRANSIENT_RETRY_MS = 3_000;
/** Reopening a card this soon after a booking on it shows a warning before anything is booked again. */
const RECENT_BOOKING_MS = 2 * 60_000;
/** Only card codes start a lookup from the camera; other QR codes in view (menus, the counter sign) are ignored. */
const cameraCardCode = /^(sc_[A-Za-z0-9_-]{8,80}|K-?[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6})$/i;
const isNetworkFailure = (cause: unknown) => cause instanceof ClientApiError && cause.status === 0;

export default function CashierPage() {
  const router = useRouter();
  const [locationName, setLocationName] = useState("");
  const [locale, setLocale] = useState<UiLocale>("de");
  const [showOverview, setShowOverview] = useState(true);
  const [role, setRole] = useState<StaffRole | undefined>(undefined);
  const [accessState, setAccessState] = useState<"loading" | "ready" | "blocked">("loading");
  const [accessMessage, setAccessMessage] = useState("");
  const [card, setCard] = useState<CashierCard | null>(null);
  const [preview, setPreview] = useState<(LookupPreview & { code: string }) | null>(null);
  const [completedTransaction, setCompletedTransaction] = useState(0);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState<"off" | "on" | "sleeping">("off");
  const [status, setStatus] = useState<"idle" | "success" | "pending" | "rejected" | "offline">("idle");
  const [message, setMessage] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [offlineLease, setOfflineLease] = useState<OfflineLease | null>(null);
  const [offlineEvents, setOfflineEvents] = useState<OfflineQueuedEvent[]>([]);
  const [offlineError, setOfflineError] = useState("");
  const [offlineBusy, setOfflineBusy] = useState(false);
  // The NFC confirmation panel only means something where the programme uses staff-confirmed NFC taps; otherwise it is dead weight on the counter screen.
  const [staffTapEnabled, setStaffTapEnabled] = useState(false);
  const pendingRef = useRef<PendingOperation | null>(null);
  // A booking whose result stayed unclear is remembered per card for a while. Reopening that card (after "Andere Karte"
  // or a new scan) resumes the same request id, so retrying it still cannot book twice.
  const unresolvedRef = useRef(new Map<string, { pending: PendingOperation; label: string; at: number }>());
  // A handheld scanner types into the code field; once the cashier works that way, the field keeps the focus between cards.
  const [typedEntry, setTypedEntry] = useState(false);
  // Counter camera bookkeeping. Reads arrive several times per second, outside React's render cycle, so they are
  // checked against refs: whether the counter is free for the next card, which code was just closed, the last booking.
  const counterFree = useRef(false);
  const lookupRunning = useRef(false);
  const openCode = useRef<string | null>(null);
  const closedCode = useRef<{ code: string; seenAt: number; retryAt?: number } | null>(null);
  const recentBookings = useRef(new Map<string, { at: number; detail: string }>());
  const lastCameraActivity = useRef(0);
  const cameraSleepReason = useRef<"idle" | "hidden" | "failed" | null>(null);
  const cameraAutoStarted = useRef(false);
  const [booked, setBooked] = useState<Booked | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCardId = useRef<string | null>(null);
  // Offline earning is a fallback, not a normal choice: its controls appear only after real evidence of network
  // trouble (a request that never reached the server, or the browser reporting offline), or while offline work exists.
  const [networkTrouble, setNetworkTrouble] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [offlineStorageProblem, setOfflineStorageProblem] = useState(false);

  const cancelReset = useCallback(() => { if (resetTimer.current) { clearTimeout(resetTimer.current); resetTimer.current = null; } }, []);
  useEffect(() => cancelReset, [cancelReset]);
  // A page opened without a connection cannot load the counter at all (/api/me), so only later changes matter here.
  useEffect(() => {
    const offline = () => setNetworkTrouble(true);
    window.addEventListener("offline", offline);
    return () => window.removeEventListener("offline", offline);
  }, []);

  /** The camera must not reopen the card that was just closed while its code is still in view. */
  const forgetOpenCode = useCallback(() => {
    if (openCode.current) closedCode.current = { code: openCode.current, seenAt: Date.now() };
    openCode.current = null;
  }, []);

  /** Closes the card right away, shows what was booked, and returns to the scan screen after a short pause. */
  const finishBooking = useCallback((summary: Booked, statusTone: "success" | "pending", statusMessage: string) => {
    cancelReset();
    forgetOpenCode();
    pendingRef.current = null;
    activeCardId.current = null;
    setUncertain(false);
    setCard(null); setPreview(null); setOfflineLease(null);
    setStatus(statusTone); setMessage(statusMessage);
    setBooked(summary);
    setCompletedTransaction(value => value + 1);
    resetTimer.current = setTimeout(() => { resetTimer.current = null; setBooked(null); }, NEXT_CUSTOMER_DELAY_MS);
  }, [cancelReset, forgetOpenCode]);

  const clearCounter = useCallback(() => {
    cancelReset();
    forgetOpenCode();
    activeCardId.current = null;
    pendingRef.current = null;
    setUncertain(false);
    setBooked(null); setCard(null); setPreview(null); setOfflineLease(null);
    setStatus("idle"); setMessage("");
  }, [cancelReset, forgetOpenCode]);

  useEffect(() => {
    void apiJson<MeResponse>("/api/me").then(me => {
      if (!me.tenantId || !me.locationId || !me.role) { setAccessState("blocked"); setAccessMessage("Dieses Konto hat keinen aktiven Standortzugang. Eine Inhaberin oder ein Inhaber kann den Teamzugang prüfen."); return; }
      setLocationName(me.locationName); setLocale(me.locale === "fr" ? "fr" : "de"); setShowOverview(me.role !== "cashier"); setRole(me.role); setActorUserId(me.userId); setStaffTapEnabled(me.tapMode === "staff_confirmed" && !(me.hiddenSurfaces ?? []).includes("nfc"));
      try { setOfflineEvents(readOfflineEvents(localStorage, me.userId)); }
      catch (error) { setOfflineStorageProblem(true); setOfflineError(error instanceof Error ? error.message : "Offline queue unavailable"); }
      try { if (localStorage.getItem(CAMERA_PREFERENCE_KEY) === "on") { cameraAutoStarted.current = true; lastCameraActivity.current = Date.now(); setCamera("on"); } } catch { /* no preference: the cashier opens the camera */ }
      setAccessState("ready");
    }).catch(cause => {
      if (cause instanceof ClientApiError && cause.status === 401) router.replace("/login");
      else { setAccessState("blocked"); setAccessMessage(cause instanceof Error ? cause.message : "Standort konnte nicht geladen werden."); }
    });
  }, [router]);

  const lookup = useCallback(async (code: string, confirm = false) => {
    lookupRunning.current = true;
    lastCameraActivity.current = Date.now();
    cancelReset(); setBooked(null);
    activeCardId.current = null; pendingRef.current = null; setUncertain(false);
    setBusy(true); setStatus("idle"); setMessage(""); setOfflineLease(null);
    try {
      const result = await apiJson<LookupResult | LookupPreview>(`/api/cashier/lookup?code=${encodeURIComponent(code)}${confirm ? "&confirm=1" : ""}`);
      setNetworkTrouble(false);
      openCode.current = code;
      if (result.stage === "preview") { setCard(null); setPreview({ ...result, code }); return; }
      setPreview(null);
      activeCardId.current = result.membershipId;
      setCard({ id: result.membershipId, code, cardLocator: result.cardLocator, matchedBy: result.matchedBy, balance: result.balance, programType: result.programType === "stamp" ? "stamps" : "points", earningMode: result.earningMode, pointsPerCurrencyUnit: result.pointsPerCurrencyUnit, currency: result.currency, ruleVersionId: result.ruleVersionId, rewards: result.rewards.map(reward => ({ id: reward.id, name: reward.title, cost: reward.cost, eligible: result.balance >= reward.cost })) });
      const unresolved = unresolvedRef.current.get(result.membershipId);
      if (unresolved && Date.now() - unresolved.at < UNRESOLVED_TTL_MS) {
        pendingRef.current = unresolved.pending;
        setUncertain(true); setStatus("pending");
        setMessage(locale === "fr" ? `La dernière opération pour ${result.cardLocator} a un résultat incertain (${unresolved.label}). Vérifiez le solde. Si vous confirmez exactement cette opération à nouveau, elle garde son identifiant et ne sera pas comptée deux fois.` : `Der letzte Vorgang für ${result.cardLocator} hat ein unklares Ergebnis (${unresolved.label}). Prüfe den Kontostand. Bestätigst du genau diesen Vorgang erneut, behält er seine Anfragekennung und wird nicht doppelt gebucht.`);
      } else {
        unresolvedRef.current.delete(result.membershipId);
        pendingRef.current = null;
        const recent = recentBookings.current.get(result.membershipId);
        if (recent && Date.now() - recent.at < RECENT_BOOKING_MS) {
          const seconds = Math.max(1, Math.round((Date.now() - recent.at) / 1000));
          setStatus("pending");
          setMessage(locale === "fr" ? `Attention : cette carte a déjà été créditée il y a ${seconds} s (${recent.detail}). N’ajoutez à nouveau que pour un nouvel achat.` : `Achtung: Auf dieser Karte wurde vor ${seconds} s gebucht (${recent.detail}). Nur erneut vergeben, wenn es ein neuer Kauf ist.`);
        }
      }
      // The offline lease is only a fallback; the card is usable at once, without waiting for it.
      const membershipId = result.membershipId;
      void (async () => {
        try {
          const deviceId = getOfflineDeviceId(localStorage);
          const lease = await postJson<{ leaseId: string; expiresAt: string }>("/api/cashier/offline/lease", { membershipId, deviceId });
          if (activeCardId.current !== membershipId) return;
          setOfflineLease({ ...lease, membershipId });
          setOfflineError("");
        } catch (error) {
          if (activeCardId.current !== membershipId) return;
          if (isNetworkFailure(error)) setNetworkTrouble(true);
          setOfflineError(error instanceof Error ? error.message : "Offline earning unavailable for this card");
        }
      })();
    } catch (cause) {
      // A code that is not a card here is not retried by the camera while it stays in view; a passing failure is retried
      // after a short pause, so a guest holding the phone still is not stuck.
      const transient = cause instanceof ClientApiError && (cause.status === 0 || cause.status === 429 || cause.status >= 500);
      closedCode.current = { code, seenAt: Date.now(), ...(transient ? { retryAt: Date.now() + TRANSIENT_RETRY_MS } : {}) };
      if (cause instanceof ClientApiError && cause.status === 403) { setAccessState("blocked"); setAccessMessage("Dein Kassenzugang ist nicht mehr aktiv."); }
      setCard(null); setPreview(null);
      if (isNetworkFailure(cause)) setNetworkTrouble(true);
      setStatus(isNetworkFailure(cause) ? "offline" : "rejected");
      const fr = locale === "fr";
      setMessage(cause instanceof ClientApiError && cause.code === "NOT_FOUND" ? fr ? "Aucune carte active avec ce numéro ou ce code dans cet établissement. Vérifiez le numéro sous le QR code ; les numéros ne contiennent ni 0/O ni 1/I/L." : "Keine aktive Karte mit dieser Nummer oder diesem Code an diesem Standort. Prüfe die Nummer unter dem QR-Code und achte auf 0/O und 1/I/L: Kartennummern enthalten diese Zeichen nicht."
        : cause instanceof ClientApiError && cause.code === "INVALID_CODE" ? fr ? "Numéro de carte non reconnu. Il ressemble à K-7QX2MA et ne contient ni 0, O, 1, I ni L. Sinon, scannez le QR code avec la caméra." : "Kartennummer nicht erkannt. Sie sieht aus wie K-7QX2MA und enthält weder 0, O, 1, I noch L. Oder den QR-Code mit der Kamera scannen."
        : cause instanceof Error ? cause.message : fr ? "La carte n’a pas pu être vérifiée." : "Karte konnte nicht geprüft werden.");
    } finally { setBusy(false); lookupRunning.current = false; }
  }, [locale, cancelReset]);

  useEffect(() => { counterFree.current = !card && !preview && !busy; }, [card, preview, busy]);

  /** A read from the counter camera: opens the next card when the counter is free, ignores everything else. */
  const onCameraRead = useCallback((text: string) => {
    const code = text.trim();
    const now = Date.now();
    lastCameraActivity.current = now;
    const closed = closedCode.current;
    if (closed?.code === code) {
      const gap = now - closed.seenAt;
      closed.seenAt = now;
      if (gap < SAME_CODE_GAP_MS && (closed.retryAt === undefined || now < closed.retryAt)) return;
      closedCode.current = null;
    }
    if (!cameraCardCode.test(code) || !counterFree.current || lookupRunning.current) return;
    setTypedEntry(false);
    void lookup(code);
  }, [lookup]);

  const startCamera = useCallback(() => {
    cameraAutoStarted.current = false; cameraSleepReason.current = null;
    lastCameraActivity.current = Date.now();
    setCamera("on");
    try { localStorage.setItem(CAMERA_PREFERENCE_KEY, "on"); } catch { /* the camera still works for this visit */ }
  }, []);
  const stopCamera = useCallback(() => {
    cameraSleepReason.current = null;
    setCamera("off");
    try { localStorage.setItem(CAMERA_PREFERENCE_KEY, "off"); } catch { /* nothing to remember */ }
  }, []);
  // An automatic start (from the remembered preference) can be refused without a tap; then offer one instead of an error.
  const onCameraFailure = useCallback(() => {
    if (!cameraAutoStarted.current) return;
    cameraAutoStarted.current = false; cameraSleepReason.current = "failed";
    setCamera("sleeping");
  }, []);
  // Sleep when nothing was read for a while or the page is hidden; wake on return if it only slept because it was hidden.
  useEffect(() => {
    if (camera === "off") return;
    const idle = setInterval(() => {
      if (camera === "on" && counterFree.current && Date.now() - lastCameraActivity.current > CAMERA_IDLE_MS) { cameraSleepReason.current = "idle"; setCamera("sleeping"); }
    }, 15_000);
    const visibility = () => {
      if (document.visibilityState === "hidden" && camera === "on") { cameraSleepReason.current = "hidden"; setCamera("sleeping"); }
      else if (document.visibilityState === "visible" && camera === "sleeping" && cameraSleepReason.current === "hidden") { cameraSleepReason.current = null; lastCameraActivity.current = Date.now(); setCamera("on"); }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { clearInterval(idle); document.removeEventListener("visibilitychange", visibility); };
  }, [camera]);

  function rememberBooking(membershipId: string, detail: string) {
    const now = Date.now();
    for (const [id, entry] of recentBookings.current) if (now - entry.at >= RECENT_BOOKING_MS) recentBookings.current.delete(id);
    recentBookings.current.set(membershipId, { at: now, detail });
  }

  function queueOffline(selectedCard: CashierCard, award: CashierAward) {
    try {
      if (!actorUserId || !offlineLease || offlineLease.membershipId !== selectedCard.id || new Date(offlineLease.expiresAt).getTime() <= Date.now()) throw new Error("Offline-Freigabe fehlt oder ist abgelaufen. Karte online erneut prüfen.");
      if (pendingRef.current) throw new Error("Ein Online-Vorgang hat ein unklares Ergebnis. Zuerst diesen Vorgang prüfen.");
      getOfflineDeviceId(localStorage);
      addOfflineEvent(localStorage, { eventId: newRequestId(), leaseId: offlineLease.leaseId, actorUserId, membershipId: selectedCard.id, cardLocator: selectedCard.cardLocator, eventAt: new Date().toISOString(), award, state: "pending" });
      setOfflineEvents(readOfflineEvents(localStorage, actorUserId));
      setOfflineError("");
      const fr = locale === "fr";
      const what = "quantity" in award ? `${award.quantity} ${unitLabel(selectedCard, award.quantity, fr)}` : fr ? `achat de ${(award.purchaseAmountMinor / 100).toFixed(2)} ${selectedCard.currency}` : `Kauf über ${(award.purchaseAmountMinor / 100).toFixed(2).replace(".", ",")} ${selectedCard.currency}`;
      const detail = fr ? `${what} pour ${selectedCard.cardLocator} mis en attente hors ligne. Rien n’est encore enregistré ; le solde ne change qu’après la synchronisation.` : `${what} für ${selectedCard.cardLocator} offline vorgemerkt. Noch nichts gebucht; der Kontostand ändert sich erst nach der Synchronisierung.`;
      rememberBooking(selectedCard.id, fr ? `${what}, hors ligne` : `${what}, offline vorgemerkt`);
      finishBooking({ tone: "pending", title: fr ? "En attente, pas encore enregistré" : "Vorgemerkt, noch nicht gebucht", detail }, "pending", detail);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Offline-Vergabe konnte nicht gespeichert werden.";
      setOfflineError(detail); setStatus("rejected"); setMessage(detail);
    }
  }

  async function syncOffline() {
    if (offlineBusy || !actorUserId) return;
    setOfflineBusy(true); setOfflineError("");
    try {
      const deviceId = getOfflineDeviceId(localStorage);
      let accepted = 0;
      let rejected = 0;
      for (const item of readOfflineEvents(localStorage, actorUserId).filter(event => event.state === "pending")) {
        const result = await postJson<OfflineSyncResult>("/api/cashier/offline/sync", { leaseId: item.leaseId, deviceId, eventId: item.eventId, eventAt: item.eventAt, award: item.award });
        setNetworkTrouble(false);
        resolveOfflineEvent(localStorage, item.eventId, result);
        if (result.status === "accepted") accepted += 1;
        else rejected += 1;
        if (result.reason === "STAFF_REVOKED" || result.reason === "LEASE_EXPIRED" || result.reason === "LEASE_LIMIT") setOfflineLease(null);
        if (result.status === "accepted" && result.balance !== undefined) {
          setCard(current => current?.id === item.membershipId ? { ...current, balance: result.balance!, rewards: current.rewards.map(reward => ({ ...reward, eligible: result.balance! >= reward.cost })) } : current);
        }
        setOfflineEvents(readOfflineEvents(localStorage, actorUserId));
      }
      if (rejected) { setStatus("rejected"); setMessage(`${rejected} Offline-Vergabe(n) abgelehnt. Grund und Prüfaktion stehen unten; abgelehnte Mengen zählen nicht zum Guthaben.`); }
      else if (accepted) { setStatus("success"); setMessage(`${accepted} Offline-Vergabe(n) vom Server bestätigt. Der angezeigte Kontostand ist aktualisiert, falls diese Karte offen ist.`); }
    } catch (error) {
      if (isNetworkFailure(error)) setNetworkTrouble(true);
      const detail = error instanceof Error ? error.message : "Synchronisierung fehlgeschlagen. Vorgänge bleiben ausstehend.";
      setOfflineError(detail); setStatus("pending"); setMessage("Synchronisierung unterbrochen. Nicht bestätigte Vergaben bleiben ausstehend.");
    }
    finally { setOfflineBusy(false); }
  }

  function acknowledgeOffline(eventId: string) {
    try { acknowledgeOfflineEvent(localStorage, eventId); setOfflineEvents(readOfflineEvents(localStorage, actorUserId)); setOfflineError(""); }
    catch (error) { setOfflineError(error instanceof Error ? error.message : "Review failed"); }
  }

  function operationFor(signature: string): PendingOperation {
    if (pendingRef.current?.signature === signature) return pendingRef.current;
    if (pendingRef.current) throw new Error(locale === "fr" ? "Une opération a un résultat incertain. Réessayez la même action avant de saisir un autre montant ou une autre récompense." : "Ein Vorgang hat ein unklares Ergebnis. Wiederhole dieselbe Aktion, bevor du einen anderen Betrag oder eine andere Prämie eingibst.");
    const pending = { signature, idempotencyKey: newRequestId(), requestId: newRequestId() };
    pendingRef.current = pending;
    return pending;
  }

  async function transact(selectedCard: CashierCard, operation: { kind: "award"; award: CashierAward } | { kind: "redeem"; reward: CashierReward }) {
    if (busy || activeCardId.current !== selectedCard.id) return;
    const signature = operation.kind === "award" ? `award:${selectedCard.id}:${"quantity" in operation.award ? `quantity:${operation.award.quantity}` : `purchase:${operation.award.purchaseAmountMinor}:${operation.award.ruleVersionId}`}` : `redeem:${selectedCard.id}:${operation.reward.id}`;
    // While the browser reports no network at all it does not send the request, so nothing can have been booked: say so
    // and keep the offline fallback, instead of turning a certain "not sent" into an unclear result. A booking that is
    // already unclear goes through the normal path, so its request id is kept.
    if (navigator.onLine === false && !pendingRef.current) {
      setNetworkTrouble(true); setStatus("offline");
      setMessage(locale === "fr" ? "Pas de connexion : rien n’a été envoyé ni enregistré. Réessayez quand la connexion revient." : "Keine Verbindung: Es wurde nichts gesendet und nichts gebucht. Erneut versuchen, sobald die Verbindung zurück ist.");
      return;
    }
    let pending: PendingOperation;
    try { pending = operationFor(signature); }
    catch (cause) { setStatus("rejected"); setMessage(cause instanceof Error ? cause.message : "Buchung nicht möglich."); return; }
    const fr = locale === "fr";
    const label = operation.kind === "redeem" ? `„${operation.reward.name}“` : "quantity" in operation.award ? `${operation.award.quantity} ${unitLabel(selectedCard, operation.award.quantity, fr)}` : `${(operation.award.purchaseAmountMinor / 100).toFixed(2)} ${selectedCard.currency}`;
    const settle = (unclear: boolean) => {
      if (unclear) unresolvedRef.current.set(selectedCard.id, { pending, label, at: Date.now() });
      else if (unresolvedRef.current.get(selectedCard.id)?.pending.signature === signature) unresolvedRef.current.delete(selectedCard.id);
    };
    setBusy(true); setStatus("pending"); setMessage(fr ? "Le serveur vérifie l’opération." : "Der Server prüft die Buchung.");
    try {
      const result = await postJson<TransactionResult>(`/api/cashier/${operation.kind}`, operation.kind === "award"
        ? { membershipId: selectedCard.id, ...operation.award, idempotencyKey: pending.idempotencyKey, requestId: pending.requestId, deviceAt: new Date().toISOString() }
        : { membershipId: selectedCard.id, rewardVersionId: operation.reward.id, idempotencyKey: pending.idempotencyKey, requestId: pending.requestId, deviceAt: new Date().toISOString() });
      setNetworkTrouble(false);
      settle(false);
      rememberBooking(selectedCard.id, label);
      const summary = bookingSummary(selectedCard, operation, result, fr);
      if (activeCardId.current !== selectedCard.id) {
        // The cashier already moved on; never close or change another card. Report the result only on an empty counter.
        if (pendingRef.current?.signature === signature) pendingRef.current = null;
        if (activeCardId.current === null) { setStatus("success"); setMessage(summary.statusMessage); }
        return;
      }
      finishBooking(summary.booked, "success", summary.statusMessage);
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 403) { setAccessState("blocked"); setAccessMessage("Dein Kassenzugang ist nicht mehr aktiv."); }
      if (isNetworkFailure(cause)) setNetworkTrouble(true);
      const unclear = cause instanceof ClientApiError && (cause.status === 0 || cause.status >= 500);
      settle(unclear);
      if (activeCardId.current !== selectedCard.id) {
        // The cashier already moved on, so this card cannot be retried from here. Say so plainly, only on an empty counter.
        if (pendingRef.current?.signature === signature) pendingRef.current = null;
        if (activeCardId.current === null) { setStatus(unclear ? "pending" : "rejected"); setMessage(unclear ? fr ? `Résultat incertain pour ${selectedCard.cardLocator}. Rouvrez la carte et vérifiez le solde avant d’ajouter à nouveau.` : `Ergebnis für ${selectedCard.cardLocator} unklar. Öffne die Karte erneut und prüfe den Kontostand, bevor du nochmals vergibst.` : fr ? `Opération refusée pour ${selectedCard.cardLocator}.` : `Buchung für ${selectedCard.cardLocator} abgelehnt.`); }
        return;
      }
      if (!unclear) pendingRef.current = null;
      setUncertain(unclear);
      setStatus(unclear ? "pending" : "rejected");
      setMessage(unclear ? fr ? "Résultat incertain. Confirmez à nouveau la même action : elle conserve son identifiant et ne sera pas comptée deux fois." : "Ergebnis unklar. Bitte dieselbe Aktion erneut bestätigen; sie behält ihre Anfragekennung und wird nicht doppelt gebucht." : cause instanceof ClientApiError && cause.code === "LIMIT_EXCEEDED" ? fr ? "Le montant ou les points dépassent la limite de ce rôle. Demandez à la personne propriétaire de vérifier cet achat." : "Kaufbetrag oder Punkte überschreiten das Limit dieser Rolle. Bitte die Inhaberin oder den Inhaber zur Prüfung hinzuziehen." : cause instanceof ClientApiError && cause.code === "STALE_RULE" ? fr ? "La règle de points a changé. Rechargez la carte et confirmez le montant à nouveau." : "Die Punkteregel hat sich geändert. Karte neu laden und Kaufbetrag erneut bestätigen." : cause instanceof Error ? cause.message : fr ? "Opération refusée." : "Buchung abgelehnt.");
    } finally { setBusy(false); }
  }

  if (accessState !== "ready") return <main className="app-state-page"><div className="app-state-card"><BrandMark /><h1>{accessState === "loading" ? "Kassenzugang wird geprüft" : "Zugang gesperrt oder nicht eingerichtet"}</h1><p>{accessState === "loading" ? "Dein Standort und deine Berechtigung werden geladen." : accessMessage}</p>{accessState === "blocked" && <><a href="/login" className="button button--outline">Zur Anmeldung</a><LogoutButton className="button button--outline" /></>}</div></main>;
  const cameraNode = camera === "on"
    ? <QrScanner locale={locale} paused={Boolean(card || preview)} onDetected={onCameraRead} onClose={stopCamera} onFailure={onCameraFailure} />
    : camera === "sleeping"
      ? <section className="counter-camera counter-camera--sleeping" hidden={Boolean(card || preview)}><button type="button" className="button button--accent button--full cashier-camera-action" onClick={startCamera}>{locale === "fr" ? "Rallumer la caméra" : "Kamera fortsetzen"}</button><button type="button" className="text-button" onClick={stopCamera}>{locale === "fr" ? "Éteindre la caméra" : "Kamera ausschalten"}</button></section>
      : undefined;
  const showOfflineFallback = networkTrouble && Boolean(offlineLease && card && offlineLease.membershipId === card.id);
  const showOfflinePanel = networkTrouble || offlineStorageProblem || offlineEvents.length > 0;
  return <><CashierView resetToken={completedTransaction} camera={cameraNode} nfcPanel={staffTapEnabled ? <><CashierTapPanel locale={locale} /><CashierNotifications locale={locale} /></> : undefined} locationName={locationName} card={card} preview={preview} booked={booked} onConfirmPreview={() => { if (preview) void lookup(preview.code, true); }} onCancelPreview={() => setPreview(null)} busy={busy} status={status} message={message} onLookup={code => { setTypedEntry(true); void lookup(code); }} focusCodeInput={typedEntry} onStartCamera={startCamera} onAward={(selected, award) => transact(selected, { kind: "award", award })} onRedeem={(selected, reward) => transact(selected, { kind: "redeem", reward })} onQueueOffline={uncertain ? undefined : queueOffline} offlineLeaseExpiresAt={showOfflineFallback ? offlineLease?.expiresAt : undefined} offlinePanel={showOfflinePanel ? <OfflineQueuePanel events={offlineEvents} busy={offlineBusy} error={offlineError} onSync={() => void syncOffline()} onAcknowledge={acknowledgeOffline} locale={locale} /> : null} onClear={clearCounter} locale={locale} onLocaleChange={setLocale} showOverview={showOverview} role={role} logoutControl={<LogoutButton className="text-button" />} /></>;
}

function unitLabel(card: CashierCard, amount: number, fr: boolean) {
  if (card.programType === "points") return fr ? "points" : amount === 1 ? "Punkt" : "Punkte";
  return fr ? amount === 1 ? "tampon" : "tampons" : "Stempel";
}

/** What the cashier sees after a confirmed booking: always the card number, never the scan code. */
function bookingSummary(card: CashierCard, operation: { kind: "award"; award: CashierAward } | { kind: "redeem"; reward: CashierReward }, result: TransactionResult, fr: boolean): { booked: Booked; statusMessage: string } {
  const balance = `${new Intl.NumberFormat(fr ? "fr-FR" : "de-DE").format(result.balance)} ${unitLabel(card, result.balance, fr)}`;
  const newBalance = fr ? `Nouveau solde : ${balance}.` : `Neuer Stand: ${balance}.`;
  let detail: string;
  if (result.duplicate) detail = fr ? `Cette opération pour ${card.cardLocator} était déjà enregistrée.` : `Dieser Vorgang für ${card.cardLocator} war bereits gebucht.`;
  else if (operation.kind === "redeem") detail = fr ? `« ${operation.reward.name} » utilisée sur ${card.cardLocator}.` : `„${operation.reward.name}“ auf ${card.cardLocator} eingelöst.`;
  else {
    const credited = result.creditedQuantity ?? ("quantity" in operation.award ? operation.award.quantity : undefined);
    detail = credited === undefined ? fr ? `Tampons ou points ajoutés à ${card.cardLocator}.` : `Stempel oder Punkte für ${card.cardLocator} vergeben.` : fr ? `${credited} ${unitLabel(card, credited, fr)} ajouté(s) à ${card.cardLocator}.` : `${credited} ${unitLabel(card, credited, fr)} für ${card.cardLocator} vergeben.`;
  }
  const rewardReady = operation.kind === "award" && card.rewards.some(reward => result.balance >= reward.cost);
  const hint = rewardReady ? fr ? "Récompense disponible. Pour l’utiliser, scannez à nouveau la carte." : "Prämie verfügbar. Zum Einlösen die Karte erneut scannen." : undefined;
  return { booked: { tone: "success", title: fr ? "Enregistré" : "Gebucht", detail: `${detail} ${newBalance}`, hint }, statusMessage: `${detail} ${newBalance}` };
}

