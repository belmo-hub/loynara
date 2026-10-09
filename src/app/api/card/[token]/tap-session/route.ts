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
    const current = tapMemberSession(request, programId) ?? returningMemberSession(request, programId);
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
    const shared = current?.shared === true || switching || uninspectedLegacyIdentity;
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    headers.append("Set-Cookie", tapCookieHeader(programId, token, request.url, shared));
    const remember = returningCardCookieHeader(programId, token, request.url, shared);
    if (remember) {
      headers.append("Set-Cookie", clearLegacyReturningCardCookieHeader(programId, request.url));
      headers.append("Set-Cookie", remember);
    }
    return Response.json({ bound: true }, { headers });
  } catch (error) { return respondError(error); }
}
