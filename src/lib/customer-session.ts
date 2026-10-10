import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Signed customer credentials: 90-day inactivity, 365-day absolute lifetime.
 * Only explicit customer Done after a committed cashier award may advance activity.
 * Reads/binding preserve deadlines; closure/card rotation revoke through membership validation.
 */
export const CUSTOMER_SESSION_SECONDS = 90 * 24 * 60 * 60;
export const CUSTOMER_SESSION_ABSOLUTE_SECONDS = 365 * 24 * 60 * 60;
export type CustomerSession = { token: string; shared: boolean; issued?: number; lastActivity?: number; legacy?: boolean };
// Candidate cookies had no issuance timestamp. Keep current raw bearer credentials compatible only
// until this fixed migration deadline, then require a saved card link/recovery. Normal validations still apply.
export const LEGACY_CUSTOMER_SESSION_DEADLINE = Date.parse("2027-01-07T00:00:00Z") / 1000;
const tokenPattern = /^card_[A-Za-z0-9_-]{32,80}$/;
function signature(programId: string, payload: string, version: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Customer session signing unavailable");
  return createHmac("sha256", secret).update(`loynara-customer-session-${version}\0`).update(programId).update("\0").update(payload).digest();
}
export function customerSessionRemainingSeconds(session: Pick<CustomerSession, "issued" | "lastActivity">) {
  if (session.issued === undefined || session.lastActivity === undefined) throw new Error("Missing session timestamps");
  return Math.max(0, Math.min(session.issued + CUSTOMER_SESSION_ABSOLUTE_SECONDS, session.lastActivity + CUSTOMER_SESSION_SECONDS) - Math.floor(Date.now()/1000));
}
/** The fixed raw-cookie cutoff remains unchanged even when a GET upgrades its format. */
export function legacyCustomerSessionTiming() {
  const issued = LEGACY_CUSTOMER_SESSION_DEADLINE - CUSTOMER_SESSION_SECONDS;
  return { issued, lastActivity: issued };
}
export function issueCustomerSession(programId: string, cardToken: string, shared = false, issued = Math.floor(Date.now()/1000), lastActivity = issued) {
  if (!tokenPattern.test(cardToken)) throw new Error("Invalid card credential");
  const now = Math.floor(Date.now()/1000);
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(lastActivity) || issued > lastActivity || lastActivity > now
    || now - issued >= CUSTOMER_SESSION_ABSOLUTE_SECONDS || now - lastActivity >= CUSTOMER_SESSION_SECONDS) throw new Error("Invalid session timestamps");
  const payload = Buffer.from(JSON.stringify({ token: cardToken, issued, lastActivity, shared, nonce: randomBytes(16).toString("base64url") })).toString("base64url");
  return `v2.${payload}.${signature(programId, payload, "v2").toString("base64url")}`;
}
export function readCustomerSession(value: string | undefined, programId: string): CustomerSession | undefined {
  if (!value || value.length > 512) return;
  if (tokenPattern.test(value) && Date.now()/1000 < LEGACY_CUSTOMER_SESSION_DEADLINE) return { token: value, shared: false, legacy: true, ...legacyCustomerSessionTiming() };
  const parts = value.split(".");
  if (parts.length !== 3 || !["v1", "v2"].includes(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return;
  const expected = signature(programId, parts[1], parts[0]), actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return;
  try {
    const data = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const now = Math.floor(Date.now()/1000), lastActivity = parts[0] === "v1" ? data.issued : data.lastActivity;
    if (!tokenPattern.test(data.token) || !Number.isSafeInteger(data.issued) || !Number.isSafeInteger(lastActivity)
      || data.issued > lastActivity || lastActivity > now || now - data.issued >= CUSTOMER_SESSION_ABSOLUTE_SECONDS
      || now - lastActivity >= CUSTOMER_SESSION_SECONDS || typeof data.shared !== "boolean"
      || (parts[0] === "v2" && (typeof data.nonce !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(data.nonce)))) return;
    return { token: data.token, shared: data.shared, issued: data.issued, lastActivity };
  } catch { return; }
}
export function cookieValue(request: Request, name: string) {
  const values = request.headers.get("cookie")?.split(";").map(x=>x.trim()).filter(x=>x.startsWith(`${name}=`));
  // Ambiguous duplicate cookies never select an account.
  return values?.length === 1 ? values[0].slice(name.length + 1) : values?.length ? "" : undefined;
}
export function customerCookieAttributes(requestUrl: string, path: string, seconds = CUSTOMER_SESSION_SECONDS) {
  const url = new URL(process.env.PUBLIC_BASE_URL ?? requestUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Customer sessions require HTTPS");
  return `Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${seconds}${url.protocol === "https:" ? "; Secure" : ""}`;
}
