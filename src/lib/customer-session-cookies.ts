import { type CustomerSession, customerCookieAttributes, issueCustomerSession, CUSTOMER_SESSION_SECONDS, CUSTOMER_SESSION_ABSOLUTE_SECONDS, LEGACY_CUSTOMER_SESSION_DEADLINE } from "./customer-session";
import { tapCookieName } from "./secure-tap";
import { clearLegacyReturningCardCookieHeader, returningCardCookieName } from "./returning-card";

/** Repair both scopes without extending activity or the original authentication lifetime. */
export function customerSessionCookieHeaders(programId: string, session: CustomerSession, url: string) {
  const now = Math.floor(Date.now()/1000);
  const deadline = session.legacy ? LEGACY_CUSTOMER_SESSION_DEADLINE
    : Math.min(session.issued! + CUSTOMER_SESSION_ABSOLUTE_SECONDS, session.active! + CUSTOMER_SESSION_SECONDS);
  const value = session.legacy ? session.token : issueCustomerSession(programId, session.token, session.shared, session.issued, session.active);
  const remaining = Math.max(0, deadline - now);
  return [
    `${tapCookieName(programId)}=${value}; ${customerCookieAttributes(url, "/api/tap", remaining)}`,
    clearLegacyReturningCardCookieHeader(programId, url),
    `${returningCardCookieName(programId)}=${value}; ${customerCookieAttributes(url, "/api", remaining)}`,
  ];
}
