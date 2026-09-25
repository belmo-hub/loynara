import { closeCard } from "@/lib/card-lifecycle";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "card_close_peer", 30, 15 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_close_token", identity: token, max: 3, windowSeconds: 60 * 60 });
    const body = await jsonBody(request, 1000);
    if (!body || typeof body !== "object" || (body as { confirm?: unknown }).confirm !== "CLOSE_CARD") {
      return Response.json({ error: "Explicit card closure confirmation is required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(await closeCard(token), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
