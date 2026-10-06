import { getCard } from "@/lib/product";
import { respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { returningCardCookieHeader } from "@/lib/returning-card";

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
    const remember = request.headers.get("sec-fetch-site") === "same-origin" ? returningCardCookieHeader(programId, token, request.url) : null;
    if (remember) headers.append("Set-Cookie", remember);
    return Response.json(card, { headers });
  }
  catch (error) { return respondError(error); }
}
