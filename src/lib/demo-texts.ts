import { DEMO_HOURS, DEMO_SLUG, demoEnvironment } from "./demo-environment";

/**
 * Legal's wording for the demo environment (legal-ops/2026-11-09-demo-mode-review.md). Pure, so the join page and the card
 * may import it; the server decides with demoEnvironment() whether a shop gets it (lib/demo shopDemo).
 */
export type DemoEnd = { date: string; time: string };

/** When a demo card ends: 24 hours after the shop was made, in the shop's time zone. */
export function demoEnd(createdAt: Date, timeZone: string): DemoEnd {
  const at = new Date(createdAt.getTime() + DEMO_HOURS * 60 * 60_000);
  return {
    date: new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone }).format(at),
    time: new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at),
  };
}

/** Legal change 2: on the join page, the card and the pass back. */
export const demoNoticeLine = (shop: string, end: DemoEnd) => `Demo von Loynara für ${shop}. Diese Karte endet am ${end.date} um ${end.time}. Stempel und Prämien gelten nicht.`;

/** Legal change 3: the join line in place of the terms acceptance. */
export const DEMO_JOIN_PRIVACY = "Datenschutzhinweisen zur Demo";
export const demoJoinLine = (button: string) => `Mit „${button}“ legst du eine Demo-Karte an. Mehr in den ${DEMO_JOIN_PRIVACY}.`;

/** Legal change 5: next to every count that includes the sample visits. */
export const DEMO_DATA_NOTE = "Demo-Daten: erfundene Beispiele, keine Prognose.";

/** Legal change 1: the demo's consent version (wallet-message-rules CONSENT_TEXTS). */
export const DEMO_CONSENT_TEXT_VERSION = "wallet-consent-demo-2026-11-09-v1";
export const demoConsentText = (shop: string, end?: DemoEnd) =>
  `Ja, Loynara darf mir in dieser Demo Nachrichten im Namen von ${shop} auf meine Wallet-Karte schicken (höchstens 2), bis die Demo am ${end?.date ?? "{Datum}"} um ${end?.time ?? "{Uhrzeit}"} endet. Das ist freiwillig. Ich kann es jederzeit auf meiner Karte abschalten.`;

/** A shop's demo facts, decided on the server: only in the demo environment, only for a shop „Demo starten“ made. */
export function shopDemo(shop: { name: string; slug: string; createdAt: Date }, timeZone: string, env: Record<string, string | undefined> = process.env) {
  if (!demoEnvironment(env) || !DEMO_SLUG.test(shop.slug)) return undefined;
  const end = demoEnd(shop.createdAt, timeZone);
  return { end, line: demoNoticeLine(shop.name, end) };
}
