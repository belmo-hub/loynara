import type { CustomerSession } from "@/lib/customer-session";
import { customerSessionCookieHeaders } from "@/lib/customer-session-cookies";
import { DomainError } from "@/lib/loyalty";
import { bindTapCard, tapCookieHeader, tapMemberSession } from "@/lib/secure-tap";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { clearLegacyReturningCardCookieHeader, returningCardCookieHeader, returningMemberSession } from "@/lib/returning-card";

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
    if (explicit !== undefined && (typeof explicit !== "object" || explicit === null
      || !["switchAccount", "authenticate"].includes(Object.keys(explicit).join(","))
      || Object.values(explicit).some(value => value !== true))) throw new DomainError("INVALID_INPUT", "Explicit authentication or account switch required");
    const switchApproved = !!explicit && (explicit as { switchAccount?: boolean }).switchAccount === true;
    const uninspectedLegacyIdentity = new URL(request.url).pathname.startsWith("/api/card/") && !current;
    if ((switching || uninspectedLegacyIdentity) && !switchApproved) throw new DomainError("ACCOUNT_SWITCH_REQUIRED", "Andere Karte auf diesem Gerät: Wechsel bitte ausdrücklich bestätigen.");
    if (!currentActive && !explicit) throw new DomainError("AUTHENTICATION_REQUIRED", "Bestätige den Zugang mit deinem privaten Kartenlink oder nutze die sichere Wiederherstellung.");
    const shared = current?.shared === true || switching || uninspectedLegacyIdentity;
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    // Automatic CardClient refresh must neither reset inactivity nor start another absolute lifetime.
    if (currentActive && current?.token === token) {
      const matching = [tapSession, cardSession].filter(session => session?.token === token);
      const signed = matching.filter(session => !session!.legacy);
      const preserved: CustomerSession = signed.length ? { token, shared: matching.some(session => session!.shared),
        issued: Math.min(...signed.map(session => session!.issued!)), active: Math.min(...signed.map(session => session!.active!)) }
        : { token, shared, legacy: true };
      const bothMatch = tapSession?.token === token && cardSession?.token === token
        && tapSession.issued === preserved.issued && cardSession.issued === preserved.issued
        && tapSession.active === preserved.active && cardSession.active === preserved.active
        && tapSession.shared === preserved.shared && cardSession.shared === preserved.shared;
      if (!bothMatch) for (const header of customerSessionCookieHeaders(programId, preserved, request.url)) headers.append("Set-Cookie", header);
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
