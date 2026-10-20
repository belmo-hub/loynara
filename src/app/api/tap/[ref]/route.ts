import { cookieValue } from "@/lib/customer-session";
import { returningMemberSession } from "@/lib/returning-card";
import { customerSessionCookieHeaders } from "@/lib/customer-session-cookies";
import { after } from "next/server";
import { DomainError } from "@/lib/loyalty";
import { requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { previewSecureTap, processSecureTap, settleUnlinkedTap, tapCardToken, tapMemberSession, tapCookieName, tapProgramId } from "@/lib/secure-tap";
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
async function input(request: Request, ref: string) {
  await enforcePeerLimit(request, "tap_peer", 120, 15 * 60);
  await enforceRateLimit({ scope: "tap_ref", identity: ref, max: 600, windowSeconds: 15 * 60 });
  const dynamic = fields(request);
  const programId = await tapProgramId(ref).catch(async error => {
    if (await settleUnlinkedTap({ tagRef: ref, fields: dynamic })) throw new DomainError("PLATE_UNLINKED", "Dieses Schild ist gerade keinem Geschäft zugeordnet.");
    throw error;
  });
  return { tagRef: ref, fields: dynamic, cardToken: tapCardToken(request, programId) };
}
export async function GET(request: Request, context: { params: Promise<{ ref: string }> }) {
  try {
    const value = await input(request, (await context.params).ref);
    const info = await previewSecureTap(value);
    const programId = await tapProgramId(value.tagRef);
    const responseHeaders = new Headers(headers);
    const session = tapMemberSession(request, programId);
    const other = returningMemberSession(request, programId);
    const shared = session?.shared === true || (other?.token === session?.token && other?.shared === true);
    return Response.json({ ...info, requiresSelection: shared, recoveryRequired: !info.hasMembership && cookieValue(request, tapCookieName(programId)) !== undefined }, { headers: responseHeaders });
  }
  catch (error) { return respondError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ ref: string }> }) {
  try {
    requireSameOrigin(request);
    if (request.headers.get("content-length") && request.headers.get("content-length") !== "0") throw new DomainError("INVALID_TAP", "Tap request invalid");
    const value = await input(request, (await context.params).ref);
    const programId = await tapProgramId(value.tagRef);
    const session = tapMemberSession(request, programId);
    const other = returningMemberSession(request, programId);
    const shared = session?.shared === true || (other?.token === session?.token && other?.shared === true);
    if (shared && request.headers.get("x-loynara-card-selected") !== (await previewSecureTap(value)).cardLocator) throw new DomainError("ACCOUNT_SWITCH_REQUIRED", "Bitte die Karte für diesen Besuch bestätigen.");
    const { pushJobId, customerActivityAt, ...result } = await processSecureTap(value);
    const responseHeaders = new Headers(headers);
    if (customerActivityAt !== undefined && request.headers.get("x-loynara-customer-interaction") === "nfc_visit"
      && session && !session.legacy && (!other || other.token === session.token) && result.state === "pending_staff") {
      const matching = other?.token === session.token && !other.legacy ? [session, other] : [session];
      const renewed = { token: session.token, shared: matching.some(value => value.shared),
        issued: Math.min(...matching.map(value => value.issued!)), active: customerActivityAt };
      // Signing rechecks both boundaries after the transaction; a slow request cannot cross hard expiry.
      const now = Math.floor(Date.now()/1000);
      if (matching.every(value => now - value.active! < 90*86400 && now - value.issued! < 365*86400)) {
        for (const header of customerSessionCookieHeaders(programId, renewed, request.url)) responseHeaders.append("Set-Cookie", header);
      }
    }
    // Wake the cashier phones now rather than at the worker's next poll; the worker retries anything that fails here.
    if (pushJobId) after(() => dispatchTapPushNow(pushJobId));
    return Response.json(result, { headers: responseHeaders });
  } catch (error) { return respondError(error); }
}
