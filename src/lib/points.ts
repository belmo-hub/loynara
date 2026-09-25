/** EUR and MAD both have 100 minor units in this application's currency set. */
const MINOR_UNITS_PER_MAJOR = BigInt(100);
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
