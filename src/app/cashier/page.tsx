"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, ClientApiError, newRequestId, postJson, type MeResponse } from "@/components/client-api";
import { BrandMark, CashierView, type CashierAward, type CashierCard, type CashierReward, type UiLocale } from "@/components/loyalty-ui";
import { QrScanner } from "@/components/qr-scanner";
import { OfflineQueuePanel } from "@/components/offline-queue-panel";
import { acknowledgeOfflineEvent, addOfflineEvent, getOfflineDeviceId, readOfflineEvents, resolveOfflineEvent, type OfflineQueuedEvent } from "@/lib/offline-queue";

type LookupResult = { membershipId: string; balance: number; programType: "stamp" | "points"; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; currency: "EUR" | "MAD"; ruleVersionId: string; rewards: Array<{ id: string; title: string; cost: number }> };
type TransactionResult = { balance: number; duplicate: boolean; entryId: string; creditedQuantity?: number };
type PendingOperation = { signature: string; idempotencyKey: string; requestId: string };
type OfflineLease = { leaseId: string; expiresAt: string; membershipId: string };
type OfflineSyncResult = { status: "accepted" | "rejected"; reason?: string; balance?: number; duplicate?: boolean };

export default function CashierPage() {
  const router = useRouter();
  const [locationName, setLocationName] = useState("");
  const [locale, setLocale] = useState<UiLocale>("de");
  const [showOverview, setShowOverview] = useState(true);
  const [accessState, setAccessState] = useState<"loading" | "ready" | "blocked">("loading");
  const [accessMessage, setAccessMessage] = useState("");
  const [card, setCard] = useState<CashierCard | null>(null);
  const [completedTransaction, setCompletedTransaction] = useState(0);
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "pending" | "rejected" | "offline">("idle");
  const [message, setMessage] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [offlineLease, setOfflineLease] = useState<OfflineLease | null>(null);
  const [offlineEvents, setOfflineEvents] = useState<OfflineQueuedEvent[]>([]);
  const [offlineError, setOfflineError] = useState("");
  const [offlineBusy, setOfflineBusy] = useState(false);
  const pendingRef = useRef<PendingOperation | null>(null);

  useEffect(() => {
    void apiJson<MeResponse>("/api/me").then(me => {
      if (!me.tenantId || !me.locationId || !me.role) { setAccessState("blocked"); setAccessMessage("Dieses Konto hat keinen aktiven Standortzugang. Eine Inhaberin oder ein Inhaber kann den Teamzugang prüfen."); return; }
      setLocationName(me.locationName); setLocale(me.locale === "fr" ? "fr" : "de"); setShowOverview(me.role !== "cashier"); setActorUserId(me.userId);
      try { setOfflineEvents(readOfflineEvents(localStorage, me.userId)); }
      catch (error) { setOfflineError(error instanceof Error ? error.message : "Offline queue unavailable"); }
      setAccessState("ready");
    }).catch(cause => {
      if (cause instanceof ClientApiError && cause.status === 401) router.replace("/login");
      else { setAccessState("blocked"); setAccessMessage(cause instanceof Error ? cause.message : "Standort konnte nicht geladen werden."); }
    });
  }, [router]);

  const lookup = useCallback(async (code: string) => {
    setBusy(true); setStatus("idle"); setMessage(""); setOfflineLease(null);
    try {
      const result = await apiJson<LookupResult>(`/api/cashier/lookup?code=${encodeURIComponent(code)}`);
      setCard({ id: result.membershipId, code, balance: result.balance, programType: result.programType === "stamp" ? "stamps" : "points", earningMode: result.earningMode, pointsPerCurrencyUnit: result.pointsPerCurrencyUnit, currency: result.currency, ruleVersionId: result.ruleVersionId, rewards: result.rewards.map(reward => ({ id: reward.id, name: reward.title, cost: reward.cost, eligible: result.balance >= reward.cost })) });
      pendingRef.current = null;
      try {
        const deviceId = getOfflineDeviceId(localStorage);
        const lease = await postJson<{ leaseId: string; expiresAt: string }>("/api/cashier/offline/lease", { membershipId: result.membershipId, deviceId });
        setOfflineLease({ ...lease, membershipId: result.membershipId });
        setOfflineError("");
      } catch (error) {
        setOfflineError(error instanceof Error ? error.message : "Offline earning unavailable for this card");
      }
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 403) { setAccessState("blocked"); setAccessMessage("Dein Kassenzugang ist nicht mehr aktiv."); }
      setCard(null);
      setStatus(cause instanceof ClientApiError && cause.status === 0 ? "offline" : "rejected");
      setMessage(cause instanceof Error ? cause.message : "Karte konnte nicht geprüft werden.");
    } finally { setBusy(false); }
  }, []);

  function queueOffline(selectedCard: CashierCard, award: CashierAward) {
    try {
      if (!actorUserId || !offlineLease || offlineLease.membershipId !== selectedCard.id || new Date(offlineLease.expiresAt).getTime() <= Date.now()) throw new Error("Offline-Freigabe fehlt oder ist abgelaufen. Karte online erneut prüfen.");
      if (pendingRef.current) throw new Error("Ein Online-Vorgang hat ein unklares Ergebnis. Zuerst diesen Vorgang prüfen.");
      getOfflineDeviceId(localStorage);
      addOfflineEvent(localStorage, { eventId: newRequestId(), leaseId: offlineLease.leaseId, actorUserId, membershipId: selectedCard.id, eventAt: new Date().toISOString(), award, state: "pending" });
      setOfflineEvents(readOfflineEvents(localStorage, actorUserId));
      setOfflineError(""); setStatus("pending"); setMessage("Offline-Vergabe vorgemerkt. Der Server hat noch nichts gebucht; der Kontostand bleibt unverändert.");
      setCompletedTransaction(value => value + 1);
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
    if (busy) return;
    const signature = operation.kind === "award" ? `award:${selectedCard.id}:${"quantity" in operation.award ? `quantity:${operation.award.quantity}` : `purchase:${operation.award.purchaseAmountMinor}:${operation.award.ruleVersionId}`}` : `redeem:${selectedCard.id}:${operation.reward.id}`;
    let pending: PendingOperation;
    try { pending = operationFor(signature); }
    catch (cause) { setStatus("rejected"); setMessage(cause instanceof Error ? cause.message : "Buchung nicht möglich."); return; }
    setBusy(true); setStatus("pending"); setMessage(locale === "fr" ? "Le serveur vérifie l’opération." : "Der Server prüft die Buchung.");
    try {
      const result = await postJson<TransactionResult>(`/api/cashier/${operation.kind}`, operation.kind === "award"
        ? { membershipId: selectedCard.id, ...operation.award, idempotencyKey: pending.idempotencyKey, requestId: pending.requestId, deviceAt: new Date().toISOString() }
        : { membershipId: selectedCard.id, rewardVersionId: operation.reward.id, idempotencyKey: pending.idempotencyKey, requestId: pending.requestId, deviceAt: new Date().toISOString() });
      pendingRef.current = null;
      setCard(current => current?.id === selectedCard.id ? { ...current, balance: result.balance, rewards: current.rewards.map(reward => ({ ...reward, eligible: result.balance >= reward.cost })) } : current);
      setCompletedTransaction(value => value + 1);
      setStatus("success"); setMessage(result.duplicate ? locale === "fr" ? "L’opération était déjà enregistrée. Le solde est à jour." : "Der Vorgang war bereits gebucht. Der Kontostand ist aktuell." : operation.kind === "award" ? result.creditedQuantity ? locale === "fr" ? `${result.creditedQuantity} ${selectedCard.programType === "points" ? "points" : "tampons"} ajoutés.` : `${result.creditedQuantity} ${selectedCard.programType === "points" ? "Punkte" : "Stempel"} vergeben.` : locale === "fr" ? "Les tampons ou points ont été ajoutés." : "Stempel oder Punkte wurden vergeben." : locale === "fr" ? "La récompense a été utilisée." : "Die Prämie wurde eingelöst.");
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 403) { setAccessState("blocked"); setAccessMessage("Dein Kassenzugang ist nicht mehr aktiv."); }
      const uncertain = cause instanceof ClientApiError && (cause.status === 0 || cause.status >= 500);
      if (!uncertain) pendingRef.current = null;
      setStatus(uncertain ? "pending" : "rejected");
      setMessage(uncertain ? locale === "fr" ? "Résultat incertain. Confirmez à nouveau la même action : elle conserve son identifiant et ne sera pas comptée deux fois." : "Ergebnis unklar. Bitte dieselbe Aktion erneut bestätigen; sie behält ihre Anfragekennung und wird nicht doppelt gebucht." : cause instanceof ClientApiError && cause.code === "LIMIT_EXCEEDED" ? locale === "fr" ? "Le montant ou les points dépassent la limite de ce rôle. Demandez à la personne propriétaire de vérifier cet achat." : "Kaufbetrag oder Punkte überschreiten das Limit dieser Rolle. Bitte die Inhaberin oder den Inhaber zur Prüfung hinzuziehen." : cause instanceof ClientApiError && cause.code === "STALE_RULE" ? locale === "fr" ? "La règle de points a changé. Rechargez la carte et confirmez le montant à nouveau." : "Die Punkteregel hat sich geändert. Karte neu laden und Kaufbetrag erneut bestätigen." : cause instanceof Error ? cause.message : locale === "fr" ? "Opération refusée." : "Buchung abgelehnt.");
    } finally { setBusy(false); }
  }

  if (accessState !== "ready") return <main className="app-state-page"><div className="app-state-card"><BrandMark /><h1>{accessState === "loading" ? "Kassenzugang wird geprüft" : "Zugang gesperrt oder nicht eingerichtet"}</h1><p>{accessState === "loading" ? "Dein Standort und deine Berechtigung werden geladen." : accessMessage}</p>{accessState === "blocked" && <a href="/login" className="button button--outline">Zur Anmeldung</a>}</div></main>;
  return <><CashierView key={`${card?.id ?? "empty"}:${completedTransaction}`} locationName={locationName} card={card} busy={busy} status={status} message={message} onLookup={lookup} onStartCamera={() => setScannerOpen(true)} onAward={(selected, award) => transact(selected, { kind: "award", award })} onRedeem={(selected, reward) => transact(selected, { kind: "redeem", reward })} onQueueOffline={queueOffline} offlineLeaseExpiresAt={offlineLease && card && offlineLease.membershipId === card.id ? offlineLease.expiresAt : undefined} offlinePanel={<OfflineQueuePanel events={offlineEvents} busy={offlineBusy} error={offlineError} onSync={() => void syncOffline()} onAcknowledge={acknowledgeOffline} locale={locale} />} onClear={() => { setCard(null); setOfflineLease(null); setStatus("idle"); setMessage(""); pendingRef.current = null; }} locale={locale} onLocaleChange={setLocale} showOverview={showOverview} />{scannerOpen && <QrScanner locale={locale} onDetected={text => { setScannerOpen(false); void lookup(text.trim()); }} onClose={() => setScannerOpen(false)} />}</>;
}
