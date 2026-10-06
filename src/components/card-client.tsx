"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson, ClientApiError, postJson, type CardResponse } from "./client-api";
import { BrandMark, CustomerCardView } from "./loyalty-ui";
import { CardContact } from "./card-contact";
import { CardReferral } from "./card-referral";

type WalletAvailability = { apple: "available" | "unavailable"; google: "available" | "test_only" | "unavailable" };

function walletPlatform(): "ios" | "android" | "other" {
  const agent = navigator.userAgent;
  if (/iPhone|iPod/.test(agent) || (/iPad|Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(agent) ? "android" : "other";
}

function walletMessage(cause: unknown, french: boolean): string {
  const code = cause instanceof ClientApiError ? cause.code : undefined;
  const status = cause instanceof ClientApiError ? cause.status : -1;
  if (status === 0) return french ? "Pas de connexion. Vérifiez votre connexion Internet et réessayez." : "Keine Verbindung. Bitte prüfe deine Internetverbindung und versuche es erneut.";
  if (code === "RATE_LIMIT") return french ? "Trop de tentatives. Patientez un instant puis réessayez." : "Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.";
  if (code === "NOT_FOUND") return french ? "Ce lien de carte n’est plus valable. Ouvrez votre lien de carte actuel." : "Dieser Kartenlink gilt nicht mehr. Öffne deinen aktuellen Kartenlink.";
  if (code === "WALLET_UNAVAILABLE") return french ? "Wallet n’est pas disponible pour le moment. Votre carte fonctionne toujours ici, dans le navigateur." : "Wallet ist gerade nicht verfügbar. Deine Karte funktioniert weiterhin hier im Browser.";
  return french ? "Wallet est momentanément injoignable. Réessayez dans quelques minutes ; votre carte fonctionne toujours ici." : "Wallet ist gerade nicht erreichbar. Bitte versuche es in ein paar Minuten erneut; deine Karte funktioniert weiterhin hier.";
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
  const [wallet, setWallet] = useState<WalletAvailability | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [walletBusy, setWalletBusy] = useState<"apple" | "google" | null>(null);
  const [walletError, setWalletError] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    let mounted = true;
    void apiJson<CardResponse>(`/api/card/${encodeURIComponent(token)}`).then(result => { if (mounted) { setCard(result); setLoading(false); } void apiJson(`/api/card/${encodeURIComponent(token)}/tap-session`, { method: "POST" }).then(() => continueTap()).catch(() => {}); }).catch(cause => { if (mounted) { setError(cause instanceof Error ? cause.message : "Karte nicht gefunden."); setLoading(false); } });
    return () => { mounted = false; };
  }, [token]);
  useEffect(() => {
    let mounted = true;
    // No status, no buttons: a failed check never shows an action that might not work.
    void apiJson<WalletAvailability>("/api/wallet/status").then(result => { if (mounted) { setPlatform(walletPlatform()); setWallet(result); } }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // The card token goes in the POST body. Apple: a two-minute download link for Safari; Google: a Save link that names
  // the prepared Wallet object only.
  async function addToAppleWallet() {
    setWalletBusy("apple"); setWalletError("");
    try {
      const { url } = await postJson<{ url: string }>("/api/wallet/apple", { token });
      if (!/^\/api\/wallet\/apple\/download\/[A-Za-z0-9_.-]+$/.test(url)) throw new Error("Unexpected download link");
      window.location.assign(url);
      // A pass download keeps this page open; release the button once Safari has taken over.
      window.setTimeout(() => setWalletBusy(null), 4000);
    } catch (cause) { setWalletError(walletMessage(cause, card?.locale === "fr")); setWalletBusy(null); }
  }

  async function addToGoogleWallet() {
    setWalletBusy("google"); setWalletError("");
    try {
      const { url } = await postJson<{ url: string }>("/api/wallet/google", { token });
      const target = new URL(url);
      if (target.protocol !== "https:" || target.hostname !== "pay.google.com") throw new Error("Unexpected Google Wallet link");
      window.location.assign(target.href);
    } catch (cause) { setWalletError(walletMessage(cause, card?.locale === "fr")); setWalletBusy(null); }
  }

  async function closeCurrentCard() {
    setCloseBusy(true); setCloseError("");
    try {
      await postJson<{ closed: true }>(`/api/card/${encodeURIComponent(token)}/close`, { confirm: "CLOSE_CARD" });
      setClosed(true);
      setCard(null);
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : "Die Karte konnte nicht geschlossen werden.");
    } finally { setCloseBusy(false); }
  }

  if (closed) return <CardState title="Karte geschlossen." message="Dieser Kartenlink, der QR-Code und eine in Wallet gespeicherte Karte sind nicht mehr nutzbar. Frühere Buchungen bleiben vorerst unter einer pseudonymen Karten-ID gespeichert, bis eine geprüfte Aufbewahrungsregel feststeht." />;
  if (loading) return <CardState title="Deine Karte wird geladen." message="Kontostand und Prämien werden abgerufen." />;
  if (!card) return <CardState title="Karte nicht erreichbar." message={error} />;
  const firstReward = card.rewards[0];
  const french = card.locale === "fr";
  const activity = card.activity.map((entry, index) => ({ id: `${entry.createdAt}-${index}`, label: entry.kind === "award" ? entry.isPurchase ? french ? "Achat enregistré" : "Kauf erfasst" : french ? "Visite enregistrée" : "Besuch erfasst" : entry.kind === "redeem" ? french ? "Récompense utilisée" : "Prämie eingelöst" : french ? "Correction" : "Korrektur", date: new Date(entry.createdAt).toLocaleDateString(french ? "fr-FR" : "de-DE", { day: "2-digit", month: "short", year: "numeric" }), change: entry.delta }));
  return <CustomerCardView businessName={card.merchantName} locationName={card.locationName} programType={card.programType === "stamp" ? "stamps" : "points"} balance={card.balance} rewardName={firstReward?.title} rewardCost={firstReward?.cost} rewards={card.rewards} cardCode={card.scanCode} cardLocator={card.cardLocator} qrSrc={`/api/qr?value=${encodeURIComponent(card.scanCode)}`} brandColor={card.brandColor} activity={activity} rulesText={card.rulesText} locale={card.locale} exportUrl={`/api/card/${encodeURIComponent(token)}/export`} contactPanel={<><CardContact token={token} locale={french ? "fr" : "de"} /><CardReferral token={token} locale={french ? "fr" : "de"} /></>} onCloseCard={closeCurrentCard} closeBusy={closeBusy} closeError={closeError} onAppleWallet={wallet?.apple === "available" ? addToAppleWallet : undefined} onGoogleWallet={wallet && wallet.google !== "unavailable" ? addToGoogleWallet : undefined} walletBusy={walletBusy} googleTestOnly={wallet?.google === "test_only"} walletPlatform={platform} walletError={walletError} />;
}

function CardState({ title, message }: { title: string; message: string }) {
  return <main className="card-state-page"><div><BrandMark /><h1>{title}</h1><p>{message}</p><Link href="/">Zur Startseite</Link></div></main>;
}
