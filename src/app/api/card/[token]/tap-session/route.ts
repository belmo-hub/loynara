import { cookieValue, issueCustomerSession, customerCookieAttributes, customerSessionRemainingSeconds } from "@/lib/customer-session";
import { DomainError } from "@/lib/loyalty";
import { bindTapCard, tapCookieHeader, tapCookieName, tapMemberSession } from "@/lib/secure-tap";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { clearLegacyReturningCardCookieHeader, returningCardCookieHeader, returningCardCookieName, returningMemberSession } from "@/lib/returning-card";

// Binds the open card to this browser: for NFC taps (Path=/api/tap) and for the join page, which offers this card
// again instead of creating a second one when the counter QR is scanned on a later visit (Path=/api).
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "tap_bind_peer", 60, 15 * 60);
    const { token } = await context.params;
    const programId = await bindTapCard(token);
    const tapSession = tapMemberSession(request, programId);
    const cardSession = returningMemberSession(request, programId);
    const current = tapSession ?? cardSession;
    let currentActive = false;
    if (current) {
      try { currentActive = await bindTapCard(current.token) === programId; }
      catch (error) { if (!(error instanceof DomainError && error.code === "NOT_FOUND")) throw error; }
    }
    const switching = currentActive && current?.token !== token;
    const explicit = request.headers.get("content-type")?.startsWith("application/json") ? await jsonBody(request, 500) : undefined;
    if (explicit !== undefined && (typeof explicit !== "object" || explicit === null || Object.keys(explicit).join(",") !== "switchAccount" || (explicit as { switchAccount?: unknown }).switchAccount !== true)) throw new DomainError("INVALID_INPUT", "Explicit account switch required");
    // Older card clients do not send the path-scoped NFC cookie here. They must confirm before replacing an unknown identity.
    const uninspectedLegacyIdentity = new URL(request.url).pathname.startsWith("/api/card/") && !current;
    if ((switching || uninspectedLegacyIdentity) && !explicit) throw new DomainError("ACCOUNT_SWITCH_REQUIRED", "Andere Karte auf diesem Gerät: Wechsel bitte ausdrücklich bestätigen.");
    if (!currentActive && !explicit) throw new DomainError("DEVICE_CONFIRMATION_REQUIRED", "Bitte diese private Karte ausdrücklich für dieses Gerät bestätigen.");
    const identityMarker = cookieValue(request, tapCookieName(programId)) !== undefined || cookieValue(request, returningCardCookieName(programId)) !== undefined;
    const shared = tapSession?.shared === true || cardSession?.shared === true || [tapSession, cardSession].some(session => session && session.token !== token) || switching || uninspectedLegacyIdentity || (!currentActive && identityMarker);
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    // CardClient binds automatically on refresh. Never turn that background work into renewal.
    // Repair a missing cookie with the validated envelope and its remaining original lifetime.
    if (currentActive && current?.token === token && current.issued !== undefined) {
      const matching = [tapSession, cardSession].filter(session => session?.token === token && session.issued !== undefined);
      const issued = Math.min(...matching.map(session => session!.issued!));
      const lastActivity = Math.max(...matching.map(session => session!.lastActivity!));
      const sharedDevice = shared;
      const bothMatch = !tapSession?.legacy && !cardSession?.legacy && tapSession?.token === token && cardSession?.token === token
        && tapSession.issued === issued && cardSession.issued === issued
        && tapSession.lastActivity === lastActivity && cardSession.lastActivity === lastActivity
        && tapSession.shared === sharedDevice && cardSession.shared === sharedDevice;
      if (!bothMatch) {
        const value = issueCustomerSession(programId, token, sharedDevice, issued, lastActivity);
        const remaining = customerSessionRemainingSeconds({ issued, lastActivity });
        headers.append("Set-Cookie", `${tapCookieName(programId)}=${value}; ${customerCookieAttributes(request.url, "/api/tap", remaining)}`);
        headers.append("Set-Cookie", clearLegacyReturningCardCookieHeader(programId, request.url));
        headers.append("Set-Cookie", `${returningCardCookieName(programId)}=${value}; ${customerCookieAttributes(request.url, "/api", remaining)}`);
      }
      return Response.json({ bound: true }, { headers });
    }
    headers.append("Set-Cookie", tapCookieHeader(programId, token, request.url, shared));
    const remember = returningCardCookieHeader(programId, token, request.url, shared);
    if (remember) {
      headers.append("Set-Cookie", clearLegacyReturningCardCookieHeader(programId, request.url));
      headers.append("Set-Cookie", remember);
    }
    return Response.json({ bound: true }, { headers });
  } catch (error) { return respondError(error); }
}
