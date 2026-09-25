export function draftPriceMinor(currency: "EUR" | "MAD"): number {
  const key = currency === "EUR" ? "NEXT_PUBLIC_DRAFT_EUR_PRICE_MINOR" : "DRAFT_MAD_PRICE_MINOR";
  const configured = process.env[key];
  if (configured === undefined || configured === "") return currency === "EUR" ? 4900 : 39700;
  const amount = Number(configured);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`${key} must be a positive integer in minor currency units`);
  return amount;
}
