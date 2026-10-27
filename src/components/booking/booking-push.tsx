"use client";

import { useEffect, useState } from "react";
import { base64UrlToUint8Array } from "@/lib/cashier-push-client";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import card from "../customer/customer-card.module.css";
import type { PushView } from "./booking-format";

const SW_URL = "/card-sw.js", SW_SCOPE = "/card/";

async function send(url: string, method: "POST" | "DELETE", body: unknown) {
  const response = await fetch(url, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw Object.assign(new Error(String(response.status)), { code: (await response.json().catch(() => ({})))?.code });
}

const FAILED: Record<string, string> = { PUSH_DEVICE_IN_USE: "Dieses Gerät ist schon bei einer anderen Karte angemeldet. Schalte die Erinnerungen dort aus, dann geht es hier.", PUSH_UNAVAILABLE: "Mitteilungen sind hier nicht eingerichtet." };

/**
 * „Erinnerungen aktivieren“ (service messages) and, separately and unticked, the rebook opt-in (marketing). Renders nothing
 * where the server has no push keys; on an iPhone outside the Home Screen it explains the one way to get push.
 */
export function BookingPush({ base, push, reload }: { base: string; push: PushView; reload: () => Promise<void> }) {
  const [local, setLocal] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker.getRegistration(SW_SCOPE).then(registration => registration?.pushManager.getSubscription()).then(subscription => setLocal(subscription ?? null), () => undefined);
  }, [supported, push.subscribed]);

  if (!push.publicKey) return null;
  if (!supported) return <p className={card.muted} data-slot="booking-push">Auf dem iPhone: Karte zum Home-Bildschirm hinzufügen, dann Mitteilungen erlauben.</p>;
  const publicKey = push.publicKey;

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); await reload(); }
    catch (cause) { setError(FAILED[(cause as { code?: string }).code ?? ""] ?? "Das hat nicht geklappt. Versuch es noch mal."); }
    finally { setBusy(false); }
  }

  // The permission prompt comes first, before any other await, so the browser still sees the tap.
  const enable = () => run(async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setError(permission === "denied" ? "Mitteilungen sind im Browser blockiert. Erlaube sie in den Einstellungen." : "Ohne Mitteilungen gibt es keine Erinnerung."); return; }
    await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, updateViaCache: "none" });
    const registration = await navigator.serviceWorker.ready;
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
    {here ? <Button variant="quiet" size="sm" loading={busy} onClick={() => void disable()}>Erinnerungen ausschalten</Button>
      : <Button variant="secondary" size="sm" loading={busy} onClick={() => void enable()}>{on ? "Auch hier aktivieren" : "Erinnerungen aktivieren"}</Button>}
    <Checkbox checked={push.rebookConsent} disabled={busy} onChange={event => { const rebook = event.target.checked; void run(() => send(`${base}/consent`, "POST", { rebook })); }}
      description="Freiwillig. Du kannst es hier jederzeit wieder abschalten.">Erinnere mich, wenn der nächste Termin fällig ist</Checkbox>
    {error ? <p className={card.alert} role="alert">{error}</p> : null}
  </div>;
}
