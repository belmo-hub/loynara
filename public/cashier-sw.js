/*
 * Loynara cashier service worker (scope: /cashier).
 * Shows a generic "new NFC request" notification. Push payloads and notifications never carry customer data.
 * Deliberately has no fetch handler and no cache: authenticated responses are never stored or served here.
 */

const TAP_TAG = "loynara-tap";
const CASHIER_PATH = "/cashier";
const REFRESH_MESSAGE = "loynara:tap-refresh";
const CLEAR_MESSAGE = "loynara:clear-tap-notifications";
const ICON_URL = "/cashier-icon-192.png";

const TEXT = {
  de: { title: "Neue NFC-Anfrage", body: "Öffne die Kasse und prüfe den Einkauf." },
  fr: { title: "Nouvelle demande NFC", body: "Ouvrez la caisse et vérifiez l’achat." },
};

function textForPayload(event) {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch (_error) {
    payload = null;
  }
  const valid = payload !== null
    && typeof payload === "object"
    && payload.v === 1
    && payload.kind === "tap_pending"
    && Object.prototype.hasOwnProperty.call(TEXT, payload.locale);
  return valid ? TEXT[payload.locale] : TEXT.de;
}

function isSameOriginCashierPath(url) {
  try {
    const parsed = new URL(url, self.location.origin);
    if (parsed.origin !== self.location.origin) return false;
    return parsed.pathname === CASHIER_PATH || parsed.pathname.startsWith(CASHIER_PATH + "/");
  } catch (_error) {
    return false;
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const text = textForPayload(event);
  event.waitUntil((async () => {
    await self.registration.showNotification(text.title, {
      body: text.body,
      tag: TAP_TAG,
      renotify: true,
      icon: ICON_URL,
    });
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      client.postMessage({ type: REFRESH_MESSAGE });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (isSameOriginCashierPath(client.url) && "focus" in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(new URL(CASHIER_PATH, self.location.origin).href);
  })());
});

self.addEventListener("message", (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  const data = event.data;
  if (!data || typeof data !== "object" || data.type !== CLEAR_MESSAGE) return;
  event.waitUntil((async () => {
    const notifications = await self.registration.getNotifications({ tag: TAP_TAG });
    for (const notification of notifications) {
      notification.close();
    }
  })());
});
