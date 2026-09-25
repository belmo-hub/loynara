"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson, postJson, type CardResponse } from "./client-api";
import { BrandMark, CustomerCardView } from "./loyalty-ui";
import { CardContact } from "./card-contact";

type WalletStatus = {
  apple: { ready: boolean };
  google: { ready: boolean; publishingStatus: "demo" | "published" };
};

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
  useEffect(() => {
    let mounted = true;
    void apiJson<CardResponse>(`/api/card/${encodeURIComponent(token)}`).then(result => { if (mounted) { setCard(result); setLoading(false); } }).catch(cause => { if (mounted) { setError(cause instanceof Error ? cause.message : "Karte nicht gefunden."); setLoading(false); } });
    return () => { mounted = false; };
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
  return <CustomerCardView businessName={card.merchantName} locationName={card.locationName} programType={card.programType === "stamp" ? "stamps" : "points"} balance={card.balance} rewardName={firstReward?.title} rewardCost={firstReward?.cost} rewards={card.rewards} cardCode={card.scanCode} qrSrc={`/api/qr?value=${encodeURIComponent(card.scanCode)}`} brandColor={card.brandColor} activity={activity} rulesText={card.rulesText} locale={card.locale} exportUrl={`/api/card/${encodeURIComponent(token)}/export`} contactPanel={<CardContact token={token} locale={french ? "fr" : "de"} />} onCloseCard={closeCurrentCard} closeBusy={closeBusy} closeError={closeError} appleWalletUrl={walletStatus?.apple.ready ? `/api/wallet/apple/${encodeURIComponent(token)}` : undefined} onGoogleWallet={walletStatus?.google.ready ? openGoogleWallet : undefined} googleWalletBusy={walletBusy} googlePublishingStatus={walletStatus?.google.publishingStatus} walletError={walletError} />;
}

function CardState({ title, message }: { title: string; message: string }) {
  return <main className="card-state-page"><div><BrandMark /><h1>{title}</h1><p>{message}</p><Link href="/">Zur Startseite</Link></div></main>;
}
