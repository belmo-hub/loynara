import { apiJson, postJson } from "@/components/client-api";

export type CashierLocale = "de" | "fr";

export type CashierPushState = "unsupported" | "needs_install" | "unavailable" | "blocked" | "off" | "on";

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export type PushEnvironment = {
  featuresAvailable: boolean;
  ios: boolean;
  standalone: boolean;
  serverAvailable: boolean;
  permission: PushPermission;
  subscribed: boolean;
};

export const CASHIER_SW_URL = "/cashier-sw.js";
export const CASHIER_SW_SCOPE = "/cashier";
export const TAP_REFRESH_EVENT = "loynara:tap-refresh";
export const TAP_REFRESH_MESSAGE = "loynara:tap-refresh";
export const CLEAR_TAP_NOTIFICATIONS_MESSAGE = "loynara:clear-tap-notifications";

const CONFIG_PATH = "/api/cashier/push/config";
const SUBSCRIPTION_PATH = "/api/cashier/push/subscription";
const JSON_HEADERS = { "Content-Type": "application/json" };
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type CashierPushConfig = { available: boolean; publicKey?: string };

/** Decodes a VAPID public key (base64url, no padding) into the bytes PushManager.subscribe expects. */
export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  if (!BASE64URL_PATTERN.test(value)) throw new Error("Ungültiger Schlüssel für Benachrichtigungen.");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** iPhone and iPad (iPadOS 13+ identifies as Macintosh but reports touch points). */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** iOS exposes home-screen launches through navigator.standalone; other browsers use display-mode. */
export function isStandaloneLaunch(input: { navigatorStandalone?: boolean; displayModeStandalone: boolean }): boolean {
  return input.navigatorStandalone === true || input.displayModeStandalone;
}

export function hasPushFeatures(input: { serviceWorker: boolean; pushManager: boolean; notification: boolean; secureContext: boolean }): boolean {
  return input.serviceWorker && input.pushManager && input.notification && input.secureContext;
}

/** Pure state decision. Order matters: an iPhone outside the home screen needs installing before anything else. */
export function resolvePushState(environment: PushEnvironment): CashierPushState {
  if (environment.ios && !environment.standalone) return "needs_install";
  if (!environment.featuresAvailable) return "unsupported";
  if (!environment.serverAvailable) return "unavailable";
  if (environment.permission === "denied") return "blocked";
  return environment.subscribed && environment.permission === "granted" ? "on" : "off";
}

/** True when a browser subscription was created with the given VAPID public key bytes. */
export function sameApplicationServerKey(existing: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  if (!existing) return false;
  const bytes = new Uint8Array(existing);
  if (bytes.length !== expected.length) return false;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== expected[index]) return false;
  }
  return true;
}

/** Accepts only the refresh message from the cashier service worker; everything else is ignored. */
export function isTapRefreshMessage(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === TAP_REFRESH_MESSAGE;
}

function readPushFeatures(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return hasPushFeatures({
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
    secureContext: window.isSecureContext === true,
  });
}

function readIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIosDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

function readStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  const displayModeStandalone = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return isStandaloneLaunch({ navigatorStandalone, displayModeStandalone });
}

function readPermission(): PushPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

async function currentRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!readPushFeatures()) return undefined;
  return navigator.serviceWorker.getRegistration(CASHIER_SW_SCOPE);
}

async function fetchPushConfig(): Promise<CashierPushConfig> {
  try {
    const config = await apiJson<CashierPushConfig>(CONFIG_PATH);
    if (!config.available || typeof config.publicKey !== "string" || !BASE64URL_PATTERN.test(config.publicKey)) {
      return { available: false };
    }
    return { available: true, publicKey: config.publicKey };
  } catch {
    return { available: false };
  }
}

/** Registers the cashier service worker with scope /cashier. Resolves null where push is not supported. */
export async function registerCashierWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!readPushFeatures()) return null;
  return navigator.serviceWorker.register(CASHIER_SW_URL, { scope: CASHIER_SW_SCOPE, updateViaCache: "none" });
}

export async function getPushState(): Promise<CashierPushState> {
  const featuresAvailable = readPushFeatures();
  const ios = readIos();
  const standalone = readStandalone();
  // No server round trip when this browser cannot receive push at all, or when iOS needs the home-screen install first.
  if (!featuresAvailable || (ios && !standalone)) {
    return resolvePushState({ featuresAvailable, ios, standalone, serverAvailable: false, permission: "unsupported", subscribed: false });
  }

  const config = await fetchPushConfig();
  const permission = readPermission();
  let subscribed = false;
  if (config.publicKey && permission === "granted") {
    const registration = await currentRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    subscribed = subscription !== null && sameApplicationServerKey(subscription.options.applicationServerKey, base64UrlToUint8Array(config.publicKey));
  }
  return resolvePushState({ featuresAvailable, ios, standalone, serverAvailable: config.available, permission, subscribed });
}

/**
 * Must be called from a user gesture (button click). The permission prompt is the first thing that happens, before any
 * await, so browsers still see the gesture.
 */
export async function enableCashierPush(locale: CashierLocale): Promise<CashierPushState> {
  if (!readPushFeatures()) return getPushState();
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";

  const config = await fetchPushConfig();
  if (!config.available || !config.publicKey) return "unavailable";

  await registerCashierWorker();
  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = base64UrlToUint8Array(config.publicKey);

  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameApplicationServerKey(subscription.options.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  }

  try {
    const result = await postJson<{ subscribed: boolean }>(SUBSCRIPTION_PATH, { ...subscription.toJSON(), locale });
    if (result.subscribed !== true) throw new Error("Benachrichtigungen konnten nicht gespeichert werden.");
  } catch (cause) {
    await subscription.unsubscribe().catch(() => false);
    throw cause;
  }
  return "on";
}

/** Removes the server record first, then the browser subscription, so a failed request leaves the state unchanged. */
export async function disableCashierPush(): Promise<CashierPushState> {
  const registration = await currentRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (subscription) {
    await apiJson<{ subscribed: boolean }>(SUBSCRIPTION_PATH, {
      method: "DELETE",
      headers: JSON_HEADERS,
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  }
  return "off";
}

/** Subscribes the page to refresh requests from the service worker. Returns the cleanup function. */
export function listenForTapRefresh(): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => undefined;
  const onMessage = (event: MessageEvent) => {
    if (isTapRefreshMessage(event.data)) window.dispatchEvent(new Event(TAP_REFRESH_EVENT));
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}

/** Closes open tap notifications, e.g. when a cashier has the counter open again. */
export async function clearTapNotifications(): Promise<void> {
  if (!readPushFeatures()) return;
  const registration = await navigator.serviceWorker.getRegistration(CASHIER_SW_SCOPE).catch(() => undefined);
  registration?.active?.postMessage({ type: CLEAR_TAP_NOTIFICATIONS_MESSAGE });
}
