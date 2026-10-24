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

/**
 * „Komm 3-mal im Oktober, dann gibt's 50 Punkte extra.“ and its conditions with the end date (Legal: each challenge shows
 * both), in the card's language: `month` and `endsOn` come formatted for that locale.
 */
export function challengeSentence(target: number, bonus: number, type: string, month: string, endsOn: string, locale = "de") {
  if (locale === "fr") return {
    text: `Venez ${target} fois en ${month} et recevez ${bonus} ${type === "stamp" ? bonus === 1 ? "tampon supplémentaire" : "tampons supplémentaires" : "points supplémentaires"}.`,
    conditions: `Seules les visites confirmées en caisse comptent, une par jour au maximum. Valable jusqu’au ${endsOn}. Hors tabac, presse, livres, loterie et recharges téléphoniques.`,
  };
  return {
    text: `Komm ${target}-mal im ${month}, dann gibt's ${bonus} ${type === "stamp" ? "Stempel" : "Punkte"} extra.`,
    conditions: `Es zählen Besuche, die an der Kasse bestätigt werden, höchstens einer pro Tag. Gilt bis ${endsOn}. ${EXCLUDED_GOODS}`,
  };
}

/** Customer levels (ENG-053): visit days in the last LEVEL_WINDOW_DAYS days decide Bronze, Silber or Gold. */
export const LEVEL_WINDOW_DAYS = 90;
export const LEVEL_PERK_MAX = 60;
export type LevelName = "Bronze" | "Silber" | "Gold";

/** Bronze from the first visit day in the window; none without one. */
export function levelFor(visits: number, silver: number, gold: number): LevelName | null {
  return visits >= gold ? "Gold" : visits >= silver ? "Silber" : visits >= 1 ? "Bronze" : null;
}

/** A perk is a short plain line the cashier honours (never a booking); the same rules as card news, at most 60 characters. */
export function levelPerkProblem(text: string) {
  return Array.from(text).length > LEVEL_PERK_MAX ? "TOO_LONG" : cardNewsProblem(text);
}

/** The calendar month („2026-10“) an instant falls in, in the shop's timezone. */
export const monthOf = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone }).format(at).slice(0, 7);
/** The 1st („2026-11-01“) of the month after `month`. */
export function nextMonthStart(month: string) {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, "0")}-01`;
}

type ChallengeColumns = { challengeVisits: number | null; challengeBonus: number; challengeNextFrom: string | null; challengeNextVisits: number | null; challengeNextBonus: number | null };
/** The challenge in force in `month` (ENG-065): a pending change counts from the month it names, so no job has to switch it. */
export function challengeFor(p: ChallengeColumns, month: string) {
  return p.challengeNextFrom && `${month}-01` >= p.challengeNextFrom
    ? { visits: p.challengeNextVisits, bonus: p.challengeNextBonus ?? p.challengeBonus }
    : { visits: p.challengeVisits, bonus: p.challengeBonus };
}
/** The pending change that has not started by `month`, if any (what the owner screen shows as „Gilt ab 1.11.“). */
export const pendingChallenge = (p: ChallengeColumns, month: string) =>
  p.challengeNextFrom && `${month}-01` < p.challengeNextFrom ? { from: p.challengeNextFrom, visits: p.challengeNextVisits, bonus: p.challengeNextBonus } : null;
