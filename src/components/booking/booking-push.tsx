"use client";

import { useEffect, useState } from "react";
import { base64UrlToUint8Array } from "@/lib/cashier-push-client";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import card from "../customer/customer-card.module.css";
import styles from "./customer-flow.module.css";
import type { PushView } from "./booking-format";
import { REBOOK_CONSENT } from "@/lib/booking/rebook-consent-text";

const SW_URL = "/card-sw.js";

async function send(url: string, method: "POST" | "DELETE", body: unknown) {
  const response = await fetch(url, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw Object.assign(new Error(String(response.status)), { code: (await response.json().catch(() => ({})))?.code });
}

const FAILED: Record<string, string> = { PUSH_DEVICE_IN_USE: "Dieses Gerät ist schon bei einer anderen Karte angemeldet. Schalte die Erinnerungen dort aus, dann geht es hier.", PUSH_UNAVAILABLE: "Mitteilungen sind hier nicht eingerichtet." };

/**
 * „Erinnerungen aktivieren“ (service messages) and, separately and unticked, the rebook opt-in (marketing). Renders nothing
 * where the server has no push keys; on an iPhone outside the Home Screen it explains the one way to get push.
 */
export function BookingPush({ base, scope, push, reload }: { base: string; scope: string; push: PushView; reload: () => Promise<void> }) {
  const [local, setLocal] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker.getRegistration(scope).then(registration => registration?.scope.endsWith(scope) ? registration.pushManager.getSubscription() : null).then(subscription => setLocal(subscription ?? null), () => undefined);
  }, [supported, scope, push.subscribed]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); await reload(); }
    catch (cause) { setError(FAILED[(cause as { code?: string }).code ?? ""] ?? "Das hat nicht geklappt. Versuch es noch mal."); }
    finally { setBusy(false); }
  }

  const consent = <Checkbox checked={push.rebookConsent} disabled={busy} onChange={event => { const rebook = event.target.checked; void run(() => send(`${base}/consent`, "POST", { rebook })); }}
    description={REBOOK_CONSENT.description}>{REBOOK_CONSENT.label}</Checkbox>;
  const failed = error ? <p className={card.alert} role="alert">{error}</p> : null;

  // A yes given in the home-screen app must stay withdrawable from any browser, with or without push here.
  if (!push.publicKey || !supported) return push.publicKey || push.rebookConsent ? <div data-slot="booking-push">
    {push.publicKey ? <p className={card.muted}>Leg die Karte auf dem iPhone auf den Home-Bildschirm und erlaube dann Mitteilungen.</p> : null}
    {push.rebookConsent ? consent : null}
    {failed}
  </div> : null;
  const publicKey = push.publicKey;

  // The permission prompt comes first, before any other await, so the browser still sees the tap.
  const enable = () => run(async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setError(permission === "denied" ? "Mitteilungen sind im Browser blockiert. Erlaube sie in den Einstellungen." : "Ohne Mitteilungen gibt es keine Erinnerung."); return; }
    const registration = await navigator.serviceWorker.register(SW_URL, { scope, updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(publicKey) });
    await send(`${base}/push`, "POST", { subscription: subscription.toJSON() });
    setLocal(subscription);
  });

  const disable = () => run(async () => {
    if (!local) return;
    await send(`${base}/push`, "DELETE", { endpoint: local.endpoint });
    await local.unsubscribe();
    setLocal(null);
  });

  // `on`: some device of the card is registered; `here`: this browser is one of them. Another device can always join.
  const on = push.subscribed, here = on && Boolean(local);
  return <div data-slot="booking-push">
    <p><strong>Erinnerungen: {here ? "aktiv" : on ? "aktiv auf einem anderen Gerät" : "aus"}</strong></p>
    <p className={card.muted}>{here ? "Du bekommst eine Mitteilung einen Tag und zwei Stunden vor dem Termin." : on ? "Auf diesem Gerät noch nicht. Aktivier sie hier, dann kommt die Mitteilung auch hierhin." : "Erinnerung nur mit Mitteilungen: einen Tag und zwei Stunden vor dem Termin."}</p>
    {here ? <Button variant="quiet" size="sm" className={styles.edge} loading={busy} onClick={() => void disable()}>Erinnerungen ausschalten</Button>
      : <Button variant="secondary" size="sm" loading={busy} onClick={() => void enable()}>{on ? "Auch hier aktivieren" : "Erinnerungen aktivieren"}</Button>}
    {consent}
    {failed}
  </div>;
}
