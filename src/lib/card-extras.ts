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
