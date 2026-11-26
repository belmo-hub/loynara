import { PLANS } from "./stripe-config";

/** The price a new shop stores before billing starts. Euro is always the list price (one price for every shop, 23 Nov 2026). */
export function draftPriceMinor(currency: "EUR" | "MAD"): number {
  if (currency === "EUR") return PLANS.list.priceMinor;
  const key = "DRAFT_MAD_PRICE_MINOR";
  const configured = process.env[key];
  if (configured === undefined || configured === "") return 39700;
  const amount = Number(configured);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`${key} must be a positive integer in minor currency units`);
  return amount;
}
