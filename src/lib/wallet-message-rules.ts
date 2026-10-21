// Wallet messages (ENG-043): the pure rules and the verbatim texts. No database, so client code may import it.
// Rules are Product's (2026-10-22-spec-wallet-messages.md), texts are Legal's draft of 22 Oct 2026 (not legal advice).

export const MESSAGE_MAX = 140;
/** Messages per programme and per customer in any rolling window of this many days (the consent text promises „höchstens 2 pro Woche“). */
export const SHOP_WEEKLY_CAP = 2;
export const CUSTOMER_WEEKLY_CAP = 2;
export const CAP_WINDOW_DAYS = 7;
/** No sending 21:00 to 08:00 local time; a send in that window is refused, not queued. */
export const WALLET_QUIET_HOURS = { startHour: 21, endHour: 8 } as const;

export const CONSENT_TEXT_VERSION = "wallet-consent-2026-10-22-v1";
export const OWNER_TEXT_VERSION = "wallet-owner-2026-10-22-v1";

export const OWNER_CONFIRM_TEXT = "Ich bin für den Inhalt verantwortlich; Angebote sind wahr und werden eingehalten.";
export const OWNER_GUIDANCE = "Du bist für deine Nachrichten verantwortlich. Bitte schreib nur, was stimmt und was du einhältst: Ein Angebot „bis 17 Uhr“ gilt dann auch bis 17 Uhr. Nicht erlaubt: Werbung für Tabak oder E-Zigaretten, Alkohol-Werbung, die sich an Jugendliche richtet, Heilversprechen, erfundene Knappheit („nur noch 2 Plätze“, wenn es nicht stimmt), „statt“-Preise, die es nie gab, und Namen oder Daten einzelner Kunden. Bedingungen eines Angebots (wann, wie lange, wofür) gehören in die Nachricht oder auf die Karte.";

export function consentText(shop: string, location: string) {
  return `Ja, ${shop}, ${location}, darf mir Angebote, Neuigkeiten und Erinnerungen als Nachricht auf meiner Wallet-Karte schicken (höchstens 2 pro Woche). Das ist freiwillig und für die Karte nicht nötig. Ich kann es jederzeit hier auf meiner Karte abschalten. Mehr in den Datenschutzhinweisen.`;
}

export const QUIET_HOURS_REFUSAL = "Zwischen 21 und 8 Uhr senden wir keine Nachrichten, damit niemand nachts geweckt wird. Ab 8 Uhr geht es wieder.";

// A first line of defence only; the owner's confirmation is the real control (Legal). Each rule names what was matched in plain German.
const rules: Array<[RegExp, string]> = [
  [/tabak|zigarette|e-?zigarette|vape|vaping|snus|liquid/i, "Werbung für Tabak und E-Zigaretten ist nicht erlaubt."],
  [/heil(?:t|ung|end|mittel|versprechen)|therap|medizinisch|krebs|diabetes|gesundheitsfördernd|senkt den blutdruck/i, "Gesundheits- und Heilversprechen sind nicht erlaubt."],
  [/(?:alkohol|bier|wein|sekt|schnaps|whisky|wodka|vodka|likör|cocktail|shots?)[^]*(?:jugendliche|minderjährig|teenager|schüler|unter 18|kinder)|(?:jugendliche|minderjährig|teenager|schüler|unter 18|kinder)[^]*(?:alkohol|bier|wein|sekt|schnaps|whisky|wodka|vodka|likör|cocktail|shots?)/i, "Alkohol-Werbung, die sich an Jugendliche richtet, ist nicht erlaubt."],
];

/** Trimmed single-line text, or a German refusal. Plain text only: no links, no control characters, at most 140 characters. */
export function checkMessageText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = typeof raw === "string" ? raw.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, error: "Bitte schreib eine Nachricht." };
  if (Array.from(text).length > MESSAGE_MAX) return { ok: false, error: `Die Nachricht ist zu lang: höchstens ${MESSAGE_MAX} Zeichen.` };
  if (/\p{Cc}/u.test(text)) return { ok: false, error: "Die Nachricht darf nur aus einfachem Text bestehen." };
  if (/https?:|www\.|@|\b[a-z0-9-]+\.(?:de|com|net|org|eu|io|app|shop|link|ly)\b/i.test(text)) return { ok: false, error: "Links und Adressen sind in Nachrichten nicht erlaubt. Kunden können nichts anklicken." };
  for (const [pattern, error] of rules) if (pattern.test(text)) return { ok: false, error };
  return { ok: true, text };
}

/** Hint only, never blocks: a promotion needs the matching action switched on at the counter. */
export const needsActionHint = (text: string) => /punkte|stempel|doppelt/i.test(text);
export const ACTION_HINT = "Versprich nur, was an der Kasse auch gilt: Schalte die Aktion für diese Zeit ein.";

/** „Montag, 27. Oktober, 10:14 Uhr“ in the shop's timezone. */
export function germanWhen(date: Date, timeZone: string) {
  const day = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone }).format(date);
  return `${day}, ${new Intl.DateTimeFormat("de-DE", { hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZone }).format(date)} Uhr`;
}
