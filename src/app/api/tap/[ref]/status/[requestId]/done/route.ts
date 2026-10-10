import { CUSTOMER_SESSION_SECONDS } from "@/lib/customer-session";
import { effectiveTapSession } from "@/lib/tap-customer-session";
import { clearLegacyReturningCardCookieHeader, returningCardCookieHeader } from "@/lib/returning-card";
import { confirmedTapAwardActivity, tapCookieHeader, tapProgramId } from "@/lib/secure-tap";
import { DomainError } from "@/lib/loyalty";
import { requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

/** Explicit customer success-screen action; no GET or polling calls this route. */
export async function POST(request: Request, context: { params: Promise<{ ref: string; requestId: string }> }) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "tap_done_peer", 120, 15 * 60);
    const reader = request.body?.getReader();
    if (reader) {
      const chunk = await reader.read(); await reader.cancel();
      if (!chunk.done) throw new DomainError("INVALID_INPUT", "Done request invalid");
    }
    const { ref, requestId } = await context.params;
    const programId = await tapProgramId(ref);
    const session = effectiveTapSession(request, programId);
    const award = await confirmedTapAwardActivity({ tagRef: ref, requestId, cardToken: session?.token });
    if (!session) throw new DomainError("NOT_FOUND", "Tap unavailable");
    if (session.shared && request.headers.get("x-loynara-card-selected") !== award.cardLocator) throw new DomainError("ACCOUNT_SWITCH_REQUIRED", "Bitte die Karte für diesen Besuch bestätigen.");
    await enforceRateLimit({ scope: "tap_done_request", identity: requestId, max: 30, windowSeconds: 15 * 60 });
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    const now = Math.floor(Date.now() / 1000);
    // Commit time is immutable: old cookies/repeated Done cannot turn an old award into new activity.
    if (award.activityAt <= session.lastActivity! || now - award.activityAt >= CUSTOMER_SESSION_SECONDS) return Response.json({ renewed: false }, { headers });
    if (award.activityAt > now) throw new DomainError("INVALID_INPUT", "Award time unavailable");
    const timing = { issued: session.issued!, lastActivity: award.activityAt };
    headers.append("Set-Cookie", tapCookieHeader(programId, session.token, request.url, session.shared, timing));
    headers.append("Set-Cookie", clearLegacyReturningCardCookieHeader(programId, request.url));
    headers.append("Set-Cookie", returningCardCookieHeader(programId, session.token, request.url, session.shared, timing)!);
    return Response.json({ renewed: true }, { headers });
  } catch (error) { return respondError(error); }
}
