import { MAX_POINTS_PER_CURRENCY_UNIT, parsePurchaseAmountMinor, PointsError, purchasePoints, purchaseRuleSentence } from "@/lib/points";
import { unitWord } from "@/lib/units";
import { germanDate } from "@/lib/german-date";

export type ProgramKind = "stamp" | "points";
export type EarningMode = "manual" | "purchase";
export const unitName = (type: ProgramKind, count = 2) => unitWord(count, type);
/** Dative plural for "in …" / "mit …" sentences. */
export const unitDative = (type: ProgramKind) => unitWord(2, type, "de", "dat");
export { MAX_POINTS_PER_CURRENCY_UNIT };

export function euro(minor: number, currency: string) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(minor / 100);
}

/** Readable one-sentence rule, derived only from the modes the backend supports. */
export function earningSentence(type: ProgramKind, mode: EarningMode, rate: number, currency: string) {
  if (type === "stamp") return "Dein Team vergibt Stempel an der Kasse. Die Menge wird dort bei jeder Vergabe bestätigt.";
  if (mode === "purchase") return purchaseRuleSentence(rate, currency);
  return "Dein Team vergibt Punkte manuell an der Kasse. Die Menge wird dort bei jeder Vergabe eingegeben.";
}

/** Who confirms is a separate question from how points are earned. The NFC sign is named only where the deployment offers it. */
export function confirmSentence(type: ProgramKind, mode: EarningMode, nfc: boolean) {
  const base = "Kunden können sich nichts selbst gutschreiben: Jede Vergabe bestätigt dein Team an der Kasse per QR-Scan oder Kartencode.";
  if (type === "points" && mode === "purchase") return `${base} Den Einkaufswert gibt das Team dort ein.${nfc ? " Das NFC-Schild überträgt keinen Betrag." : ""}`;
  return base;
}

/**
 * The setup's suggested rules text: how customers earn, nothing about rewards. The join page and the card list rewards
 * live; a reward sentence stored here stays behind when the owner changes the reward (ENG-101). By purchase amount the
 * system states the earning, so the field starts empty for extra rules (ENG-099 3c).
 */
export function draftRules(type: ProgramKind, mode: EarningMode) {
  if (type === "stamp") return "Pro bestätigtem Besuch vergibt das Team Stempel an der Kasse.";
  return mode === "purchase" ? "" : "Das Team vergibt Punkte an der Kasse.";
}

/** The rules field (W35, W51): stamps and manual points write the rule itself, points by purchase amount only what adds to it. */
export type RuleKind = "stamp" | "manual" | "purchase";
export const ruleKind = (type: ProgramKind, mode: EarningMode): RuleKind => type === "stamp" ? "stamp" : mode;
export const RULE_PLACEHOLDER: Record<RuleKind, string> = {
  stamp: "z. B. Ein Stempel pro Heißgetränk.", manual: "z. B. 10 Punkte pro Pizza.", purchase: "z. B. Karte vor dem Bezahlen zeigen. Nachträglich gibt es keine Punkte.",
};
/** The rule row's title, and its page's, where points come from the purchase amount. */
export const EXTRA_RULES = "Weitere Regeln";
export const EXTRA_RULES_LABEL = "Weitere Regeln (optional)";
export const EXTRA_RULES_HINT = "Wie Kunden Punkte sammeln, steht automatisch auf der Karte. Schreibe hier nur, was dazukommt. Ändern kannst du die Sammelregel hier nicht.";
/** The same field in setup and on a new location, where the earning rule is set in the fields above it (Marketing). */
export const SETUP_EXTRA_RULES_HINT = "Die Sammelregel legst du oben fest, sie steht automatisch auf der Karte. Schreibe hier nur, was dazukommt. Ändern kannst du sie nur oben.";
export const SHORT_RULE = "Die Regel braucht mindestens 10 Zeichen.";
/** Reward and name errors (Marketing F10): the imperative, one wording in every file. */
export const REWARD_NAME_MISSING = "Gib der Prämie einen Namen.";
export const SHORT_NAME = "Der Name braucht mindestens 2 Zeichen.";
export const WHOLE_NUMBER = "Gib eine ganze Zahl ab 1 ein.";

/** Smallest purchase (in minor units) that earns at least `cost` points, using the server's own rounding. */
export function minimumSpendMinor(cost: number, rate: number): number | null {
  if (!Number.isSafeInteger(cost) || cost < 1 || !Number.isSafeInteger(rate) || rate < 1) return null;
  let amount = Math.ceil((cost * 100) / rate);
  try {
    // Guard against off-by-one in either direction by asking the authoritative function.
    while (amount > 1 && purchasePoints(amount - 1, rate) >= cost) amount -= 1;
    while (purchasePoints(amount, rate) < cost) amount += 1;
    return amount;
  } catch { return null; }
}

/** Under a new points reward's number where points come from the purchase amount (Marketing B): the total spend that
 *  earns it, in whole cents rounded up, „500 €“ or „83,34 €“; MAD written as earningSentence writes it. */
export function minimumSpendText(cost: number, rate: number, currency: string) {
  const minor = minimumSpendMinor(cost, rate);
  if (minor === null) return null;
  const digits = minor % 100 === 0 ? 0 : 2;
  const amount = new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 100);
  return `Erreichbar ab insgesamt ${amount} ${currency === "EUR" ? "€" : currency} Einkaufswert.`;
}

export const MIN_SPEND_LABEL = "Nur reguläres Sammeln; zusätzliche Boni nicht berücksichtigt.";
export const NO_MIN_SPEND_LABEL = "Mindestumsatz offen: kein €-Wert pro Punkt";
/** The note exists for points only: a stamp card has no € value per point to leave open. */
export const noMinSpendNote = (type: ProgramKind) => type === "points" ? NO_MIN_SPEND_LABEL : null;

export type ExampleResult = { ok: true; amountMinor: number; points: number } | { ok: false; message: string };
/** Worked example through the same functions the server uses. German decimal input ("12,90") is accepted. */
export function purchaseExample(raw: string, rate: number): ExampleResult {
  if (!raw.trim()) return { ok: false, message: "" };
  try {
    const amountMinor = parsePurchaseAmountMinor(raw);
    return { ok: true, amountMinor, points: purchasePoints(amountMinor, rate) };
  } catch (cause) {
    if (cause instanceof PointsError && cause.code === "NO_POINTS") return { ok: false, message: "Für diesen Betrag gibt es noch keinen Punkt." };
    if (cause instanceof PointsError && cause.code === "INVALID_POINTS_RATE") return { ok: false, message: "Bitte einen Faktor zwischen 1 und 1000 wählen." };
    return { ok: false, message: "Bitte einen Betrag wie 12,90 eingeben." };
  }
}

/** W12, under a new reward's number: the other rewards' thresholds, lowest first and each once; null when there are none. */
export function otherRewardsHint(type: ProgramKind, costs: number[]) {
  if (costs.length === 0) return null;
  const numbers = [...new Set(costs)].sort((a, b) => a - b).map(cost => cost.toLocaleString("de-DE"));
  const list = numbers.length === 1 ? numbers[0] : `${numbers.slice(0, -1).join(", ")} und ${numbers[numbers.length - 1]}`;
  // The unit follows the last, highest number: „1 Punkt“, „1 und 5 Punkte“.
  return `${costs.length === 1 ? "Deine andere Prämie" : "Deine anderen Prämien"}: ${list} ${unitName(type, Math.max(...costs))}.`;
}

/** Whole numbers only. Returns null when the text is not a positive integer. */
export function parseWholeNumber(raw: string): number | null {
  const value = raw.trim();
  if (!/^[1-9]\d{0,5}$/.test(value)) return null;
  return Number(value);
}

/** German decimal like "1,80" or "2" to a number of euros; null when invalid. */
export function parseGermanMoney(raw: string): number | null {
  const value = raw.trim();
  if (!/^(?:0|[1-9]\d{0,5})(?:[,.]\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value.replace(",", "."));
  return parsed > 0 ? parsed : null;
}

/** Programm rows that open a page of their own, /merchant/program/<question> (ENG-099), with the row's title. */
export const QUESTIONS = {
  rule: "Regel auf der Karte", earning: "So entstehen Punkte", "points-expiry": "Punkte verfallen", nfc: "NFC-Tap",
  "welcome-bonus": "Startbonus", winback: "Willkommen zurück", birthday: "Geburtstags-Bonus", almost: "Erinnerung vor der Prämie", challenge: "Monats-Challenge", levels: "Kundenlevel", "happy-hour": "Happy Hour",
  news: "Neuigkeit", "review-link": "Google-Bewertung", "average-spend": "Durchschnittsbon",
} as const;
export type Question = keyof typeof QUESTIONS;
export const isQuestion = (value: string): value is Question => Object.hasOwn(QUESTIONS, value);

/** A calendar day (YYYY-MM-DD) as owner screens say it, „24. November“, with the year when it isn't this one (the shared
 *  date helper's long form; the card and the chips: cardDay, „24.11.“). */
export const longDay = (iso: string) => germanDate(iso, "long");
