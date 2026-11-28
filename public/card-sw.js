/*
 * Loynara card service worker, registered once per card (scope /card/<token>/). Shows booking reminders and shop notices sent by the server.
 * No fetch handler and no cache: card pages are never stored here. Clicks open only same-origin card pages.
 */

function cardUrl(raw) {
  try {
    const url = new URL(raw, self.location.origin);
    if (url.origin === self.location.origin && url.pathname.startsWith("/card/")) return url.href;
  } catch (_error) { /* fall through */ }
  return new URL("/", self.location.origin).href;
}

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_error) { data = {}; }
  const title = typeof data.title === "string" && data.title ? data.title : "Termin";
  const body = typeof data.body === "string" ? data.body : "";
  event.waitUntil(self.registration.showNotification(title, { body, data: { url: cardUrl(data.url) } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = cardUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url === url && "focus" in client) return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
