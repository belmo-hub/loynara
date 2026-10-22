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

// ---- Win-back (ENG-044): fixed texts (Marketing v1.5, Legal 22 Oct). The owner picks only N and the bonus. ----------------

export const WINBACK_WINDOW_DAYS = 14;
export const WINBACK_DAYS = { min: 14, max: 90, default: 30 } as const;
/** Mon–Sat 10:00–18:00 in the location's timezone (ISO weekdays, as happy hour). */
export const WINBACK_SEND_WINDOW = { days: [1, 2, 3, 4, 5, 6], start: "10:00", end: "18:00" };

const extra = (type: "stamp" | "points", bonus: number) => type === "stamp" ? "einen Stempel extra" : `${bonus} Punkte extra`;
/** „5. November“: the deadline is a calendar date (YYYY-MM-DD), so it is formatted without a timezone shift. */
export const germanDay = (isoDate: string) => new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));

/** `day` is the deadline as shown („5. November“, see germanDay). */
export function winbackText(type: "stamp" | "points", bonus: number, day: string) {
  return bonus > 0 ? `Wir vermissen dich. Komm bis zum ${day} vorbei, dann gibt's ${extra(type, bonus)}.` : "Wir vermissen dich. Deine Karte wartet auf dich, schau gern mal wieder vorbei.";
}

/** The programme-rules line on the card while the bonus is on (Legal: the bonus must be in the rules customers see). */
export function winbackRule(type: "stamp" | "points", days: number, bonus: number) {
  return `Willkommen-zurück-Bonus: Warst du ${days} Tage nicht da, gibt es ${type === "stamp" ? "1 Stempel" : `${bonus} Punkte`} extra, wenn du innerhalb der folgenden 14 Tage wiederkommst. Mit Nachrichten auf deiner Wallet-Karte erinnern wir dich daran. Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.`;
}

export const winbackCashierLine = (type: "stamp" | "points", bonus: number) => `Willkommen zurück: +${bonus} ${type === "stamp" ? "Stempel" : "Punkte"} extra`;
export const WINBACK_EXCLUSIONS = "Nicht auf Tabak, Presse, Bücher, Lotto, Handyguthaben.";

/** Points bonus: 1 up to a quarter of the cheapest reward (Product); stamps: none or 1. */
export const winbackBonusMax = (type: "stamp" | "points", cheapestReward: number) => type === "stamp" ? 1 : Math.max(1, Math.floor(cheapestReward / 4));

// ---- "Fast geschafft" (ENG-045): Marketing 22 Oct, section 7. [Prämie] is the reward title as the owner typed it. ---------

/** A card this close to its next reward gets the reminder: 1 stamp, or up to about 10 points (founder brief). */
export const almostGap = (type: "stamp" | "points") => type === "stamp" ? 1 : 10;
export const almostText = (type: "stamp" | "points", missing: number, reward: string) =>
  type === "stamp" ? `Nur noch 1 Stempel bis zu deiner Prämie: ${reward}.` : `Nur noch ${missing} Punkte bis zu deiner Prämie: ${reward}.`;

// ---- Birthday (ENG-049): Legal 22 Oct (field and rules line), Marketing 22 Oct section 8 (reminder and cashier). -----------

export const BIRTHDAY_FIELD_TEXT = (shop: string) => `Geburtstag (freiwillig): nur Tag und Monat, kein Jahr. Damit kann dir ${shop} in deiner Geburtstagswoche eine kleine Prämie geben. Du kannst ihn jederzeit hier löschen.`;

export function birthdayText(type: "stamp" | "points", bonus: number, day: string) {
  return bonus > 0 ? `Alles Gute zum Geburtstag! Komm bis zum ${day} vorbei, dann gibt's ${extra(type, bonus)}.` : "Alles Gute zum Geburtstag! Wir freuen uns, dich bald wiederzusehen.";
}
export const birthdayRule = (type: "stamp" | "points", bonus: number) =>
  `Geburtstags-Prämie: Hast du auf deiner Karte Tag und Monat deines Geburtstags hinterlegt, bekommst du in deiner Geburtstagswoche bei einem bestätigten Besuch ${type === "stamp" ? "1 Stempel" : `${bonus} Punkte`} extra. Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.`;
export const birthdayCashierLine = (type: "stamp" | "points", bonus: number) => `Geburtstag: +${bonus} ${type === "stamp" ? "Stempel" : "Punkte"} extra`;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/**
 * The birthday week (Monday to Sunday) that contains `today` (YYYY-MM-DD, the shop's local date), or null. 29 February
 * counts as 28 February in other years. Checks the birthday in the year before and after too, for weeks across New Year.
 */
export function birthdayWeek(day: number, month: number, today: string): { start: string; end: string } | null {
  const year = Number(today.slice(0, 4));
  for (const y of [year - 1, year, year + 1]) {
    const leap = new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1;
    const birthday = new Date(Date.UTC(y, month - 1, month === 2 && day === 29 && !leap ? 28 : day));
    const monday = new Date(birthday.getTime() - ((birthday.getUTCDay() + 6) % 7) * 86_400_000);
    const start = isoDay(monday), end = isoDay(new Date(monday.getTime() + 6 * 86_400_000));
    if (start <= today && today <= end) return { start, end };
  }
  return null;
}
