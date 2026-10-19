"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson, ClientApiError, postJson, type CardResponse } from "./client-api";
import { createRefreshGate, nextAutoRefresh } from "@/lib/refresh-gate";
import { CustomerCard } from "./customer/customer-card";
import { CustomerCardLoading, CustomerState } from "./customer/customer-state";
import { CardContact } from "./card-contact";
import { CardReferral } from "./card-referral";
import { Button } from "./ui/button";
import noticeStyles from "./customer/customer-notice.module.css";
import { prepareAppleWallet, readWalletStatus } from "./wallet-preparation";

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

/** Never re-read the card more often than this when the guest comes back to the page. */
const REFRESH_INTERVAL_MS = 5_000;
const noticeClass = noticeStyles.notice;
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
  const [switchRequired, setSwitchRequired] = useState(false);
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const [bindingError, setBindingError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [walletScope, setWalletScope] = useState<{ token: string; availability: WalletAvailability } | null>(null);
  const wallet = walletScope?.token === token ? walletScope.availability : null;
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [walletBusy, setWalletBusy] = useState<"apple" | "google" | null>(null);
  const [walletError, setWalletError] = useState("");
  const walletOperation = useRef<AbortController | null>(null);
  const downloadReset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  // A stamp booked while the card is open (the team scanned its code) lands on the card when the balance is re-read.
  const [landed, setLanded] = useState<number>();
  const balanceSeen = useRef<number | null>(null);
  const [closeError, setCloseError] = useState("");
  const [closed, setClosed] = useState(false);
  const gate = useRef(createRefreshGate(REFRESH_INTERVAL_MS));
  const live = useRef(false);
  const refreshNow = useRef<() => void>(() => {});
  const startAutoRefresh = useRef<() => void>(() => {});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    void apiJson<CardResponse>(`/api/enroll/card/${encodeURIComponent(token)}`).then(result => { if (mounted) { balanceSeen.current = result.balance; setCard(result); setRefreshFailed(false); setLoading(false); live.current = true; gate.current.markLoaded(); startAutoRefresh.current(); } void apiJson(`/api/tap/card/${encodeURIComponent(token)}/session`, { method: "POST" }).then(() => { if (mounted) setSwitchRequired(false); continueTap(); }).catch(cause => { if (mounted) { if (cause instanceof ClientApiError && cause.code === "ACCOUNT_SWITCH_REQUIRED") setSwitchRequired(true); else setAuthenticationRequired(true); } }); }).catch(cause => { if (mounted) { setError(cardError(cause)); setLoading(false); } });
    return () => { mounted = false; };
  }, [token]);
  // The guest shows the phone and the cashier books on another device, often with no focus or visibility event in
  // between. So while the card is visible it re-reads the balance by itself (cadence and budget: nextAutoRefresh),
  // starting again when the page becomes visible or focused (also after a back navigation); plus "Aktualisieren".
  // Coalesced and at most every REFRESH_INTERVAL_MS; a grown balance lands the new stamp. A card that stopped existing
  // (closed or reissued elsewhere) is replaced by a plain message; network trouble keeps the last known state; a read
  // the server refuses (rate limit) stops the automatic reads until the guest looks again.
  useEffect(() => {
    let mounted = true;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let shownAt = Date.now(), failures = 0;
    const reads: number[] = [];
    function refresh(manual = false): Promise<"ok" | "failed" | "stop" | "skipped"> {
      if (!live.current || document.visibilityState !== "visible" || !gate.current.tryStart()) return Promise.resolve("skipped");
      if (manual) setRefreshing(true);
      return apiJson<CardResponse>(`/api/card/${encodeURIComponent(token)}`)
        .then(result => {
          if (!mounted || !live.current) return "stop" as const;
          if (balanceSeen.current !== null && result.balance > balanceSeen.current) setLanded(result.balance);
          balanceSeen.current = result.balance;
          setCard(result); setRefreshFailed(false);
          return "ok" as const;
        })
        .catch(cause => {
          if (!mounted) return "stop" as const;
          if (cause instanceof ClientApiError && cause.status === 404) { live.current = false; setCard(null); setError(GONE_MESSAGE); return "stop" as const; }
          if (manual) setRefreshFailed(true);
          return cause instanceof ClientApiError && cause.code === "RATE_LIMIT" ? "stop" as const : "failed" as const;
        })
        .finally(() => { gate.current.finish(); if (mounted) setRefreshing(false); });
    }
    function schedule() {
      clearTimeout(poll);
      if (!mounted || document.visibilityState !== "visible") return;
      while (reads.length && Date.now() - reads[0] >= 15 * 60_000) reads.shift();
      const delay = nextAutoRefresh(Date.now() - shownAt, failures, reads.length);
      if (delay !== null) poll = setTimeout(() => void autoRefresh(), delay);
    }
    async function autoRefresh() {
      const outcome = await refresh();
      if (outcome === "stop") return;
      if (outcome !== "skipped") reads.push(Date.now());
      failures = outcome === "failed" ? failures + 1 : outcome === "ok" ? 0 : failures;
      schedule();
    }
    function onReturn() {
      clearTimeout(poll);
      if (document.visibilityState !== "visible") return;
      shownAt = Date.now(); failures = 0;
      void autoRefresh();
    }
    function onPageShow(event: PageTransitionEvent) { if (event.persisted) onReturn(); }
    refreshNow.current = () => void refresh(true);
    // The first window starts once the card has loaded, so its first re-read is not refused by the gate.
    startAutoRefresh.current = () => { shownAt = Date.now(); failures = 0; schedule(); };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onPageShow);
    return () => { mounted = false; clearTimeout(poll); document.removeEventListener("visibilitychange", onReturn); window.removeEventListener("focus", onReturn); window.removeEventListener("pageshow", onPageShow); };
  }, [token]);
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    // Capability belongs to this card's tenant/location. A failed check leaves the action hidden.
    void readWalletStatus(token, controller.signal).then(result => { if (mounted) { setPlatform(walletPlatform()); setWalletScope({ token, availability: result }); setWalletBusy(null); } }).catch(() => {});
    return () => {
      mounted = false; controller.abort(); walletOperation.current?.abort(); walletOperation.current = null;
      if (downloadReset.current) clearTimeout(downloadReset.current);
    };
  }, [token]);

  // Only a ready projection yields a fresh two-minute download ticket. Pending work stays in the worker.
  async function addToAppleWallet() {
    if (walletOperation.current) return;
    const controller = new AbortController(); walletOperation.current = controller;
    setWalletBusy("apple"); setWalletError("");
    try {
      const url = await prepareAppleWallet(token, controller.signal);
      if (controller.signal.aborted) return;
      window.location.assign(url);
      downloadReset.current = setTimeout(() => { walletOperation.current = null; setWalletBusy(null); }, 4000);
    } catch (cause) {
      if (!controller.signal.aborted) { setWalletError(walletMessage(cause, card?.locale === "fr")); setWalletBusy(null); }
      if (walletOperation.current === controller) walletOperation.current = null;
    }
  }

  async function addToGoogleWallet() {
    if (walletOperation.current) return;
    const controller = new AbortController(); walletOperation.current = controller;
    setWalletBusy("google"); setWalletError("");
    try {
      const { url } = await apiJson<{ url: string }>("/api/wallet/google", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const target = new URL(url);
      if (target.protocol !== "https:" || target.hostname !== "pay.google.com") throw new Error("Unexpected Google Wallet link");
      window.location.assign(target.href);
    } catch (cause) {
      if (!controller.signal.aborted) { setWalletError(walletMessage(cause, card?.locale === "fr")); setWalletBusy(null); }
    } finally {
      if (walletOperation.current === controller) walletOperation.current = null;
    }
  }

  async function bindBrowser(data: { authenticate: true } | { switchAccount: true }) {
    setBindingError("");
    try {
      await postJson(`/api/tap/card/${encodeURIComponent(token)}/session`, data);
      setAuthenticationRequired(false); setSwitchRequired(false); continueTap();
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.code === "ACCOUNT_SWITCH_REQUIRED") {
        setAuthenticationRequired(false); setSwitchRequired(true);
      } else setBindingError(cardError(cause));
    }
  }

  async function closeCurrentCard() {
    setCloseBusy(true); setCloseError("");
    try {
      await postJson<{ closed: true }>(`/api/card/${encodeURIComponent(token)}/close`, { confirm: "CLOSE_CARD" });
      live.current = false;
      walletOperation.current?.abort();
      setClosed(true);
      setCard(null);
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : "Die Karte konnte nicht geschlossen werden.");
    } finally { setCloseBusy(false); }
  }

  if (closed) return <CardState title="Karte geschlossen." message={wallet && (wallet.apple !== "unavailable" || wallet.google !== "unavailable") ? "Dieser Kartenlink, der QR-Code und eine in Wallet gespeicherte Karte sind nicht mehr nutzbar. Frühere Buchungen bleiben vorerst unter einer pseudonymen Karten-ID gespeichert, bis eine geprüfte Aufbewahrungsregel feststeht." : "Dieser Kartenlink und der QR-Code sind nicht mehr nutzbar. Frühere Buchungen bleiben vorerst unter einer pseudonymen Karten-ID gespeichert, bis eine geprüfte Aufbewahrungsregel feststeht."} />;
  if (loading) return <CustomerCardLoading label="Deine Karte wird geladen." />;
  if (!card) return <CardState title="Karte nicht erreichbar." message={error} tone="error" />;
  const firstReward = card.rewards[0];
  const french = card.locale === "fr";
  const activity = card.activity.map((entry, index) => ({ id: `${entry.createdAt}-${index}`, label: entry.kind === "award" ? entry.isPurchase ? french ? "Achat enregistré" : "Kauf erfasst" : french ? "Visite enregistrée" : "Besuch erfasst" : entry.kind === "redeem" ? french ? "Récompense utilisée" : "Prämie eingelöst" : french ? "Correction" : "Korrektur", date: new Date(entry.createdAt).toLocaleDateString(french ? "fr-FR" : "de-DE", { day: "2-digit", month: "short", year: "numeric" }), change: entry.delta }));
  const notices = <>
    {authenticationRequired && <section role="alert" className={noticeClass}><p>Bestätige deinen Browserzugang mit diesem privaten Kartenlink.</p><Button variant="secondary" size="sm" onClick={() => void bindBrowser({ authenticate: true })}>Mit meinem privaten Kartenlink anmelden</Button></section>}
    {switchRequired && <section role="alert" className={noticeClass}><p>Auf diesem Gerät ist eine andere Karte gespeichert. Soll künftig diese Karte für NFC verwendet werden? Auf einem geteilten Gerät bestätigen wir die Karte bei jeder Berührung.</p><Button variant="secondary" size="sm" onClick={() => void bindBrowser({ switchAccount: true })}>Diese Karte für NFC verwenden</Button></section>}
    {bindingError && <p role="alert" className={noticeClass}>{bindingError}</p>}
  </>;
  return <CustomerCard notices={notices} businessName={card.merchantName} locationName={card.locationName} programType={card.programType === "stamp" ? "stamps" : "points"} balance={card.balance} landed={landed} rewards={card.rewards.map(reward => ({ id: reward.id, title: reward.title, cost: reward.cost }))} cardLocator={card.cardLocator} qrSrc={`/api/qr?value=${encodeURIComponent(card.scanCode)}`} brandColor={card.brandColor} activity={activity} rulesText={card.rulesText} locale={french ? "fr" : "de"} exportUrl={`/api/card/${encodeURIComponent(token)}/export`} contactPanel={<><CardContact token={token} locale={french ? "fr" : "de"} /><CardReferral token={token} locale={french ? "fr" : "de"} /></>} onRefresh={() => refreshNow.current()} refreshing={refreshing} refreshFailed={refreshFailed} onCloseCard={closeCurrentCard} closeBusy={closeBusy} closeError={closeError} onAppleWallet={wallet?.apple === "available" ? addToAppleWallet : undefined} onGoogleWallet={wallet && wallet.google !== "unavailable" ? addToGoogleWallet : undefined} walletBusy={walletBusy} googleTestOnly={wallet?.google === "test_only"} walletPlatform={platform} walletError={walletError} />;
}

function CardState({ title, message, tone = "info" }: { title: string; message: string; tone?: "info" | "error" }) {
  // The page turns into this state after the card was shown, so focus the title to announce it.
  return <CustomerState title={title} message={message} tone={tone} focusTitle />;
}
