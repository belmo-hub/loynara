import { createHmac, timingSafeEqual } from "node:crypto";

/** Fixed 90 days, no sliding renewal on taps or reads. Binding an already-valid session preserves expiry; a saved link can restore expired access.
 * Membership closure/card-token rotation revokes every device at the existing database validation.
 * No new identity store: the existing unpredictable card credential remains the identity proof.
 */
export const CUSTOMER_SESSION_SECONDS = 90 * 24 * 60 * 60;
// Candidate cookies had no issuance timestamp. Keep current raw bearer credentials compatible only
// until this fixed migration deadline, then require a saved card link/recovery. Normal validations still apply.
export const LEGACY_CUSTOMER_SESSION_DEADLINE = Date.parse("2027-01-07T00:00:00Z") / 1000;
const tokenPattern = /^card_[A-Za-z0-9_-]{32,80}$/;
function signature(programId: string, payload: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Customer session signing unavailable");
  return createHmac("sha256", secret).update("loynara-customer-session-v1\0").update(programId).update("\0").update(payload).digest();
}
export function issueCustomerSession(programId: string, cardToken: string, shared = false, issued = Math.floor(Date.now()/1000)) {
  if (!tokenPattern.test(cardToken)) throw new Error("Invalid card credential");
  const now = Math.floor(Date.now()/1000);
  if (!Number.isSafeInteger(issued) || issued > now || now - issued >= CUSTOMER_SESSION_SECONDS) throw new Error("Invalid session issuance time");
  const payload = Buffer.from(JSON.stringify({ token: cardToken, issued, shared })).toString("base64url");
  return `v1.${payload}.${signature(programId, payload).toString("base64url")}`;
}
export function readCustomerSession(value: string | undefined, programId: string): { token: string; shared: boolean; issued?: number; legacy?: boolean } | undefined {
  if (!value || value.length > 400) return;
  if (tokenPattern.test(value) && Date.now()/1000 < LEGACY_CUSTOMER_SESSION_DEADLINE) return { token: value, shared: false, legacy: true };
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return;
  const expected = signature(programId, parts[1]), actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return;
  try {
    const data = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const now = Math.floor(Date.now()/1000);
    if (!tokenPattern.test(data.token) || !Number.isSafeInteger(data.issued) || data.issued > now || now - data.issued >= CUSTOMER_SESSION_SECONDS || typeof data.shared !== "boolean") return;
    return { token: data.token, shared: data.shared, issued: data.issued };
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
