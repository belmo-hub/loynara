/**
 * Short card numbers ("K-0007") let staff find a card when the QR code cannot be scanned. They are tenant-scoped,
 * assigned by the database (migration 0019) and only usable by authenticated staff of that tenant and location;
 * the scan code and card token stay the credentials.
 */
const MAX_CARD_NUMBER = 9_999_999;

export function formatCardNumber(value: number): string {
  return `K-${String(value).padStart(4, "0")}`;
}

/** Accepts what staff type or read aloud: "7", "#7", "K7", "K-0007", "k 7", "Nr. 7". Returns null for anything else. */
export function parseCardNumber(raw: string): number | null {
  const match = /^(?:k\s*-?\s*|#\s*|nr\.?\s*)?(\d{1,7})$/i.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 && value <= MAX_CARD_NUMBER ? value : null;
}
