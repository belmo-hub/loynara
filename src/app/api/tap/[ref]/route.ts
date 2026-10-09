import { cookieValue, legacyCustomerSessionTiming } from "@/lib/customer-session";
import { clearLegacyReturningCardCookieHeader, returningCardCookieHeader, returningMemberSession } from "@/lib/returning-card";
import { after } from "next/server";
import { DomainError } from "@/lib/loyalty";
import { requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { previewSecureTap, processSecureTap, tapCardToken, tapMemberSession, tapCookieName, tapCookieHeader, tapProgramId } from "@/lib/secure-tap";
import { dispatchTapPushNow } from "@/lib/staff-push";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
function fields(request: Request) {
  const url = new URL(request.url);
  if (url.search.length > 55 || [...url.searchParams.keys()].sort().join(",") !== "c,e") throw new DomainError("INVALID_TAP", "Tap link invalid");
  const encrypted = url.searchParams.get("e") ?? "";
  const mac = url.searchParams.get("c") ?? "";
  if (!/^[a-fA-F0-9]{32}$/.test(encrypted) || !/^[a-fA-F0-9]{16}$/.test(mac)) throw new DomainError("INVALID_TAP", "Tap link invalid");
  return { encrypted, mac };
}
function effectiveSession(request: Request, programId: string) {
  const tap = tapMemberSession(request, programId), broad = returningMemberSession(request, programId);
  if (!tap) return;
  const matching = [tap, broad].filter(s => s?.token === tap.token);
  return { ...tap, issued: Math.min(...matching.map(s => s!.issued!)), lastActivity: Math.max(...matching.map(s => s!.lastActivity!)),
    shared: tap.shared || broad?.shared === true || (!!broad && broad.token !== tap.token) };
}
async function input(request: Request, ref: string) {
  await enforcePeerLimit(request, "tap_peer", 120, 15 * 60);
  await enforceRateLimit({ scope: "tap_ref", identity: ref, max: 600, windowSeconds: 15 * 60 });
  const dynamic = fields(request);
  const programId = await tapProgramId(ref);
  return { tagRef: ref, fields: dynamic, cardToken: tapCardToken(request, programId) };
}
export async function GET(request: Request, context: { params: Promise<{ ref: string }> }) {
  try {
    const value = await input(request, (await context.params).ref);
    const info = await previewSecureTap(value);
    const programId = await tapProgramId(value.tagRef);
    const session = effectiveSession(request, programId);
    const responseHeaders = new Headers(headers);
    // Upgrade legacy credentials only after cryptographic tag and active membership validation.
    if (session?.legacy && info.hasMembership) {
      responseHeaders.append("Set-Cookie", tapCookieHeader(programId, session.token, request.url, session.shared, {issued:session.issued!,lastActivity:session.lastActivity!}));
      responseHeaders.append("Set-Cookie", clearLegacyReturningCardCookieHeader(programId, request.url));
      responseHeaders.append("Set-Cookie", returningCardCookieHeader(programId, session.token, request.url, session.shared, {issued:session.issued!,lastActivity:session.lastActivity!})!);
    }
    return Response.json({ ...info, requiresSelection: session?.shared === true, recoveryRequired: !info.hasMembership && cookieValue(request, tapCookieName(programId)) !== undefined }, { headers: responseHeaders });
  }
  catch (error) { return respondError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ ref: string }> }) {
  try {
    requireSameOrigin(request);
    if (request.headers.get("content-length") && request.headers.get("content-length") !== "0") throw new DomainError("INVALID_TAP", "Tap request invalid");
    const value = await input(request, (await context.params).ref);
    const programId = await tapProgramId(value.tagRef);
    if (effectiveSession(request, programId)?.shared && request.headers.get("x-loynara-card-selected") !== (await previewSecureTap(value)).cardLocator) throw new DomainError("ACCOUNT_SWITCH_REQUIRED", "Bitte die Karte für diesen Besuch bestätigen.");
    const { pushJobId, sessionActivity, ...result } = await processSecureTap(value);
    const responseHeaders = new Headers(headers);
    // The response belongs to the authenticated customer browser, not the cashier device.
    // Only a fresh counter that creates a new request qualifies. Polling/resume/replay cannot enter this branch.
    const session = effectiveSession(request, programId);
    if (sessionActivity && session && session.token === value.cardToken) {
      const issued = session.issued ?? legacyCustomerSessionTiming().issued;
      const timing = { issued, lastActivity: Math.floor(Date.now() / 1000) };
      responseHeaders.append("Set-Cookie", tapCookieHeader(programId, session.token, request.url, session.shared, timing));
      responseHeaders.append("Set-Cookie", clearLegacyReturningCardCookieHeader(programId, request.url));
      responseHeaders.append("Set-Cookie", returningCardCookieHeader(programId, session.token, request.url, session.shared, timing)!);
    }
    // Wake the cashier phones now rather than at the worker's next poll; the worker retries anything that fails here.
    if (pushJobId) after(() => dispatchTapPushNow(pushJobId));
    return Response.json(result, { headers: responseHeaders });
  } catch (error) { return respondError(error); }
}
