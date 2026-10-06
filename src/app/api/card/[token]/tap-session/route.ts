import { bindTapCard, tapCookieHeader } from "@/lib/secure-tap";
import { requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { returningCardCookieHeader } from "@/lib/returning-card";

// Binds the open card to this browser: for NFC taps (Path=/api/tap) and for the join page, which offers this card
// again instead of creating a second one when the counter QR is scanned on a later visit (Path=/api/enroll).
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "tap_bind_peer", 60, 15 * 60);
    const { token } = await context.params;
    const programId = await bindTapCard(token);
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    headers.append("Set-Cookie", tapCookieHeader(programId, token, request.url));
    const remember = returningCardCookieHeader(programId, token, request.url);
    if (remember) headers.append("Set-Cookie", remember);
    return Response.json({ bound: true }, { headers });
  } catch (error) { return respondError(error); }
}
