import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

/*
 * Adversarial review of a7a7c12 (agent 6). Pure unit test of public/cashier-sw.js, evaluated against a fake `self`.
 * Run (no database needed):
 *   npx vitest run src/lib/cashier-sw.adversarial.test.ts
 *
 * Every test here checks a property that the worker already has (SOUND): generic notification text only, no customer
 * data, fixed open target, same-origin focus only, no fetch handler.
 */

const ORIGIN = "https://kasse.example.test";
const SOURCE = readFileSync(new URL("../../public/cashier-sw.js", import.meta.url), "utf8");

type Listener = (event: Record<string, unknown>) => void;

function loadWorker(clientUrls: string[] = []) {
  const listeners: Record<string, Listener> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const focused: string[] = [];
  const notificationsClosed = vi.fn();
  const self = {
    location: { origin: ORIGIN },
    registration: {
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); }),
      getNotifications: vi.fn(async () => [{ close: notificationsClosed }]),
    },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => clientUrls.map(url => ({ url, focus: async () => { focused.push(url); } }))),
      openWindow: vi.fn(async (url: string) => { opened.push(url); }),
    },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, handler: Listener) => { listeners[type] = handler; },
  };
  runInNewContext(SOURCE, { self, URL, console });
  return { listeners, shown, opened, focused, self, notificationsClosed };
}

function dispatch(listener: Listener | undefined, event: Record<string, unknown>) {
  const pending: Promise<unknown>[] = [];
  listener?.({ ...event, waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } });
  return Promise.all(pending);
}

describe("cashier service worker", () => {
  it("has no fetch handler and no cache (sound: authenticated responses are never stored or served here)", () => {
    const { listeners } = loadWorker();
    expect(listeners.fetch).toBeUndefined();
    expect(SOURCE).not.toMatch(/caches\.|cache\.put|addAll\(/);
  });

  it("shows only the generic text for a valid payload, and no customer data reaches the notification (sound)", async () => {
    const { listeners, shown } = loadWorker();
    await dispatch(listeners.push, { data: { json: () => ({ v: 1, kind: "tap_pending", locale: "fr" }) } });
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("Nouvelle demande NFC");
    expect(shown[0].options).toMatchObject({ tag: "loynara-tap" });
    expect(JSON.stringify(shown[0])).not.toMatch(/K-|sc_|card_|balance|Stand|Solde/);
  });

  it("falls back to the German text for unknown, prototype-named or unparseable payloads (sound)", async () => {
    for (const data of [
      { json: () => ({ v: 1, kind: "tap_pending", locale: "constructor" }) },
      { json: () => ({ v: 1, kind: "tap_pending", locale: "__proto__" }) },
      { json: () => ({ v: 2, kind: "tap_pending", locale: "fr" }) },
      { json: () => { throw new SyntaxError("bad json"); } },
      null,
    ]) {
      const { listeners, shown } = loadWorker();
      await dispatch(listeners.push, { data });
      expect(shown[0].title).toBe("Neue NFC-Anfrage");
    }
  });

  it("opens the cashier on click and focuses only a same-origin cashier window (sound: no open redirect)", async () => {
    const { listeners, opened, focused, notificationsClosed } = loadWorker(["https://evil.example.test/cashier", ORIGIN + "/owner"]);
    await dispatch(listeners.notificationclick, { notification: { close: notificationsClosed } });
    expect(notificationsClosed).toHaveBeenCalled();
    expect(focused).toEqual([]);
    expect(opened).toEqual([`${ORIGIN}/cashier`]);
  });

  it("focuses an existing same-origin cashier window instead of opening a new one (sound)", async () => {
    const { listeners, opened, focused, notificationsClosed } = loadWorker([`${ORIGIN}/cashier`]);
    await dispatch(listeners.notificationclick, { notification: { close: notificationsClosed } });
    expect(focused).toEqual([`${ORIGIN}/cashier`]);
    expect(opened).toEqual([]);
  });

  it("ignores clear requests from a foreign origin and only closes tap notifications otherwise (sound)", async () => {
    const { listeners, self, notificationsClosed } = loadWorker();
    await dispatch(listeners.message, { origin: "https://evil.example.test", data: { type: "loynara:clear-tap-notifications" } });
    expect(self.registration.getNotifications).not.toHaveBeenCalled();
    await dispatch(listeners.message, { origin: ORIGIN, data: { type: "loynara:clear-tap-notifications" } });
    expect(self.registration.getNotifications).toHaveBeenCalledWith({ tag: "loynara-tap" });
    expect(notificationsClosed).toHaveBeenCalled();
  });
});
