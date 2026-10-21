// Shared by the owner form and the server, which checks again. Pure functions only (imported by client code).

export const CARD_NEWS_MAX = 140;

// Anything that reads as a link or web address: scheme, "www.", or a word followed by a common top-level domain.
const LINK_PATTERN = /[a-z][a-z0-9+.-]*:\/\/|www\.|[a-z0-9-]+\.(?:de|com|net|org|eu|io|app|info|me|ly|shop|link|co)\b/i;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

/** Why a card news line cannot be saved, or null when it is fine. Empty means "no news" and is fine. */
export function cardNewsProblem(text: string): "TOO_LONG" | "LINK" | "CONTROL" | null {
  if (Array.from(text).length > CARD_NEWS_MAX) return "TOO_LONG";
  if (CONTROL_PATTERN.test(text)) return "CONTROL";
  if (LINK_PATTERN.test(text)) return "LINK";
  return null;
}

export const REVIEW_URL_MAX = 500;
/** Staff-confirmed visits after which the card shows the review link. */
export const REVIEW_AFTER_VISITS = 3;

/** A Google review link: https on g.page, google.com/maps or search.google.com/local/writereview, nothing else. */
export function reviewUrlValid(value: string): boolean {
  if (value.length > REVIEW_URL_MAX) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname;
  return host === "g.page"
    || ((host === "google.com" || host === "www.google.com") && (url.pathname === "/maps" || url.pathname.startsWith("/maps/")))
    || (host === "search.google.com" && url.pathname === "/local/writereview");
}

/** Monthly challenge (ENG-052): visit days in a calendar month, and the bonus range per programme type. */
export const CHALLENGE_VISITS = { min: 2, max: 10 } as const;
/** Stamps +1 to +3; points from 1 up to a quarter of the cheapest active reward (Product 22 Oct, as win-back). */
export const challengeBonusRange = (type: string, cheapestRewardCost: number) => type === "stamp" ? { min: 1, max: 3 } : { min: 1, max: Math.floor(cheapestRewardCost / 4) };
/** Price-bound goods that never earn a bonus or perk (Legal 22 Oct). Shown with the challenge, at the counter and to the owner. */
export const EXCLUDED_GOODS = "Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.";

/** „Komm 3-mal im Oktober, dann gibt's 50 Punkte extra.“ and its conditions with the end date (Legal: each challenge shows both). */
export function challengeSentence(target: number, bonus: number, type: string, month: string, endsOn: string) {
  return {
    text: `Komm ${target}-mal im ${month}, dann gibt's ${bonus} ${type === "stamp" ? "Stempel" : "Punkte"} extra.`,
    conditions: `Es zählen Besuche, die an der Kasse bestätigt werden, höchstens einer pro Tag. Gilt bis ${endsOn}. ${EXCLUDED_GOODS}`,
  };
}
