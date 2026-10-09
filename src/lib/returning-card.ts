import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, programs } from "@/db/schema";
import { formatCardLocator } from "./card-locator";

import { cookieValue, customerCookieAttributes, issueCustomerSession, readCustomerSession } from "./customer-session";

/** Program-scoped, server-expiring remembered credentials; current membership is always revalidated. */
export const RETURNING_CARD_COOKIE_PATH = "/api";
const cardTokenPattern = /^card_[A-Za-z0-9_-]{32,80}$/;
const programIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function returningCardCookieName(programId: string) {
  if (!programIdPattern.test(programId)) throw new Error("Invalid programme id");
  return `loynara_card_${programId.replaceAll("-", "")}`;
}

export function returningCardCookieHeader(programId: string, cardToken: string, requestUrl: string, shared = false): string | null {
  if (!cardTokenPattern.test(cardToken) || !programIdPattern.test(programId)) return null;
  return `${returningCardCookieName(programId)}=${issueCustomerSession(programId, cardToken, shared)}; ${customerCookieAttributes(requestUrl, RETURNING_CARD_COOKIE_PATH)}`;
}
export function clearReturningCardCookieHeader(programId: string, requestUrl: string) {
  return `${returningCardCookieName(programId)}=; ${customerCookieAttributes(requestUrl, RETURNING_CARD_COOKIE_PATH, 0)}`;
}
/** Retire the candidate's narrower same-name cookie so both paths cannot shadow each other. */
export function clearLegacyReturningCardCookieHeader(programId: string, requestUrl: string) {
  return `${returningCardCookieName(programId)}=; ${customerCookieAttributes(requestUrl, "/api/enroll", 0)}`;
}
export function returningMemberSession(request: Request, programId: string) {
  return readCustomerSession(cookieValue(request, returningCardCookieName(programId)), programId);
}
export type ReturningCard =
  | { state: "none"; programId: string | null }
  | { state: "stale"; programId: string }
  | { state: "existing"; programId: string; cardToken: string; cardLocator: string };

/**
 * What this browser holds for the active programme `slug`:
 * - none: no programme, or nothing remembered for it;
 * - stale: something was remembered but it is not a current, open card of this programme (closed, reissued,
 *   malformed, another programme's card). Retain it as a recovery marker;
 * - existing: a valid open card. The token is for server-side redirects only and must not be sent to page scripts.
 */
export async function findReturningCard(request: Request, slug: string): Promise<ReturningCard> {
  if (!slug || slug.length > 120) return { state: "none", programId: null };
  const [program] = await db.select({ id: programs.id }).from(programs).where(and(eq(programs.slug, slug), eq(programs.status, "active"))).limit(1);
  if (!program) return { state: "none", programId: null };
  const remembered = cookieValue(request, returningCardCookieName(program.id));
  const value = readCustomerSession(remembered, program.id)?.token;
  if (remembered === undefined) return { state: "none", programId: program.id };
  if (!value) return { state: "stale", programId: program.id };
  if (!cardTokenPattern.test(value)) return { state: "stale", programId: program.id };
  const [member] = await db.select({ programId: memberships.programId, closedAt: memberships.closedAt, cardLocator: memberships.cardLocator })
    .from(memberships).where(eq(memberships.cardToken, value)).limit(1);
  if (!member || member.closedAt || member.programId !== program.id) return { state: "stale", programId: program.id };
  return { state: "existing", programId: program.id, cardToken: value, cardLocator: formatCardLocator(member.cardLocator) };
}
