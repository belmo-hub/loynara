import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, programs } from "@/db/schema";
import { formatCardLocator } from "./card-locator";

/**
 * Returning-customer recognition for the public join page.
 *
 * The counter QR always opens /join/<slug>. Without this, a guest who scans it again on a later visit creates a second,
 * empty card and believes the stamps are gone. When a browser enrols or opens a card, the server remembers that card
 * for its programme in an HttpOnly cookie. The join page then asks the server whether this browser already holds a
 * valid card for the programme and offers "Meine Karte öffnen" instead of silently creating another one.
 *
 * The cookie only REMEMBERS a credential the browser already had (the card link it just created or opened); it never
 * grants anything by itself. Every use re-validates it against the current card token of an open membership in the
 * same programme, so a closed card, a reissued (rotated) link, another programme's card or a corrupted value is
 * treated as "no card" and the cookie is cleared. Page scripts never receive the token: the existence check returns
 * only the card number, and opening the card is a server redirect. The cookie is scoped to /api/enroll, so it is not
 * sent with any other request.
 */
export const RETURNING_CARD_COOKIE_PATH = "/api/enroll";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const cardTokenPattern = /^card_[A-Za-z0-9_-]{32,80}$/;
const programIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function returningCardCookieName(programId: string) {
  if (!programIdPattern.test(programId)) throw new Error("Invalid programme id");
  return `loynara_card_${programId.replaceAll("-", "")}`;
}

function secureAttribute(requestUrl: string) {
  return new URL(process.env.PUBLIC_BASE_URL ?? requestUrl).protocol === "https:" ? "; Secure" : "";
}

/** Null for anything that is not a card token of a programme: remembering is best effort and never fails a request. */
export function returningCardCookieHeader(programId: string, cardToken: string, requestUrl: string): string | null {
  if (!cardTokenPattern.test(cardToken) || !programIdPattern.test(programId)) return null;
  return `${returningCardCookieName(programId)}=${cardToken}; Path=${RETURNING_CARD_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR_SECONDS}${secureAttribute(requestUrl)}`;
}

export function clearReturningCardCookieHeader(programId: string, requestUrl: string) {
  return `${returningCardCookieName(programId)}=; Path=${RETURNING_CARD_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute(requestUrl)}`;
}

/** The raw remembered value for this programme, or undefined when absent. Shape is NOT validated here. */
function rememberedValue(request: Request, programId: string): string | undefined {
  const name = `${returningCardCookieName(programId)}=`;
  const part = request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith(name));
  return part === undefined ? undefined : part.slice(name.length);
}

export type ReturningCard =
  | { state: "none"; programId: string | null }
  | { state: "stale"; programId: string }
  | { state: "existing"; programId: string; cardToken: string; cardLocator: string };

/**
 * What this browser holds for the active programme `slug`:
 * - none: no programme, or nothing remembered for it;
 * - stale: something was remembered but it is not a current, open card of this programme (closed, reissued,
 *   malformed, another programme's card). Callers clear the cookie;
 * - existing: a valid open card. The token is for server-side redirects only and must not be sent to page scripts.
 */
export async function findReturningCard(request: Request, slug: string): Promise<ReturningCard> {
  if (!slug || slug.length > 120) return { state: "none", programId: null };
  const [program] = await db.select({ id: programs.id }).from(programs).where(and(eq(programs.slug, slug), eq(programs.status, "active"))).limit(1);
  if (!program) return { state: "none", programId: null };
  const value = rememberedValue(request, program.id);
  if (value === undefined) return { state: "none", programId: program.id };
  if (!cardTokenPattern.test(value)) return { state: "stale", programId: program.id };
  const [member] = await db.select({ programId: memberships.programId, closedAt: memberships.closedAt, cardLocator: memberships.cardLocator })
    .from(memberships).where(eq(memberships.cardToken, value)).limit(1);
  if (!member || member.closedAt || member.programId !== program.id) return { state: "stale", programId: program.id };
  return { state: "existing", programId: program.id, cardToken: value, cardLocator: formatCardLocator(member.cardLocator) };
}
