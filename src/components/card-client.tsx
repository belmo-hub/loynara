"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiJson, ClientApiError, postJson, type CardResponse } from "./client-api";
import { createRefreshGate } from "@/lib/refresh-gate";
import { BrandMark, CustomerCardView } from "./loyalty-ui";
import { CardContact } from "./card-contact";
import { CardReferral } from "./card-referral";

type WalletStatus = {
  apple: { ready: boolean };
  google: { ready: boolean; publishingStatus: "demo" | "published" };
};

/** Never re-read the card more often than this when the guest comes back to the page. */
const REFRESH_INTERVAL_MS = 5_000;
/**
 * The guest often keeps the card open and visible while the cashier books on another device, so no focus or visibility
 * event follows. After the card is shown (opened, or looked at again) it is re-read a few times, then not again until
 * the next return. Bounded on purpose: guests on one shop Wi-Fi share the card-read limit.
 */
const FOLLOW_UP_MS = [20_000, 60_000];
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

export function CardClient({ token }: { token: string }) {
  const [card, setCard] = useState<CardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [walletStatus, setWalletStatus] = useState<WalletStatus | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [closed, setClosed] = useState(false);
  const gate = useRef(createRefreshGate(REFRESH_INTERVAL_MS));
  const live = useRef(false);
  const refreshNow = useRef<() => void>(() => {});
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let mounted = true;
    void apiJson<CardResponse>(`/api/card/${encodeURIComponent(token)}`).then(result => { if (mounted) { setCard(result); setLoading(false); live.current = true; gate.current.markLoaded(); } void apiJson(`/api/card/${encodeURIComponent(token)}/tap-session`, { method: "POST" }).then(() => continueTap()).catch(() => {}); }).catch(cause => { if (mounted) { setError(cardError(cause)); setLoading(false); } });
    return () => { mounted = false; };
  }, [token]);
  // The guest shows the phone, the cashier books, the guest looks again: re-read the balance when the page becomes
  // visible or focused again (also after a back navigation), a few times shortly after that, and on "Aktualisieren";
  // coalesced and at most every REFRESH_INTERVAL_MS. A card that stopped existing (closed or reissued elsewhere) is
  // replaced by a plain message; network trouble keeps the last known state.
  useEffect(() => {
    let mounted = true;
    let followUps: Array<ReturnType<typeof setTimeout>> = [];
    function refresh(manual = false) {
      if (!live.current || document.visibilityState !== "visible" || !gate.current.tryStart()) return;
      if (manual) setRefreshing(true);
      void apiJson<CardResponse>(`/api/card/${encodeURIComponent(token)}`)
        .then(result => { if (mounted && live.current) setCard(result); })
        .catch(cause => { if (mounted && cause instanceof ClientApiError && cause.status === 404) { live.current = false; setCard(null); setError(GONE_MESSAGE); } })
        .finally(() => { gate.current.finish(); if (mounted) setRefreshing(false); });
    }
    function followUp() {
      followUps.forEach(clearTimeout);
      followUps = FOLLOW_UP_MS.map(delay => setTimeout(() => refresh(), delay));
    }
    function onReturn() {
      if (document.visibilityState !== "visible") return;
      refresh();
      followUp();
    }
    function onPageShow(event: PageTransitionEvent) { if (event.persisted) onReturn(); }
    refreshNow.current = () => refresh(true);
    followUp();
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onPageShow);
    return () => { mounted = false; followUps.forEach(clearTimeout); document.removeEventListener("visibilitychange", onReturn); window.removeEventListener("focus", onReturn); window.removeEventListener("pageshow", onPageShow); };
  }, [token]);
  useEffect(() => {
    let mounted = true;
    void apiJson<WalletStatus>("/api/wallet/status").then(result => { if (mounted) setWalletStatus(result); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  async function openGoogleWallet() {
    setWalletBusy(true); setWalletError("");
    try {
      const result = await apiJson<{ url: string; publishingStatus: "demo" | "published" }>(`/api/wallet/google/${encodeURIComponent(token)}`);
      const target = new URL(result.url);
      if (target.protocol !== "https:" || target.hostname !== "pay.google.com") throw new Error("Ungültiger Google-Wallet-Link.");
      window.location.assign(target.href);
    } catch (cause) { setWalletError(cause instanceof Error ? cause.message : "Google Wallet konnte nicht vorbereitet werden."); setWalletBusy(false); }
  }

  async function closeCurrentCard() {
    setCloseBusy(true); setCloseError("");
    try {
      await postJson<{ closed: true }>(`/api/card/${encodeURIComponent(token)}/close`, { confirm: "CLOSE_CARD" });
      live.current = false;
      setClosed(true);
      setCard(null);
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : "Die Karte konnte nicht geschlossen werden.");
    } finally { setCloseBusy(false); }
  }

  if (closed) return <CardState title="Karte geschlossen." message="Dieser Kartenlink und der QR-Code sind nicht mehr nutzbar. Frühere Buchungen bleiben vorerst unter einer pseudonymen Karten-ID gespeichert, bis eine geprüfte Aufbewahrungsregel feststeht." />;
  if (loading) return <CardState title="Deine Karte wird geladen." message="Kontostand und Prämien werden abgerufen." />;
  if (!card) return <CardState title="Karte nicht erreichbar." message={error} />;
  const firstReward = card.rewards[0];
  const french = card.locale === "fr";
  const activity = card.activity.map((entry, index) => ({ id: `${entry.createdAt}-${index}`, label: entry.kind === "award" ? entry.isPurchase ? french ? "Achat enregistré" : "Kauf erfasst" : french ? "Visite enregistrée" : "Besuch erfasst" : entry.kind === "redeem" ? french ? "Récompense utilisée" : "Prämie eingelöst" : french ? "Correction" : "Korrektur", date: new Date(entry.createdAt).toLocaleDateString(french ? "fr-FR" : "de-DE", { day: "2-digit", month: "short", year: "numeric" }), change: entry.delta }));
  return <CustomerCardView businessName={card.merchantName} locationName={card.locationName} programType={card.programType === "stamp" ? "stamps" : "points"} balance={card.balance} rewardName={firstReward?.title} rewardCost={firstReward?.cost} rewards={card.rewards} cardLocator={card.cardLocator} qrSrc={`/api/qr?value=${encodeURIComponent(card.scanCode)}`} brandColor={card.brandColor} activity={activity} rulesText={card.rulesText} locale={card.locale} exportUrl={`/api/card/${encodeURIComponent(token)}/export`} contactPanel={<><CardContact token={token} locale={french ? "fr" : "de"} /><CardReferral token={token} locale={french ? "fr" : "de"} /></>} onRefresh={() => refreshNow.current()} refreshing={refreshing} onCloseCard={closeCurrentCard} closeBusy={closeBusy} closeError={closeError} appleWalletUrl={walletStatus?.apple.ready ? `/api/wallet/apple/${encodeURIComponent(token)}` : undefined} onGoogleWallet={walletStatus?.google.ready ? openGoogleWallet : undefined} googleWalletBusy={walletBusy} googlePublishingStatus={walletStatus?.google.publishingStatus} walletError={walletError} />;
}

function CardState({ title, message }: { title: string; message: string }) {
  return <main className="card-state-page"><div><BrandMark /><h1>{title}</h1><p>{message}</p><Link href="/">Zur Startseite</Link></div></main>;
}
