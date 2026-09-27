import { bindTapCard, tapCookieHeader } from "@/lib/secure-tap";
import { requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "tap_bind_peer", 60, 15 * 60);
    const { token } = await context.params;
    const programId = await bindTapCard(token);
    return Response.json({ bound: true }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": tapCookieHeader(programId, token, request.url) } });
  } catch (error) { return respondError(error); }
}
