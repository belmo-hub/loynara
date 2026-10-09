import { customerCookieAttributes, LEGACY_CUSTOMER_SESSION_DEADLINE } from "@/lib/customer-session";
import { bindTapCard } from "@/lib/secure-tap";
import { getCard } from "@/lib/product";
import { respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { clearLegacyReturningCardCookieHeader, returningCardCookieName, returningMemberSession } from "@/lib/returning-card";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    await enforcePeerLimit(request, "card_read_peer", 240, 15 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_read_token", identity: token, max: 90, windowSeconds: 15 * 60 });
    const { programId, ...card } = await getCard(token);
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    // Preserve legacy ownership before binding, but never bootstrap/renew a signed session on GET.
    // This path cannot see /api/tap cookies. Only the binding POST can reconcile both scopes safely,
    // including when its network request fails or its stricter rate limit refuses the request.
    const current = returningMemberSession(request, programId);
    if (current?.legacy && new URL(request.url).pathname.startsWith("/api/enroll/card/") && request.headers.get("sec-fetch-site") === "same-origin") {
      // The legacy cookie is visible only here. Preserve its owner before the tap-path bind checks identity.
      try {
        if (await bindTapCard(current.token) === programId) {
          headers.append("Set-Cookie", clearLegacyReturningCardCookieHeader(programId, request.url));
          headers.append("Set-Cookie", `${returningCardCookieName(programId)}=${current.token}; ${customerCookieAttributes(request.url, "/api", Math.max(0, LEGACY_CUSTOMER_SESSION_DEADLINE - Math.floor(Date.now()/1000)))}`);
        }
      } catch { /* A revoked credential remains a recovery marker; never mint it again. */ }
    }
    return Response.json(card, { headers });
  }
  catch (error) { return respondError(error); }
}
