"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, ClientApiError, newRequestId, postJson, type MeResponse } from "@/components/client-api";
import { BrandMark, CashierView, type CashierCard, type CashierReward, type UiLocale } from "@/components/loyalty-ui";
import { QrScanner } from "@/components/qr-scanner";

type LookupResult = { membershipId: string; balance: number; programType: "stamp" | "points"; rewards: Array<{ id: string; title: string; cost: number }> };
type TransactionResult = { balance: number; duplicate: boolean; entryId: string };
type PendingOperation = { signature: string; idempotencyKey: string; requestId: string };

export default function CashierPage() {
  const router = useRouter();
  const [locationName, setLocationName] = useState("");
  const [locale, setLocale] = useState<UiLocale>("de");
  const [showOverview, setShowOverview] = useState(true);
  const [accessState, setAccessState] = useState<"loading" | "ready" | "blocked">("loading");
  const [accessMessage, setAccessMessage] = useState("");
  const [card, setCard] = useState<CashierCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "pending" | "rejected" | "offline">("idle");
  const [message, setMessage] = useState("");
  const pendingRef = useRef<PendingOperation | null>(null);

  useEffect(() => {
    void apiJson<MeResponse>("/api/me").then(me => {
      if (!me.tenantId || !me.locationId || !me.role) { setAccessState("blocked"); setAccessMessage("Dieses Konto hat keinen aktiven Standortzugang. Eine Inhaberin oder ein Inhaber kann den Teamzugang prüfen."); return; }
      setLocationName(me.locationName); setLocale(me.locale === "fr" ? "fr" : "de"); setShowOverview(me.role !== "cashier"); setAccessState("ready");
    }).catch(cause => {
      if (cause instanceof ClientApiError && cause.status === 401) router.replace("/login");
      else { setAccessState("blocked"); setAccessMessage(cause instanceof Error ? cause.message : "Standort konnte nicht geladen werden."); }
    });
  }, [router]);

  const lookup = useCallback(async (code: string) => {
    setBusy(true); setStatus("idle"); setMessage("");
    try {
      const result = await apiJson<LookupResult>(`/api/cashier/lookup?code=${encodeURIComponent(code)}`);
      setCard({ id: result.membershipId, code, balance: result.balance, programType: result.programType === "stamp" ? "stamps" : "points", rewards: result.rewards.map(reward => ({ id: reward.id, name: reward.title, cost: reward.cost, eligible: result.balance >= reward.cost })) });
      pendingRef.current = null;
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 403) { setAccessState("blocked"); setAccessMessage("Dein Kassenzugang ist nicht mehr aktiv."); }
      setCard(null);
      setStatus(cause instanceof ClientApiError && cause.status === 0 ? "offline" : "rejected");
      setMessage(cause instanceof Error ? cause.message : "Karte konnte nicht geprüft werden.");
    } finally { setBusy(false); }
  }, []);

  function operationFor(signature: string): PendingOperation {
    if (pendingRef.current?.signature === signature) return pendingRef.current;
    const pending = { signature, idempotencyKey: newRequestId(), requestId: newRequestId() };
    pendingRef.current = pending;
    return pending;
  }

  async function transact(kind: "award" | "redeem", selectedCard: CashierCard, value: number | CashierReward) {
    if (busy) return;
    const signature = `${kind}:${selectedCard.id}:${typeof value === "number" ? value : value.id}`;
    let pending: PendingOperation;
    try { pending = operationFor(signature); }
    catch (cause) { setStatus("rejected"); setMessage(cause instanceof Error ? cause.message : "Buchung nicht möglich."); return; }
    setBusy(true); setStatus("pending"); setMessage(locale === "fr" ? "Le serveur vérifie l’opération." : "Der Server prüft die Buchung.");
    try {
      const result = await postJson<TransactionResult>(`/api/cashier/${kind}`, kind === "award"
        ? { membershipId: selectedCard.id, quantity: value, idempotencyKey: pending.idempotencyKey, requestId: pending.requestId, deviceAt: new Date().toISOString() }
        : { membershipId: selectedCard.id, rewardVersionId: (value as CashierReward).id, idempotencyKey: pending.idempotencyKey, requestId: pending.requestId, deviceAt: new Date().toISOString() });
      pendingRef.current = null;
      setCard(current => current?.id === selectedCard.id ? { ...current, balance: result.balance, rewards: current.rewards.map(reward => ({ ...reward, eligible: result.balance >= reward.cost })) } : current);
      setStatus("success"); setMessage(result.duplicate ? locale === "fr" ? "L’opération était déjà enregistrée. Le solde est à jour." : "Der Vorgang war bereits gebucht. Der Kontostand ist aktuell." : kind === "award" ? locale === "fr" ? "Les tampons ou points ont été ajoutés." : "Stempel oder Punkte wurden vergeben." : locale === "fr" ? "La récompense a été utilisée." : "Die Prämie wurde eingelöst.");
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.status === 403) { setAccessState("blocked"); setAccessMessage("Dein Kassenzugang ist nicht mehr aktiv."); }
      const uncertain = cause instanceof ClientApiError && (cause.status === 0 || cause.status >= 500);
      if (!uncertain) pendingRef.current = null;
      setStatus(uncertain ? "pending" : "rejected");
      setMessage(uncertain ? locale === "fr" ? "Résultat incertain. Confirmez à nouveau la même action : elle conserve son identifiant et ne sera pas comptée deux fois." : "Ergebnis unklar. Bitte dieselbe Aktion erneut bestätigen; sie behält ihre Anfragekennung und wird nicht doppelt gebucht." : cause instanceof Error ? cause.message : locale === "fr" ? "Opération refusée." : "Buchung abgelehnt.");
    } finally { setBusy(false); }
  }

  if (accessState !== "ready") return <main className="app-state-page"><div className="app-state-card"><BrandMark /><h1>{accessState === "loading" ? "Kassenzugang wird geprüft" : "Zugang gesperrt oder nicht eingerichtet"}</h1><p>{accessState === "loading" ? "Dein Standort und deine Berechtigung werden geladen." : accessMessage}</p>{accessState === "blocked" && <a href="/login" className="button button--outline">Zur Anmeldung</a>}</div></main>;
  return <><CashierView locationName={locationName} card={card} busy={busy} status={status} message={message} onLookup={lookup} onStartCamera={() => setScannerOpen(true)} onAward={(selected, quantity) => transact("award", selected, quantity)} onRedeem={(selected, reward) => transact("redeem", selected, reward)} onClear={() => { setCard(null); setStatus("idle"); setMessage(""); pendingRef.current = null; }} locale={locale} onLocaleChange={setLocale} showOverview={showOverview} />{scannerOpen && <QrScanner locale={locale} onDetected={text => { setScannerOpen(false); void lookup(text.trim()); }} onClose={() => setScannerOpen(false)} />}</>;
}
