import { getCard } from "@/lib/product";
import { respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    await enforcePeerLimit(request, "card_read_peer", 240, 15 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_read_token", identity: token, max: 90, windowSeconds: 15 * 60 });
    return Response.json(await getCard(token), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  catch (error) { return respondError(error); }
}
