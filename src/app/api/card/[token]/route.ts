import { bindTapCard } from "@/lib/secure-tap";
import { getCard } from "@/lib/product";
import { respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { clearLegacyReturningCardCookieHeader, returningCardCookieHeader, returningMemberSession } from "@/lib/returning-card";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    await enforcePeerLimit(request, "card_read_peer", 240, 15 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_read_token", identity: token, max: 90, windowSeconds: 15 * 60 });
    const { programId, ...card } = await getCard(token);
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    // Opening the card also lets the join page offer it again later. This rides on the read the card page needs anyway, so
    // a shared guest Wi-Fi exhausting the stricter tap-binding limit cannot stop the card from being remembered. Only the
    // card page's own request remembers: a link that opens this endpoint directly must not plant a card in a browser.
    const current = returningMemberSession(request, programId);
    if (current?.legacy && new URL(request.url).pathname.startsWith("/api/enroll/card/") && request.headers.get("sec-fetch-site") === "same-origin") {
      // The legacy cookie is visible only here. Preserve its owner before the tap-path bind checks identity.
      try {
        if (await bindTapCard(current.token) === programId) {
          headers.append("Set-Cookie", clearLegacyReturningCardCookieHeader(programId, request.url));
          headers.append("Set-Cookie", returningCardCookieHeader(programId, current.token, request.url)!);
        }
      } catch { /* A revoked credential remains a recovery marker; never mint it again. */ }
    }
    const remember = new URL(request.url).pathname.startsWith("/api/enroll/card/") && request.headers.get("sec-fetch-site") === "same-origin" && !current ? returningCardCookieHeader(programId, token, request.url) : null;
    if (remember) {
      headers.append("Set-Cookie", clearLegacyReturningCardCookieHeader(programId, request.url));
      headers.append("Set-Cookie", remember);
    }
    return Response.json(card, { headers });
  }
  catch (error) { return respondError(error); }
}
