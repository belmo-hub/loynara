import { MAX_POINTS_PER_CURRENCY_UNIT, parsePurchaseAmountMinor, PointsError, purchasePoints } from "@/lib/points";

export type ProgramKind = "stamp" | "points";
export type EarningMode = "manual" | "purchase";
export const unitName = (type: ProgramKind, count = 2) => type === "points" ? (count === 1 ? "Punkt" : "Punkte") : (count === 1 ? "Stempel" : "Stempel");
/** Dative plural for "in …" / "mit …" sentences. */
export const unitDative = (type: ProgramKind) => type === "points" ? "Punkten" : "Stempeln";
export { MAX_POINTS_PER_CURRENCY_UNIT };

export function euro(minor: number, currency: string) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(minor / 100);
}

/** Readable one-sentence rule, derived only from the modes the backend supports. */
export function earningSentence(type: ProgramKind, mode: EarningMode, rate: number, currency: string) {
  if (type === "stamp") return "Dein Team vergibt Stempel an der Kasse. Die Menge wird dort bei jeder Vergabe bestätigt.";
  if (mode === "purchase") return `${rate} ${unitName("points", rate)} pro 1 ${currency === "EUR" ? "€" : currency} Einkaufswert, abgerundet auf ganze Punkte.`;
  return "Dein Team vergibt Punkte manuell an der Kasse. Die Menge wird dort bei jeder Vergabe eingegeben.";
}

/** Who confirms is a separate question from how points are earned. */
export function confirmSentence(type: ProgramKind, mode: EarningMode) {
  const base = "Kunden können sich nichts selbst gutschreiben: Jede Vergabe bestätigt dein Team an der Kasse per QR-Scan oder Kartencode.";
  if (type === "points" && mode === "purchase") return `${base} Den Einkaufswert gibt das Team dort ein. Ein NFC-Tag kennt keinen Betrag.`;
  return base;
}

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

export const MIN_SPEND_LABEL = "Nur reguläres Sammeln; zusätzliche Boni nicht berücksichtigt.";
export const NO_MIN_SPEND_LABEL = "Kein Mindestumsatz ableitbar";

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
