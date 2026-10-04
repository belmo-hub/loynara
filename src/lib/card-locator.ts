/**
 * Card locators let staff find a card when the QR code cannot be scanned ("K-7QX2MA"). A locator is six characters
 * from a 31-symbol alphabet without the look-alikes I, L, O, 0 and 1: random, unique per tenant, immutable, assigned
 * by the database (migration 0019). About 29.7 bits, so it cannot be guessed by counting upwards.
 *
 * It is a LOCATOR, not a credential: it only finds a card for an authenticated staff member of the same tenant and
 * location, who still has to open it deliberately and act with their own role. The scan code and card token remain
 * the customer's bearer credentials and are never derived from or interchangeable with it.
 */
export const LOCATOR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LOCATOR_LENGTH = 6;

const bare = new RegExp(`^[${LOCATOR_ALPHABET}]{${LOCATOR_LENGTH}}$`);
const prefixed = new RegExp(`^K\\s*-?\\s*([${LOCATOR_ALPHABET}]{${LOCATOR_LENGTH}})$`);

export function formatCardLocator(locator: string): string {
  return `K-${locator}`;
}

/**
 * Accepts what staff type, paste or read aloud: "K-7QX2MA", "k 7qx2ma", "7QX2MA", " K7QX2MA ". Case, spaces and the
 * hyphen are ignored. Returns the bare six-character locator, or null for anything that cannot be a locator
 * (including look-alike characters such as 0, O, 1, I and L, which no locator contains).
 */
export function parseCardLocator(raw: string): string | null {
  const text = raw.normalize("NFKC").trim().toUpperCase();
  if (bare.test(text)) return text;
  return prefixed.exec(text)?.[1] ?? null;
}

/** Scan codes ("sc_…") are credentials looked up directly; everything else is treated as a locator. */
export function isScanCodeInput(raw: string): boolean {
  return raw.trim().startsWith("sc_");
}
