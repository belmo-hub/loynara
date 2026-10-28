import { z } from "zod";
import { unitWord } from "./units";

/** EUR and MAD both have 100 minor units in this application's currency set. */
const MINOR_UNITS_PER_MAJOR = BigInt(100);

/** Points by purchase amount (ENG-099 3c): the system states how points come about, so the owner's rules text holds extra
 *  rules only and may stay empty. Stamps and manual points keep the owner's own rule. */
export const byPurchase = (type: string, mode: string) => type === "points" && mode === "purchase";

/** That earning rule as customers read it on the card and the sign-up page, and the owner in the previews: exactly what
 *  purchasePoints books, whole points per purchase rounded down. French keeps the sign-up page's existing wording. */
export function purchaseRuleSentence(perUnit: number, currency: string, locale: "de" | "fr" = "de") {
  if (locale === "fr") return `${perUnit} point${perUnit === 1 ? "" : "s"} par ${currency === "EUR" ? "euro" : currency} dépensé. Les fractions de point sont arrondies à l’entier inférieur.`;
  return `${perUnit} ${unitWord(perUnit, "points")} pro 1 ${currency === "EUR" ? "€" : currency} Einkaufswert, abgerundet auf ganze Punkte.`;
}

// Where the owner's text is the rule itself it needs 10 characters, refused as the request schemas did before.
const OWN_RULE = z.object({ rulesText: z.string().min(10) });
/** The trimmed rules text checked against the programme it is saved for (its resulting type and earning mode). */
export function checkRulesText(type: string, mode: string, rulesText: string) {
  if (!byPurchase(type, mode)) OWN_RULE.parse({ rulesText });
}
export const MAX_PURCHASE_AMOUNT_MINOR = 10_000_000;
export const MAX_POINTS_PER_CURRENCY_UNIT = 1_000;

export class PointsError extends Error {
  constructor(public code: "INVALID_PURCHASE_AMOUNT" | "INVALID_POINTS_RATE" | "NO_POINTS") {
    super(code);
  }
}

/** Parse a cashier-entered major-unit amount without decimal floating point. */
export function parsePurchaseAmountMinor(raw: string): number {
  const value = raw.trim();
  if (!/^(?:0|[1-9]\d{0,5})(?:[,.]\d{1,2})?$/.test(value)) throw new PointsError("INVALID_PURCHASE_AMOUNT");
  const [major, minor = ""] = value.replace(",", ".").split(".");
  const amountMinor = Number(major) * 100 + Number(minor.padEnd(2, "0"));
  if (amountMinor < 1 || amountMinor > MAX_PURCHASE_AMOUNT_MINOR) throw new PointsError("INVALID_PURCHASE_AMOUNT");
  return amountMinor;
}

export function purchasePoints(amountMinor: number, pointsPerCurrencyUnit: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > MAX_PURCHASE_AMOUNT_MINOR) {
    throw new PointsError("INVALID_PURCHASE_AMOUNT");
  }
  if (!Number.isSafeInteger(pointsPerCurrencyUnit) || pointsPerCurrencyUnit < 1 || pointsPerCurrencyUnit > MAX_POINTS_PER_CURRENCY_UNIT) {
    throw new PointsError("INVALID_POINTS_RATE");
  }
  const points = (BigInt(amountMinor) * BigInt(pointsPerCurrencyUnit)) / MINOR_UNITS_PER_MAJOR;
  if (points === BigInt(0)) throw new PointsError("NO_POINTS");
  return Number(points);
}
